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
  const PERFECT_WINDOW_MS = 800;
  const POPULAR_BONUS = 50;
  const MAX_MULTIPLIER_TENTHS = 20;
  // A slot ignores taps for this long after it was placed on or collected from,
  // so a double tap can neither collect twice nor instantly pull raw food.
  const TAP_GUARD_MS = 200;

  const CHALLENGE_VERSION = 1;
  const MAX_SEED = 0xffffffff;
  const NICKNAME_MAX = 12;
  const DEFAULT_NICKNAME = "ゲスト";
  const STORAGE_KEY = "bbqParty.v1";
  const MAX_STORED_SCORE = 9999999;

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
      { id: "shrimp", name: "エビ", nameEn: "Shrimp", idealMs: 3000, base: 80 },
      { id: "sausage", name: "ソーセージ", nameEn: "Sausage", idealMs: 3800, base: 100 },
      { id: "kalbi", name: "カルビ", nameEn: "Kalbi beef", idealMs: 4700, base: 125 },
      { id: "corn", name: "コーン", nameEn: "Corn", idealMs: 6000, base: 160 },
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

  // Thresholds for an ideal cook time T, all in milliseconds:
  //   goodStartMs = 0.8T, perfectStartMs = T,
  //   perfectEndMs = min(T + 0.8s, 1.5T), burnMs = 1.5T
  function cookWindows(idealMs) {
    const burnMs = (idealMs * 3) / 2;
    return {
      goodStartMs: (idealMs * 4) / 5,
      perfectStartMs: idealMs,
      perfectEndMs: Math.min(idealMs + PERFECT_WINDOW_MS, burnMs),
      burnMs,
    };
  }

  // Boundary rules (age = active time on the grill):
  //   age <  0.8T              RAW
  //   0.8T <= age <  T         GOOD     (0.8T inclusive, T exclusive)
  //   T    <= age <= T + 0.8s  PERFECT  (both ends inclusive)
  //   T + 0.8s < age <= 1.5T   GOOD     (1.5T inclusive)
  //   age >  1.5T              BURNT
  function stageForAge(idealMs, ageMs) {
    const w = cookWindows(idealMs);
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
    return stageForAge(ingredientById(ingredientId).idealMs, ageMs);
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
  // only ever writes them through textContent.
  function normalizeNickname(raw) {
    const text = typeof raw === "string" ? raw : "";
    const cleaned = text.replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").trim();
    if (cleaned === "") {
      return { ok: true, value: DEFAULT_NICKNAME, isGuest: true };
    }
    if (Array.from(cleaned).length > NICKNAME_MAX) {
      return { ok: false, error: "too-long", value: DEFAULT_NICKNAME, isGuest: true };
    }
    return { ok: true, value: cleaned, isGuest: false };
  }

  // ---- local record ------------------------------------------------------

  function sanitizeRecord(data) {
    const record = { bestScore: 0, nickname: "", muted: false };
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return record;
    }
    const has = (key) => Object.prototype.hasOwnProperty.call(data, key);
    if (has("bestScore") && Number.isInteger(data.bestScore) && data.bestScore >= 0 && data.bestScore <= MAX_STORED_SCORE) {
      record.bestScore = data.bestScore;
    }
    if (has("nickname") && typeof data.nickname === "string") {
      const nickname = normalizeNickname(data.nickname);
      record.nickname = nickname.ok && !nickname.isGuest ? nickname.value : "";
    }
    if (has("muted")) {
      record.muted = data.muted === true;
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

    function load() {
      if (record) {
        return Object.assign({}, record);
      }
      let parsed = null;
      try {
        const store = storage();
        const raw = store ? store.getItem(STORAGE_KEY) : null;
        parsed = typeof raw === "string" ? JSON.parse(raw) : null;
      } catch (error) {
        parsed = null;
      }
      record = sanitizeRecord(parsed);
      return Object.assign({}, record);
    }

    function persist() {
      try {
        const store = storage();
        if (!store) {
          return false;
        }
        store.setItem(STORAGE_KEY, JSON.stringify(Object.assign({ v: 1 }, record)));
        return true;
      } catch (error) {
        return false;
      }
    }

    function saveBest(score) {
      load();
      const valid = Number.isInteger(score) && score > 0 && score <= MAX_STORED_SCORE;
      const isNewBest = valid && score > record.bestScore;
      if (isNewBest) {
        record.bestScore = score;
        persist();
      }
      return { bestScore: record.bestScore, isNewBest };
    }

    function saveNickname(nickname) {
      load();
      record.nickname = sanitizeRecord({ nickname }).nickname;
      persist();
    }

    function saveMuted(muted) {
      load();
      record.muted = muted === true;
      persist();
    }

    return { load, saveBest, saveNickname, saveMuted };
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
          burnMs: cookWindows(ingredient.idealMs).burnMs,
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
    MAX_SEED,
    NICKNAME_MAX,
    DEFAULT_NICKNAME,
    STORAGE_KEY,
    GRADE,
    STAGE,
    INGREDIENTS,
    INGREDIENT_IDS,
    ingredientById,
    cookWindows,
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
    createRecordStore,
    shareChallenge,
    createParticlePool,
    createGame,
  };
});
