// BBQ Party — pure game core.
// No DOM, no timers, no globals: time, storage and the navigator are injected,
// so the same file runs as a plain <script> in the browser and under Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BBQCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const GAME_MS = 60000;
  const PHASE_MS = 10000;
  const PHASE_COUNT = 6;
  const PREVIEW_MS = 3000;
  const SLOT_COUNT = 6;
  // Default PERFECT width. Each ingredient carries its own perfectMs.
  const PERFECT_WINDOW_MS = 800;
  const POPULAR_BONUS = 50;
  const MAX_MULTIPLIER_TENTHS = 20;
  // A slot ignores taps for this long after it was placed on or collected from,
  // so a double tap can neither collect twice nor instantly pull raw food.
  const TAP_GUARD_MS = 200;

  // Version 2 = six ingredients. The same seed number picks a different
  // popular order than it did in version 1, so v1 links are never replayed
  // as if they were v2 (see parseChallengeHash).
  const CHALLENGE_VERSION = 2;
  const LEGACY_CHALLENGE_VERSION = 1;
  const MAX_SEED = 0xffffffff;
  const NICKNAME_MAX = 12;
  const DEFAULT_NICKNAME = "ゲスト";
  const STORAGE_KEY = "bbqParty.v2";
  const LEGACY_STORAGE_KEY = "bbqParty.v1";
  // Far above anything reachable: 6 slots x 20 collections x (210 x 2 + 50).
  const MAX_SCORE = 99999;
  const MAX_PLAYERS = 20;
  const RANK_SHOWN = 3;
  const VOLUME_MAX = 5;
  const DEFAULT_AUDIO = Object.freeze({ seMuted: false, seVolume: 5, bgmMuted: false, bgmVolume: 3 });

  const GRADE = Object.freeze({ RAW: "RAW", GOOD: "GOOD", PERFECT: "PERFECT", BURNT: "BURNT" });
  const STAGE = Object.freeze({
    RAW: "raw",
    GOOD_EARLY: "good-early",
    PERFECT: "perfect",
    GOOD_LATE: "good-late",
    BURNT: "burnt",
  });

  const INGREDIENTS = Object.freeze(
    [
      { id: "shrimp", name: "エビ", short: "エビ", nameEn: "Shrimp", idealMs: 3000, base: 80, perfectMs: 800, level: "" },
      { id: "sausage", name: "ソーセージ", short: "ソーセージ", nameEn: "Sausage", idealMs: 3800, base: 100, perfectMs: 800, level: "" },
      // Beginner pick: a wide PERFECT window, paid for with the lowest points per second.
      { id: "shiitake", name: "しいたけ", short: "しいたけ", nameEn: "Shiitake", idealMs: 4200, base: 100, perfectMs: 1400, level: "やさしい" },
      { id: "kalbi", name: "カルビ", short: "カルビ", nameEn: "Kalbi beef", idealMs: 4700, base: 125, perfectMs: 800, level: "" },
      { id: "corn", name: "コーン", short: "コーン", nameEn: "Corn", idealMs: 6000, base: 160, perfectMs: 800, level: "" },
      // Expert pick: the best points per second, but only inside a narrow PERFECT window.
      { id: "steak", name: "厚切りステーキ", short: "ステーキ", nameEn: "Thick-cut steak", idealMs: 7000, base: 210, perfectMs: 500, level: "上級" },
    ].map(Object.freeze)
  );
  const INGREDIENT_IDS = Object.freeze(INGREDIENTS.map((item) => item.id));

  function ingredientById(id) {
    for (const item of INGREDIENTS) {
      if (item.id === id) {
        return item;
      }
    }
    return null;
  }

  // ---- cooking ---------------------------------------------------------

  // Thresholds for an ideal cook time T and a PERFECT width P, in milliseconds:
  //   goodStartMs = 0.8T, perfectStartMs = T,
  //   perfectEndMs = min(T + P, 1.5T), burnMs = 1.5T
  function cookWindows(idealMs, perfectMs) {
    const burnMs = (idealMs * 3) / 2;
    return {
      goodStartMs: (idealMs * 4) / 5,
      perfectStartMs: idealMs,
      perfectEndMs: Math.min(idealMs + (perfectMs === undefined ? PERFECT_WINDOW_MS : perfectMs), burnMs),
      burnMs,
    };
  }

  function windowsFor(ingredientId) {
    const item = ingredientById(ingredientId);
    return cookWindows(item.idealMs, item.perfectMs);
  }

  // Boundary rules (age = active time on the grill):
  //   age <  0.8T              RAW
  //   0.8T <= age <  T         GOOD     (0.8T inclusive, T exclusive)
  //   T    <= age <= T + P     PERFECT  (both ends inclusive)
  //   T + P < age <= 1.5T      GOOD     (1.5T inclusive)
  //   age >  1.5T              BURNT
  function stageForAge(idealMs, ageMs, perfectMs) {
    const w = cookWindows(idealMs, perfectMs);
    if (!(ageMs >= w.goodStartMs)) {
      return STAGE.RAW;
    }
    if (ageMs < w.perfectStartMs) {
      return STAGE.GOOD_EARLY;
    }
    if (ageMs <= w.perfectEndMs) {
      return STAGE.PERFECT;
    }
    if (ageMs <= w.burnMs) {
      return STAGE.GOOD_LATE;
    }
    return STAGE.BURNT;
  }

  function gradeForStage(stage) {
    if (stage === STAGE.PERFECT) {
      return GRADE.PERFECT;
    }
    if (stage === STAGE.GOOD_EARLY || stage === STAGE.GOOD_LATE) {
      return GRADE.GOOD;
    }
    return stage === STAGE.BURNT ? GRADE.BURNT : GRADE.RAW;
  }

  function cookStage(ingredientId, ageMs) {
    const item = ingredientById(ingredientId);
    return stageForAge(item.idealMs, ageMs, item.perfectMs);
  }

  function judge(ingredientId, ageMs) {
    return gradeForStage(cookStage(ingredientId, ageMs));
  }

  // ---- scoring ---------------------------------------------------------

  function multiplierTenths(combo) {
    return Math.min(MAX_MULTIPLIER_TENTHS, 10 + Math.max(0, combo));
  }

  // points = round(base x quality x multiplier) + popular bonus
  // The multiplier comes from the combo *before* this collection. The +50
  // popular bonus is flat: it is added after the multiplier and never scaled.
  // Rounding is half-up, done in integers so it is exact.
  function scoreCollection(ingredientId, grade, comboBefore, isPopular) {
    const tenths = multiplierTenths(comboBefore);
    const percent = grade === GRADE.PERFECT ? 100 : grade === GRADE.GOOD ? 60 : 0;
    if (percent === 0) {
      return { points: 0, cookedPoints: 0, bonus: 0, multiplierTenths: tenths };
    }
    const base = ingredientById(ingredientId).base;
    const cookedPoints = Math.floor((base * percent * tenths + 500) / 1000);
    const bonus = isPopular ? POPULAR_BONUS : 0;
    return { points: cookedPoints + bonus, cookedPoints, bonus, multiplierTenths: tenths };
  }

  // ---- seeded popular schedule ------------------------------------------

  function isValidSeed(seed) {
    return Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildSchedule(seed) {
    if (!isValidSeed(seed)) {
      throw new RangeError("invalid seed");
    }
    const random = mulberry32(seed);
    const schedule = [];
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      const pool = phase === 0 ? INGREDIENT_IDS : INGREDIENT_IDS.filter((id) => id !== schedule[phase - 1]);
      schedule.push(pool[Math.floor(random() * pool.length)]);
    }
    return schedule;
  }

  function phaseIndexAt(activeMs) {
    return Math.max(0, Math.min(PHASE_COUNT - 1, Math.floor(activeMs / PHASE_MS)));
  }

  // The next ingredient is previewed during the final 3 seconds of a phase
  // (phase time >= 7s). The last phase has nothing to preview.
  function popularAt(schedule, activeMs) {
    const phase = phaseIndexAt(activeMs);
    const next = phase + 1 < PHASE_COUNT ? schedule[phase + 1] : null;
    const msToNext = Math.max(0, (phase + 1) * PHASE_MS - activeMs);
    return {
      phase,
      current: schedule[phase],
      next,
      msToNext,
      showNext: next !== null && msToNext <= PREVIEW_MS,
    };
  }

  function randomSeed(randomUint32) {
    let value = NaN;
    try {
      value = typeof randomUint32 === "function" ? randomUint32() : NaN;
    } catch (error) {
      value = NaN;
    }
    if (!isValidSeed(value)) {
      value = Math.floor(Math.random() * (MAX_SEED + 1));
    }
    return value;
  }

  // ---- challenge link ----------------------------------------------------

  // The fragment is exactly "#v=<version>&seed=<seed>": canonical decimal,
  // no extra keys, so a nickname can never ride along.
  // A well-formed v1 link is reported as "legacy" without its seed: under the
  // six-ingredient rules that number would mean a different challenge.
  const HASH_PATTERN = /^#v=(0|[1-9][0-9]{0,2})&seed=(0|[1-9][0-9]{0,9})$/;

  function parseChallengeHash(hash) {
    if (typeof hash !== "string" || hash === "" || hash === "#") {
      return { ok: false, reason: "empty" };
    }
    const match = HASH_PATTERN.exec(hash);
    if (!match) {
      return { ok: false, reason: "format" };
    }
    const version = Number(match[1]);
    const seed = Number(match[2]);
    if (version === LEGACY_CHALLENGE_VERSION) {
      return { ok: false, reason: "legacy", version };
    }
    if (version !== CHALLENGE_VERSION) {
      return { ok: false, reason: "version" };
    }
    if (!isValidSeed(seed)) {
      return { ok: false, reason: "seed" };
    }
    return { ok: true, version, seed };
  }

  function buildChallengeHash(seed) {
    if (!isValidSeed(seed)) {
      throw new RangeError("invalid seed");
    }
    return "#v=" + CHALLENGE_VERSION + "&seed=" + seed;
  }

  function buildChallengeUrl(href, seed) {
    const page = String(href).split("#")[0].split("?")[0];
    return page + buildChallengeHash(seed);
  }

  // ---- nickname ----------------------------------------------------------

  const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

  // Nicknames are plain text. Markup characters are allowed because the UI
  // only ever writes them through textContent. The normalized text is also
  // the ranking identity: the same text is the same player (case-sensitive).
  // No name, or typing the guest name itself, is the one shared guest entry.
  function normalizeNickname(raw) {
    const text = typeof raw === "string" ? raw : "";
    const cleaned = text.replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").trim().normalize("NFC");
    if (cleaned === "" || cleaned === DEFAULT_NICKNAME) {
      return { ok: true, value: DEFAULT_NICKNAME, isGuest: true };
    }
    if (Array.from(cleaned).length > NICKNAME_MAX) {
      return { ok: false, error: "too-long", value: DEFAULT_NICKNAME, isGuest: true };
    }
    return { ok: true, value: cleaned, isGuest: false };
  }

  // ---- local record ------------------------------------------------------

  // Stored shape (STORAGE_KEY):
  //   { v: 2, nickname, players: [{ name, best }], legacyBest, audio }
  // players is the per-name ranking for this device, kept sorted: higher best
  // first, and on a tie whoever reached that score first stays ahead.

  function own(data, key) {
    return Object.prototype.hasOwnProperty.call(data, key);
  }

  function isPlainObject(data) {
    return Boolean(data) && typeof data === "object" && !Array.isArray(data);
  }

  function isValidScore(score) {
    return Number.isSafeInteger(score) && score >= 1 && score <= MAX_SCORE;
  }

  function sanitizeNickname(value) {
    const nickname = normalizeNickname(value);
    return nickname.ok && !nickname.isGuest ? nickname.value : "";
  }

  function sanitizeAudio(data) {
    const audio = Object.assign({}, DEFAULT_AUDIO);
    if (!isPlainObject(data)) {
      return audio;
    }
    for (const key of ["seMuted", "bgmMuted"]) {
      if (own(data, key)) {
        audio[key] = data[key] === true;
      }
    }
    for (const key of ["seVolume", "bgmVolume"]) {
      if (own(data, key) && Number.isInteger(data[key]) && data[key] >= 1 && data[key] <= VOLUME_MAX) {
        audio[key] = data[key];
      }
    }
    return audio;
  }

  // Drops anything malformed, merges duplicate names into their higher score
  // and re-sorts, so a hand-edited or damaged list still ranks the same way
  // every time. Only a bounded prefix of a huge list is looked at.
  function sanitizePlayers(list) {
    const byName = new Map();
    if (Array.isArray(list)) {
      const limit = Math.min(list.length, MAX_PLAYERS * 10);
      for (let i = 0; i < limit; i += 1) {
        const entry = list[i];
        if (!isPlainObject(entry) || !own(entry, "name") || !own(entry, "best")) {
          continue;
        }
        if (typeof entry.name !== "string" || !isValidScore(entry.best)) {
          continue;
        }
        const who = normalizeNickname(entry.name);
        if (!who.ok) {
          continue;
        }
        const known = byName.get(who.value);
        if (!known || entry.best > known.best) {
          byName.set(who.value, { name: who.value, best: entry.best, guest: who.isGuest, order: i });
        }
      }
    }
    return Array.from(byName.values())
      .sort((a, b) => b.best - a.best || a.order - b.order)
      .slice(0, MAX_PLAYERS)
      .map((player) => ({ name: player.name, best: player.best, guest: player.guest }));
  }

  function emptyRecord() {
    return { nickname: "", players: [], legacyBest: 0, audio: Object.assign({}, DEFAULT_AUDIO) };
  }

  function sanitizeRecord(data) {
    const record = emptyRecord();
    if (own(data, "nickname") && typeof data.nickname === "string") {
      record.nickname = sanitizeNickname(data.nickname);
    }
    if (own(data, "players")) {
      record.players = sanitizePlayers(data.players);
    }
    if (own(data, "legacyBest") && isValidScore(data.legacyBest)) {
      record.legacyBest = data.legacyBest;
    }
    if (own(data, "audio")) {
      record.audio = sanitizeAudio(data.audio);
    }
    return record;
  }

  // Version 1 stored one device-wide best with no name attached. It is kept
  // as legacyBest and never turned into a ranking entry: nobody knows who
  // scored it, and it was played with four ingredients. v1 "muted" silenced
  // everything, so it mutes both channels.
  function migrateLegacy(data) {
    const record = emptyRecord();
    if (!isPlainObject(data)) {
      return record;
    }
    if (own(data, "nickname") && typeof data.nickname === "string") {
      record.nickname = sanitizeNickname(data.nickname);
    }
    if (own(data, "bestScore") && isValidScore(data.bestScore)) {
      record.legacyBest = data.bestScore;
    }
    if (own(data, "muted") && data.muted === true) {
      record.audio.seMuted = true;
      record.audio.bgmMuted = true;
    }
    return record;
  }

  // getStorage is called lazily because merely touching window.localStorage
  // can throw. Every failure degrades to an in-memory record.
  function createRecordStore(getStorage) {
    let record = null;

    function storage() {
      try {
        return getStorage() || null;
      } catch (error) {
        return null;
      }
    }

    function read(key) {
      try {
        const store = storage();
        const raw = store ? store.getItem(key) : null;
        return typeof raw === "string" ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    }

    function snapshot() {
      return {
        nickname: record.nickname,
        players: record.players.map((player) => Object.assign({}, player)),
        legacyBest: record.legacyBest,
        audio: Object.assign({}, record.audio),
      };
    }

    // The v1 key is only read, never rewritten or removed.
    function load() {
      if (!record) {
        const current = read(STORAGE_KEY);
        record = isPlainObject(current) ? sanitizeRecord(current) : migrateLegacy(read(LEGACY_STORAGE_KEY));
      }
      return snapshot();
    }

    function persist() {
      try {
        const store = storage();
        if (!store) {
          return false;
        }
        store.setItem(
          STORAGE_KEY,
          JSON.stringify({
            v: 2,
            nickname: record.nickname,
            players: record.players.map((player) => ({ name: player.name, best: player.best })),
            legacyBest: record.legacyBest,
            audio: record.audio,
          })
        );
        return true;
      } catch (error) {
        return false;
      }
    }

    // One entry per name, holding that name's best. rank is 1-based, 0 when
    // the name is not on the list. persisted is false when a new best could
    // only be kept in memory.
    function recordScore(name, score) {
      load();
      const who = normalizeNickname(name);
      let index = who.ok ? record.players.findIndex((player) => player.name === who.value) : -1;
      let isNewBest = false;
      let persisted = true;
      if (who.ok && isValidScore(score) && (index === -1 || score > record.players[index].best)) {
        if (index !== -1) {
          record.players.splice(index, 1);
        }
        let at = 0;
        while (at < record.players.length && record.players[at].best >= score) {
          at += 1;
        }
        record.players.splice(at, 0, { name: who.value, best: score, guest: who.isGuest });
        record.players.length = Math.min(record.players.length, MAX_PLAYERS);
        index = at < MAX_PLAYERS ? at : -1;
        isNewBest = index !== -1;
        persisted = persist();
      }
      return { best: index === -1 ? 0 : record.players[index].best, rank: index + 1, isNewBest, persisted };
    }

    function top(count) {
      return load().players.slice(0, count === undefined ? RANK_SHOWN : count);
    }

    function saveNickname(nickname) {
      load();
      record.nickname = sanitizeNickname(nickname);
      persist();
    }

    function saveAudio(audio) {
      load();
      record.audio = sanitizeAudio(audio);
      persist();
      return Object.assign({}, record.audio);
    }

    return { load, recordScore, top, saveNickname, saveAudio };
  }

  // ---- background music ----------------------------------------------------

  // An original eight-bar loop written for this game (C major, I-vi-IV-V
  // twice), one entry per eighth note as a MIDI note number; 0 is a rest.
  const BGM = Object.freeze({
    stepSec: 0.27,
    lookaheadSec: 0.45,
    leadSec: 0.08,
    melody: Object.freeze([
      76, 0, 79, 0, 81, 79, 76, 0,
      72, 0, 76, 0, 74, 72, 69, 0,
      77, 0, 81, 0, 79, 77, 74, 0,
      74, 76, 79, 0, 71, 0, 74, 0,
      76, 0, 79, 0, 84, 81, 79, 0,
      81, 0, 79, 76, 0, 72, 74, 0,
      77, 0, 74, 77, 81, 0, 79, 0,
      79, 0, 74, 0, 72, 0, 0, 0,
    ]),
    bass: Object.freeze(
      [48, 45, 41, 43, 48, 45, 41, 43].reduce(
        (steps, root) => steps.concat([root, 0, root + 7, 0, root + 12, 0, root + 7, 0]),
        []
      )
    ),
  });

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Decides which notes to hand to the audio clock, each exactly once.
  // It owns no timer: the caller polls due(now) (the game's single frame
  // loop does), so there is nothing here that could run twice. Times are in
  // seconds on the caller's audio clock.
  function createBgmSequencer() {
    let playing = false;
    let step = 0;
    let nextAt = 0;

    // Continues from the step it stopped at. Starting twice does nothing.
    function start(nowSec) {
      if (playing) {
        return false;
      }
      playing = true;
      nextAt = nowSec + BGM.leadSec;
      return true;
    }

    function stop() {
      playing = false;
    }

    // Back to the top of the tune, for a new round.
    function reset() {
      step = 0;
    }

    function due(nowSec) {
      const notes = [];
      if (!playing || !(nowSec >= 0)) {
        return notes;
      }
      // After a stall the tune carries on from now instead of bursting to catch up.
      if (nextAt < nowSec) {
        nextAt = nowSec + BGM.leadSec;
      }
      while (nextAt < nowSec + BGM.lookaheadSec) {
        for (const voice of ["melody", "bass"]) {
          const midi = BGM[voice][step];
          if (midi) {
            notes.push({ voice, step, midi, hz: midiToHz(midi), atSec: nextAt });
          }
        }
        step = (step + 1) % BGM.melody.length;
        nextAt += BGM.stepSec;
      }
      return notes;
    }

    return {
      start,
      stop,
      reset,
      due,
      get playing() {
        return playing;
      },
      get step() {
        return step;
      },
    };
  }

  // ---- share -------------------------------------------------------------

  // Web Share API -> clipboard -> visible text. Only ever runs from a tap on
  // the share button; a cancelled share sheet does not fall through.
  async function shareChallenge(options) {
    const nav = options.nav;
    const payload = { title: options.title, text: options.text, url: options.url };
    try {
      if (nav && typeof nav.share === "function") {
        await nav.share(payload);
        return { method: "share" };
      }
    } catch (error) {
      if (error && error.name === "AbortError") {
        return { method: "cancelled" };
      }
    }
    try {
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
        await nav.clipboard.writeText(options.text + "\n" + options.url);
        return { method: "clipboard" };
      }
    } catch (error) {
      // fall through to the visible text fallback
    }
    return { method: "fallback", url: options.url };
  }

  // ---- bounded particles ---------------------------------------------------

  function createParticlePool(maxCount) {
    const items = [];
    return {
      items,
      max: maxCount,
      add(particle) {
        while (items.length >= maxCount) {
          items.shift();
        }
        particle.age = 0;
        items.push(particle);
      },
      update(dtMs, step) {
        let kept = 0;
        for (let i = 0; i < items.length; i += 1) {
          const particle = items[i];
          particle.age += dtMs;
          if (particle.age < particle.life) {
            if (step) {
              step(particle, dtMs);
            }
            items[kept] = particle;
            kept += 1;
          }
        }
        items.length = kept;
      },
      clear() {
        items.length = 0;
      },
    };
  }

  // ---- game ---------------------------------------------------------------

  // Active time is derived from the injected clock, never accumulated per
  // frame: activeMs = time banked before the last resume + (now - resumedAt).
  // Food stores the active time it was placed at, so its age, the burn moment
  // and the 60s end are the same whatever the frame rate. Every action syncs
  // first, so burns that happened before a tap are applied before that tap.
  function createGame(options) {
    const now = options.now;
    const seed = options.seed;
    const schedule = buildSchedule(seed);

    let status = "ready";
    let bankedMs = 0;
    let resumedAt = 0;
    let lastPhase = 0;
    let selected = INGREDIENT_IDS[0];
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let perfectCount = 0;
    let goodCount = 0;
    let rawCount = 0;
    let burnedCount = 0;
    let events = [];
    const slots = [];
    const guardUntil = [];
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      slots.push(null);
      guardUntil.push(-Infinity);
    }

    function rawActiveMs() {
      return status === "running" ? bankedMs + Math.max(0, now() - resumedAt) : bankedMs;
    }

    // Applies everything that became true up to the current instant and
    // returns that instant in active milliseconds.
    function sync() {
      if (status !== "running") {
        return bankedMs;
      }
      const raw = rawActiveMs();
      const t = Math.min(GAME_MS, raw);

      const due = [];
      for (let i = 0; i < SLOT_COUNT; i += 1) {
        const food = slots[i];
        if (food && !food.burnt && t - food.placedAt > food.burnMs) {
          due.push({ slot: i, atMs: food.placedAt + food.burnMs });
        }
      }
      due.sort((a, b) => a.atMs - b.atMs || a.slot - b.slot);
      for (const burn of due) {
        const food = slots[burn.slot];
        food.burnt = true;
        burnedCount += 1;
        combo = 0;
        events.push({ type: "burn", slot: burn.slot, ingredient: food.id, atMs: burn.atMs });
      }

      const phase = phaseIndexAt(t);
      if (phase !== lastPhase) {
        lastPhase = phase;
        events.push({ type: "phase", phase, ingredient: schedule[phase], atMs: phase * PHASE_MS });
      }

      if (raw >= GAME_MS) {
        bankedMs = GAME_MS;
        status = "ended";
        events.push({ type: "end", atMs: GAME_MS });
      }
      return t;
    }

    function start() {
      if (status !== "ready") {
        return false;
      }
      bankedMs = 0;
      resumedAt = now();
      status = "running";
      return true;
    }

    function pause() {
      if (status !== "running") {
        return false;
      }
      const t = sync();
      if (status !== "running") {
        return false;
      }
      bankedMs = t;
      status = "paused";
      return true;
    }

    function resume() {
      if (status !== "paused") {
        return false;
      }
      resumedAt = now();
      status = "running";
      return true;
    }

    function select(ingredientId) {
      if (!ingredientById(ingredientId)) {
        return false;
      }
      selected = ingredientId;
      return true;
    }

    function ignored(reason) {
      return { type: "ignored", reason };
    }

    function tapSlot(index) {
      const t = sync();
      if (status !== "running") {
        return ignored(status);
      }
      if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) {
        return ignored("invalid-slot");
      }
      if (t < guardUntil[index]) {
        return ignored("guard");
      }
      guardUntil[index] = t + TAP_GUARD_MS;

      const food = slots[index];
      if (!food) {
        const ingredient = ingredientById(selected);
        slots[index] = {
          id: ingredient.id,
          placedAt: t,
          burnMs: windowsFor(ingredient.id).burnMs,
          burnt: false,
        };
        return { type: "placed", slot: index, ingredient: ingredient.id };
      }

      slots[index] = null;
      const ageMs = t - food.placedAt;
      const stage = food.burnt ? STAGE.BURNT : cookStage(food.id, ageMs);
      const grade = gradeForStage(stage);
      const comboBefore = combo;
      const popular = schedule[phaseIndexAt(t)] === food.id;
      const result = scoreCollection(food.id, grade, comboBefore, popular);

      if (grade === GRADE.RAW) {
        rawCount += 1;
        combo = 0;
      } else if (grade === GRADE.GOOD || grade === GRADE.PERFECT) {
        score += result.points;
        combo += 1;
        maxCombo = Math.max(maxCombo, combo);
        if (grade === GRADE.PERFECT) {
          perfectCount += 1;
        } else {
          goodCount += 1;
        }
      }
      // BURNT: the combo reset and the burned count already happened once,
      // at the moment the food crossed 1.5T.

      return {
        type: "collected",
        slot: index,
        ingredient: food.id,
        grade,
        stage,
        ageMs,
        points: result.points,
        bonus: result.bonus,
        multiplierTenths: result.multiplierTenths,
        comboBefore,
        comboAfter: combo,
      };
    }

    function results() {
      return { seed, score, perfectCount, goodCount, rawCount, burnedCount, maxCombo };
    }

    function snapshot() {
      const t = sync();
      return {
        status,
        seed,
        activeMs: t,
        remainingMs: GAME_MS - t,
        score,
        combo,
        maxCombo,
        perfectCount,
        goodCount,
        rawCount,
        burnedCount,
        multiplierTenths: multiplierTenths(combo),
        selected,
        popular: popularAt(schedule, t),
        slots: slots.map((food) => {
          if (!food) {
            return null;
          }
          const ageMs = t - food.placedAt;
          return {
            id: food.id,
            ageMs,
            burnt: food.burnt,
            stage: food.burnt ? STAGE.BURNT : cookStage(food.id, ageMs),
          };
        }),
      };
    }

    function drainEvents() {
      const drained = events;
      events = [];
      return drained;
    }

    // A disposed game ignores every later call, so a stale handle left over
    // from before a restart cannot score or emit events.
    function dispose() {
      bankedMs = Math.min(GAME_MS, rawActiveMs());
      status = "disposed";
      events = [];
    }

    return {
      seed,
      schedule: schedule.slice(),
      get status() {
        return status;
      },
      start,
      pause,
      resume,
      select,
      tapSlot,
      sync,
      snapshot,
      results,
      drainEvents,
      dispose,
    };
  }

  return {
    GAME_MS,
    PHASE_MS,
    PHASE_COUNT,
    PREVIEW_MS,
    SLOT_COUNT,
    PERFECT_WINDOW_MS,
    POPULAR_BONUS,
    TAP_GUARD_MS,
    CHALLENGE_VERSION,
    LEGACY_CHALLENGE_VERSION,
    MAX_SEED,
    NICKNAME_MAX,
    DEFAULT_NICKNAME,
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    MAX_SCORE,
    MAX_PLAYERS,
    RANK_SHOWN,
    VOLUME_MAX,
    DEFAULT_AUDIO,
    BGM,
    GRADE,
    STAGE,
    INGREDIENTS,
    INGREDIENT_IDS,
    ingredientById,
    cookWindows,
    windowsFor,
    stageForAge,
    gradeForStage,
    cookStage,
    judge,
    multiplierTenths,
    scoreCollection,
    isValidSeed,
    buildSchedule,
    phaseIndexAt,
    popularAt,
    randomSeed,
    parseChallengeHash,
    buildChallengeHash,
    buildChallengeUrl,
    normalizeNickname,
    isValidScore,
    createRecordStore,
    midiToHz,
    createBgmSequencer,
    shareChallenge,
    createParticlePool,
    createGame,
  };
});
