// BBQ Party — browser wiring: DOM, Canvas rendering, sound and lifecycle.
// All rules live in core.js; this file only reads snapshots and reacts.
(function () {
  "use strict";

  const Core = window.BBQCore;
  const Art = window.BBQArt;
  if (!Core || !Art) {
    return;
  }

  const i18n = window.BBQI18n.create({ navigator: window.navigator, storage: () => window.localStorage });
  const t = (key, values) => i18n.t(key, values);

  const MAX_PARTICLES = 80;
  const MAX_POPUPS = 12;
  const MAX_DPR = 2;
  const URGENT_MS = 10000;

  const STAGE_UI = {
    raw: { badgeKey: "raw", sayKey: "stageRaw", cls: "is-raw" },
    "good-early": { badge: "◆ GOOD", say: "GOOD", cls: "is-good" },
    perfect: { badge: "★ PERFECT", say: "PERFECT", cls: "is-perfect" },
    "good-late": { badgeKey: "badgeLate", sayKey: "stageLate", cls: "is-late" },
    burnt: { badgeKey: "burnt", sayKey: "stageBurnt", cls: "is-burnt" },
  };
  const GRADE_POP = {
    PERFECT: { mark: "★ PERFECT", color: "#57b94f" },
    GOOD: { mark: "◆ GOOD", color: "#f7c531" },
    RAW: { get mark() { return t("raw"); }, color: "#e8e0d0" },
    BURNT: { get mark() { return t("burnt"); }, color: "#ff8a70" },
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"),
    scene: $("scene"),
    fx: $("fx"),
    gameArea: $("gameArea"),
    hudPlayer: $("hudPlayer"),
    soundButton: $("soundButton"),
    soundText: $("soundText"),
    pauseButton: $("pauseButton"),
    timeCard: $("timeCard"),
    hudTime: $("hudTime"),
    hudTimeBar: $("hudTimeBar"),
    scoreCard: $("scoreCard"),
    hudScore: $("hudScore"),
    hudCombo: $("hudCombo"),
    hudMult: $("hudMult"),
    popularIcon: $("popularIcon"),
    popularName: $("popularName"),
    popularCountdown: $("popularCountdown"),
    nextWrap: $("nextWrap"),
    nextIcon: $("nextIcon"),
    nextName: $("nextName"),
    grill: $("grill"),
    statusLine: $("statusLine"),
    screenStart: $("screenStart"),
    startForm: $("startForm"),
    nicknameInput: $("nicknameInput"),
    nicknameError: $("nicknameError"),
    startButton: $("startButton"),
    startSoundButton: $("startSoundButton"),
    challengeInfo: $("challengeInfo"),
    linkNotice: $("linkNotice"),
    startLegacy: $("startLegacy"),
    pauseOverlay: $("pauseOverlay"),
    pauseReason: $("pauseReason"),
    resumeButton: $("resumeButton"),
    pauseSoundButton: $("pauseSoundButton"),
    soundOverlay: $("soundOverlay"),
    soundCloseButton: $("soundCloseButton"),
    screenResult: $("screenResult"),
    resultNickname: $("resultNickname"),
    resultScore: $("resultScore"),
    resultNewBest: $("resultNewBest"),
    resultPerfect: $("resultPerfect"),
    resultBurned: $("resultBurned"),
    resultMaxCombo: $("resultMaxCombo"),
    resultBest: $("resultBest"),
    resultSaveNote: $("resultSaveNote"),
    resultSeed: $("resultSeed"),
    retryButton: $("retryButton"),
    shareButton: $("shareButton"),
    newChallengeButton: $("newChallengeButton"),
    titleButton: $("titleButton"),
    shareStatus: $("shareStatus"),
    shareFallback: $("shareFallback"),
    shareFallbackText: $("shareFallbackText"),
  };
  const slotEls = [];
  const badgeEls = [];
  const plusEls = [];
  for (let i = 0; i < Core.SLOT_COUNT; i += 1) {
    slotEls.push($("slot-" + i));
    badgeEls.push($("slotBadge-" + i));
    plusEls.push($("slotPlus-" + i));
  }
  const ingEls = {};
  for (const item of Core.INGREDIENTS) {
    ingEls[item.id] = {
      button: $("ing-" + item.id),
      icon: $("ingIcon-" + item.id),
      name: $("ingName-" + item.id),
      meta: $("ingMeta-" + item.id),
      window: $("ingWindow-" + item.id),
      pop: $("ingPop-" + item.id),
    };
  }
  // The same top three is shown in the HUD, on the start card and on the result card.
  const rankEls = {};
  for (const board of ["hudRank", "startRank", "resultRank"]) {
    rankEls[board] = [];
    for (let i = 0; i < Core.RANK_SHOWN; i += 1) {
      rankEls[board].push({
        row: $(board + "-" + i),
        name: $(board + "Name-" + i),
        score: $(board + "Score-" + i),
      });
    }
  }
  const soundEls = {};
  for (const channel of ["se", "bgm"]) {
    soundEls[channel] = {
      toggle: $(channel + "Toggle"),
      down: $(channel + "Down"),
      up: $(channel + "Up"),
      level: $(channel + "Level"),
    };
  }

  const sceneCtx = el.scene.getContext("2d");
  const fxCtx = el.fx.getContext("2d");
  const store = Core.createRecordStore(() => window.localStorage);
  const particles = Core.createParticlePool(MAX_PARTICLES);
  const popups = Core.createParticlePool(MAX_POPUPS);
  const timers = new Set();
  const view = { w: 0, h: 0, dpr: 1, slots: [], grill: null, plate: null };

  let game = null;
  let seed = 0;
  let nickname = Core.DEFAULT_NICKNAME;
  let selected = Core.INGREDIENT_IDS[0];
  let rafId = 0;
  let lastFrameTs = 0;
  let backdrop = null;
  let resultShown = false;
  let lastScore = 0;
  let textCache = {};
  let slotCache = [];
  let shownPopular = "";
  let shownNext = "";
  let messageState = null;
  let lastOutcome = null;
  let lastResults = null;
  let pauseReasonKey = "pauseReason";
  let linkNoticeKey = "";
  let shareStatusKey = "";

  function now() {
    return window.performance.now();
  }

  function reducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (error) {
      return false;
    }
  }

  function ingredientName(id) {
    const item = Core.ingredientById(id);
    return i18n.language() === "en" ? item.nameEn : item.name;
  }

  function seconds(ms) {
    return (ms / 1000).toFixed(1) + t("seconds");
  }

  // The PERFECT width in words, next to the number: wider or narrower than usual.
  function perfectTag(item) {
    return t(item.perfectMs > Core.PERFECT_WINDOW_MS ? "perfectWide" : item.perfectMs < Core.PERFECT_WINDOW_MS ? "perfectNarrow" : "perfectWidth");
  }

  function ingredientLabel(item) {
    return t("ingredientLabel", {
      name: ingredientName(item.id), time: seconds(item.idealMs), base: item.base,
      window: seconds(item.perfectMs),
      level: item.level ? " · " + t(item.id === "shiitake" ? "beginner" : "expert") : ""
    });
  }

  function challengeLabel() {
    return t("challenge", { version: Core.CHALLENGE_VERSION, seed });
  }

  // textContent only, and only when the value changed.
  function setText(key, node, value) {
    const text = String(value);
    if (textCache[key] !== text) {
      textCache[key] = text;
      node.textContent = text;
    }
  }

  function later(fn, ms) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function clearTimers() {
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
  }

  // ---- sound ------------------------------------------------------------

  // One AudioContext with two buses: sound effects and the BGM loop. Each has
  // its own mute and volume. The BGM has no timer of its own: pump() polls
  // tickBgm() from the single frame loop, so it can only ever run once.
  const audio = (function () {
    let ctx = null;
    let seBus = null;
    let bgmBus = null;
    let settings = Object.assign({}, Core.DEFAULT_AUDIO);
    let voices = [];
    const seq = Core.createBgmSequencer();

    function settle(promise) {
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
    }

    function busLevel(channel) {
      const volume = settings[channel + "Volume"] / Core.VOLUME_MAX;
      return settings[channel + "Muted"] ? 0 : volume * volume;
    }

    function silent() {
      return settings.seMuted && settings.bgmMuted;
    }

    function drop() {
      seq.stop();
      voices = [];
      ctx = null;
      seBus = null;
      bgmBus = null;
    }

    // Only called from click/submit/keydown handlers, never at load.
    function unlock() {
      if (silent()) {
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        return;
      }
      try {
        if (!ctx) {
          ctx = new Ctor();
          seBus = ctx.createGain();
          bgmBus = ctx.createGain();
          seBus.gain.value = busLevel("se");
          bgmBus.gain.value = busLevel("bgm");
          seBus.connect(ctx.destination);
          bgmBus.connect(ctx.destination);
        }
        if (ctx.state === "suspended") {
          settle(ctx.resume());
        }
      } catch (error) {
        close();
      }
    }

    function voice(bus, freq, start, duration, type, volume, slideTo) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      if (slideTo) {
        osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(bus);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(start);
      osc.stop(start + duration + 0.02);
      return { osc, endAt: start + duration + 0.02 };
    }

    function tone(freq, delay, duration, type, volume, slideTo) {
      voice(seBus, freq, ctx.currentTime + delay, duration, type, volume, slideTo);
    }

    const sounds = {
      place: () => tone(330, 0, 0.09, "triangle", 0.12, 440),
      good: () => tone(587, 0, 0.14, "triangle", 0.14),
      perfect: () => {
        tone(659, 0, 0.12, "triangle", 0.15);
        tone(988, 0.09, 0.2, "triangle", 0.15);
      },
      raw: () => tone(196, 0, 0.16, "sine", 0.14, 147),
      burn: () => tone(150, 0, 0.3, "sawtooth", 0.07, 70),
      phase: () => {
        tone(523, 0, 0.1, "sine", 0.1);
        tone(784, 0.1, 0.14, "sine", 0.1);
      },
      end: () => {
        [523, 659, 784, 1047].forEach((freq, i) => tone(freq, i * 0.12, 0.22, "triangle", 0.13));
      },
    };

    function play(name) {
      if (settings.seMuted || !ctx || ctx.state === "closed") {
        return;
      }
      try {
        sounds[name]();
      } catch (error) {
        // sound is optional
      }
    }

    function bgmNote(hz, melody, at) {
      voices.push(voice(bgmBus, hz, at, melody ? 0.2 : 0.24, melody ? "square" : "triangle", melody ? 0.05 : 0.11));
    }

    // Silences every BGM note that is sounding or already scheduled. The bus
    // dips for a moment so nothing clicks; new notes start after the dip.
    function cutVoices() {
      const cut = voices;
      voices = [];
      if (!ctx || ctx.state === "closed" || cut.length === 0) {
        return;
      }
      try {
        const at = ctx.currentTime;
        bgmBus.gain.cancelScheduledValues(at);
        bgmBus.gain.setTargetAtTime(0, at, 0.01);
        bgmBus.gain.setTargetAtTime(busLevel("bgm"), at + 0.07, 0.01);
        for (const item of cut) {
          item.osc.stop(at + 0.06);
        }
      } catch (error) {
        // sound is optional
      }
    }

    // Hands the notes that are due to the audio clock. Called every frame.
    function tickBgm() {
      if (!seq.playing || !ctx || ctx.state !== "running") {
        return;
      }
      try {
        const at = ctx.currentTime;
        voices = voices.filter((item) => item.endAt > at);
        for (const note of seq.due(at)) {
          bgmNote(note.hz, note.voice === "melody", note.atSec);
        }
      } catch (error) {
        // sound is optional
      }
    }

    // fromTop: a new round starts the tune again; a resume carries on.
    function startBgm(fromTop) {
      if (fromTop) {
        seq.stop();
        seq.reset();
      }
      if (settings.bgmMuted || !ctx || ctx.state === "closed" || seq.playing) {
        return;
      }
      cutVoices();
      seq.start(ctx.currentTime);
      tickBgm();
    }

    function stopBgm() {
      seq.stop();
      cutVoices();
    }

    // One bar, once, so the BGM volume can be judged while nothing is playing.
    function previewBgm() {
      if (settings.bgmMuted || !ctx || ctx.state === "closed" || seq.playing) {
        return;
      }
      cutVoices();
      try {
        for (let step = 0; step < 8; step += 1) {
          const at = ctx.currentTime + 0.1 + step * Core.BGM.stepSec;
          for (const name of ["melody", "bass"]) {
            const midi = Core.BGM[name][step];
            if (midi) {
              bgmNote(Core.midiToHz(midi), name === "melody", at);
            }
          }
        }
      } catch (error) {
        // sound is optional
      }
    }

    function suspend() {
      if (ctx && ctx.state === "running") {
        settle(ctx.suspend());
      }
    }

    function resume() {
      if (!silent() && ctx && ctx.state === "suspended") {
        settle(ctx.resume());
      }
    }

    function close() {
      const closing = ctx;
      drop();
      if (closing) {
        try {
          settle(closing.close());
        } catch (error) {
          // already closed
        }
      }
    }

    function setSettings(next) {
      settings = Object.assign({}, next);
      if (settings.bgmMuted) {
        stopBgm();
      }
      if (ctx && ctx.state !== "closed") {
        try {
          const at = ctx.currentTime;
          seBus.gain.cancelScheduledValues(at);
          seBus.gain.setTargetAtTime(busLevel("se"), at, 0.02);
          bgmBus.gain.cancelScheduledValues(at);
          bgmBus.gain.setTargetAtTime(busLevel("bgm"), at, 0.02);
        } catch (error) {
          // sound is optional
        }
      }
      if (silent()) {
        suspend();
      }
    }

    return {
      unlock,
      play,
      startBgm,
      stopBgm,
      tickBgm,
      previewBgm,
      suspend,
      resume,
      close,
      setSettings,
      settings: () => Object.assign({}, settings),
    };
  })();

  function renderSound() {
    const settings = audio.settings();
    for (const channel of ["se", "bgm"]) {
      const parts = soundEls[channel];
      const muted = settings[channel + "Muted"];
      const volume = settings[channel + "Volume"];
      parts.toggle.setAttribute("aria-pressed", muted ? "false" : "true");
      parts.toggle.classList.toggle("is-off", muted);
      setText(channel + "Toggle", parts.toggle, t(muted ? "off" : "on"));
      setText(channel + "Level", parts.level, volume + "/" + Core.VOLUME_MAX);
      parts.down.disabled = volume <= 1;
      parts.up.disabled = volume >= Core.VOLUME_MAX;
    }
    const state =
      t(settings.seMuted && settings.bgmMuted ? "soundNone" : settings.seMuted ? "soundBgm" : settings.bgmMuted ? "soundSe" : "soundBoth");
    el.soundButton.setAttribute("aria-label", t("soundAria", { state }));
    el.soundButton.classList.toggle("is-muted", settings.seMuted && settings.bgmMuted);
    setText("sound", el.soundText, state);
  }

  // ---- layout and static art ------------------------------------------------

  function relativeRect(node, origin) {
    const r = node.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  }

  function sizeCanvas(canvas, ctx) {
    canvas.width = Math.max(1, Math.round(view.w * view.dpr));
    canvas.height = Math.max(1, Math.round(view.h * view.dpr));
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  function drawIcon(canvas, id, cssSize) {
    const ctx = canvas.getContext("2d");
    canvas.width = Math.round(cssSize * view.dpr);
    canvas.height = Math.round(cssSize * view.dpr);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);
    if (id) {
      Art.drawFood(ctx, id, cssSize / 2, cssSize * 0.46, cssSize * 0.98, { doneness: 1 });
    }
  }

  function drawStaticIcons() {
    for (const item of Core.INGREDIENTS) {
      drawIcon(ingEls[item.id].icon, item.id, 52);
    }
    drawIcon(el.popularIcon, shownPopular, 48);
    drawIcon(el.nextIcon, shownNext, 28);
  }

  // Re-measures the DOM and repaints the cached garden. Never touches game state.
  function layout() {
    const origin = el.app.getBoundingClientRect();
    view.w = Math.max(1, origin.width);
    view.h = Math.max(1, origin.height);
    view.dpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
    view.slots = slotEls.map((node) => relativeRect(node, origin));
    view.grill = relativeRect(el.grill, origin);
    const plate = relativeRect(el.scoreCard, origin);
    view.plate = { x: plate.x + plate.w / 2, y: plate.y + plate.h / 2 };

    sizeCanvas(el.scene, sceneCtx);
    sizeCanvas(el.fx, fxCtx);

    if (!backdrop) {
      backdrop = document.createElement("canvas");
    }
    backdrop.width = el.scene.width;
    backdrop.height = el.scene.height;
    const ctx = backdrop.getContext("2d");
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    Art.drawBackdrop(ctx, view.w, view.h);
    Art.drawGrill(ctx, view.grill, view.slots);

    drawStaticIcons();
  }

  // ---- effects ----------------------------------------------------------------

  function slotCenter(index) {
    const r = view.slots[index];
    return { x: r.x + r.w / 2, y: r.y + r.h * 0.46, size: Math.min(r.w, r.h) * 0.78 };
  }

  function burst(index, color, count) {
    if (reducedMotion()) {
      return;
    }
    const c = slotCenter(index);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      particles.add({
        kind: "spark",
        x: c.x,
        y: c.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 380 + Math.random() * 260,
        size: 2 + Math.random() * 2.5,
        color,
      });
    }
  }

  function puff(index, dark, count) {
    if (reducedMotion()) {
      return;
    }
    const c = slotCenter(index);
    for (let i = 0; i < count; i += 1) {
      particles.add({
        kind: dark ? "smoke" : "steam",
        x: c.x + (Math.random() - 0.5) * c.size * 0.5,
        y: c.y - c.size * 0.1,
        vx: (Math.random() - 0.5) * 16,
        vy: -(26 + Math.random() * 22),
        life: 700 + Math.random() * 500,
        size: 5 + Math.random() * 5,
      });
    }
  }

  function popup(index, grade, text, sub) {
    const c = slotCenter(index);
    popups.add({
      kind: "pop",
      x: Math.min(view.w - 70, Math.max(70, c.x)),
      y: c.y - c.size * 0.35,
      life: 950,
      text,
      sub: sub || "",
      color: GRADE_POP[grade].color,
    });
  }

  function flyToPlate(index, id, doneness) {
    if (reducedMotion()) {
      return;
    }
    const c = slotCenter(index);
    popups.add({
      kind: "fly",
      x: c.x,
      y: c.y,
      toX: view.plate.x,
      toY: view.plate.y,
      life: 420,
      size: c.size,
      id,
      doneness,
    });
  }

  function emitSteam(snap, dtMs) {
    if (!snap || snap.status !== "running" || reducedMotion()) {
      return;
    }
    snap.slots.forEach((food, index) => {
      if (!food || food.stage === "raw") {
        return;
      }
      const perSecond = food.stage === "burnt" ? 2.4 : 2.8;
      if (Math.random() < (perSecond * dtMs) / 1000) {
        puff(index, food.stage === "burnt", 1);
      }
    });
  }

  function stepEffects(dtMs) {
    const dt = dtMs / 1000;
    particles.update(dtMs, (p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "spark") {
        p.vy += 320 * dt;
      } else {
        p.size += 9 * dt;
      }
    });
    popups.update(dtMs);
  }

  function drawEffects() {
    const ctx = fxCtx;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    const still = reducedMotion();

    for (const p of particles.items) {
      const k = p.age / p.life;
      if (p.kind === "spark") {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 1 - k;
      } else {
        ctx.fillStyle = p.kind === "smoke" ? "#3a3432" : "#fffdf5";
        ctx.globalAlpha = (1 - k) * (p.kind === "smoke" ? 0.42 : 0.34);
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const p of popups.items) {
      const k = p.age / p.life;
      if (p.kind === "fly") {
        const ease = k * k * (3 - 2 * k);
        const x = p.x + (p.toX - p.x) * ease;
        const y = p.y + (p.toY - p.y) * ease - Math.sin(Math.PI * k) * 46;
        ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
        Art.drawFood(ctx, p.id, x, y, p.size * (1 - 0.6 * ease), { doneness: p.doneness, shadow: false });
        ctx.globalAlpha = 1;
        continue;
      }
      const y = p.y - (still ? 0 : 34 * k);
      ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.font = "900 19px system-ui, sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#2b2623";
      ctx.strokeText(p.text, p.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
      if (p.sub) {
        ctx.font = "800 13px system-ui, sans-serif";
        ctx.lineWidth = 4;
        ctx.strokeText(p.sub, p.x, y + 19);
        ctx.fillStyle = "#fff6e0";
        ctx.fillText(p.sub, p.x, y + 19);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- drawing ------------------------------------------------------------------

  function drawScene(snap, ts) {
    const ctx = sceneCtx;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    if (backdrop) {
      ctx.drawImage(backdrop, 0, 0, view.w, view.h);
    }
    if (!view.grill) {
      return;
    }
    Art.drawEmberGlow(ctx, view.grill, reducedMotion() ? 0.5 : 0.5 + 0.5 * Math.sin(ts / 280));
    if (!snap) {
      return;
    }
    snap.slots.forEach((food, index) => {
      if (!food) {
        return;
      }
      const rect = view.slots[index];
      const c = slotCenter(index);
      const item = Core.ingredientById(food.id);
      Art.drawFood(ctx, food.id, c.x, c.y, c.size, { doneness: food.ageMs / item.idealMs, burnt: food.burnt });
      const barW = Math.max(24, rect.w - 20);
      Art.drawTimingBar(ctx, rect.x + (rect.w - barW) / 2, rect.y + rect.h - 17, barW, 8, Core.windowsFor(food.id), food.ageMs);
    });
  }

  // ---- DOM updates ------------------------------------------------------------------

  function updateSlots(snap) {
    for (let i = 0; i < Core.SLOT_COUNT; i += 1) {
      const food = snap ? snap.slots[i] : null;
      const key = food ? food.id + "|" + food.stage : "empty|" + selected;
      if (slotCache[i] === key) {
        continue;
      }
      slotCache[i] = key;
      const slot = slotEls[i];
      if (!food) {
        slot.className = "slot is-empty";
        slot.setAttribute("aria-label", t("slotEmpty", { slot: i + 1, name: ingredientName(selected) }));
        badgeEls[i].hidden = true;
        plusEls[i].hidden = false;
        continue;
      }
      const ui = STAGE_UI[food.stage];
      slot.className = "slot " + ui.cls;
      slot.setAttribute("aria-label", t("slotFood", { slot: i + 1, name: ingredientName(food.id), stage: ui.sayKey ? t(ui.sayKey) : ui.say }));
      badgeEls[i].textContent = ui.badgeKey ? t(ui.badgeKey) : ui.badge;
      badgeEls[i].hidden = false;
      plusEls[i].hidden = true;
    }
  }

  function updateTray(popularId) {
    for (const item of Core.INGREDIENTS) {
      const parts = ingEls[item.id];
      const isSelected = item.id === selected;
      const isPopular = item.id === popularId;
      parts.button.setAttribute("aria-pressed", isSelected ? "true" : "false");
      parts.button.setAttribute("aria-label", ingredientLabel(item) + (isPopular ? t("trayPopular", { bonus: Core.POPULAR_BONUS }) : ""));
      parts.button.classList.toggle("is-selected", isSelected);
      parts.button.classList.toggle("is-popular", isPopular);
      parts.pop.hidden = !isPopular;
    }
  }

  // "同じ名前は1人" is decided in core; this only paints the stored top three.
  function renderRanking() {
    const top = store.top(Core.RANK_SHOWN);
    for (const board of Object.keys(rankEls)) {
      rankEls[board].forEach((parts, i) => {
        const player = top[i];
        const shared = player && player.guest && board !== "hudRank" ? t("sharedGuest") : "";
        setText(board + "Name" + i, parts.name, player ? displayName(player.name) + shared : "—");
        setText(board + "Score" + i, parts.score, player ? player.best + t("points") : "");
        parts.row.classList.toggle("is-empty", !player);
        parts.row.classList.toggle("is-me", Boolean(player) && board !== "startRank" && player.name === nickname);
      });
    }
  }

  function updateHud(snap) {
    const remainingMs = snap ? snap.remainingMs : Core.GAME_MS;
    setText("time", el.hudTime, Math.ceil(remainingMs / 1000));
    const fill = (remainingMs / Core.GAME_MS).toFixed(3);
    if (textCache.timeFill !== fill) {
      textCache.timeFill = fill;
      el.hudTimeBar.style.transform = "scaleX(" + fill + ")";
    }
    el.timeCard.classList.toggle("is-urgent", Boolean(snap) && snap.status !== "ready" && remainingMs <= URGENT_MS);
    setText("score", el.hudScore, snap ? snap.score : 0);
    setText("combo", el.hudCombo, snap ? snap.combo : 0);
    setText("mult", el.hudMult, "x" + ((snap ? snap.multiplierTenths : 10) / 10).toFixed(1));

    const popular = snap ? snap.popular : Core.popularAt(Core.buildSchedule(seed), 0);
    const next = popular.showNext ? popular.next : "";
    setText("popularName", el.popularName, ingredientName(popular.current));
    setText("popularCountdown", el.popularCountdown, t("countdown", { seconds: Math.ceil(popular.msToNext / 1000) }));
    setText("nextName", el.nextName, next ? ingredientName(next) : "");
    el.nextWrap.classList.toggle("is-visible", Boolean(next));
    if (shownPopular !== popular.current) {
      shownPopular = popular.current;
      drawIcon(el.popularIcon, shownPopular, 48);
      updateTray(shownPopular);
    }
    if (shownNext !== next) {
      shownNext = next;
      drawIcon(el.nextIcon, shownNext, 28);
    }
  }

  function displayName(name) {
    return name === Core.DEFAULT_NICKNAME ? t("guest") : name;
  }
  function say(message) {
    messageState = null;
    textCache.status = message;
    el.statusLine.textContent = message;
  }
  function sayKey(key, values) {
    messageState = { key, values };
    el.statusLine.textContent = t(key, values);
  }

  // ---- frame loop -------------------------------------------------------------------

  function stopLoop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function startLoop() {
    if (!rafId && game && game.status === "running") {
      rafId = window.requestAnimationFrame(frame);
    }
  }

  function frame(ts) {
    rafId = 0;
    pump(ts);
    startLoop();
  }

  function handleEvent(event) {
    if (event.type === "burn") {
      puff(event.slot, true, 6);
      popup(event.slot, "BURNT", GRADE_POP.BURNT.mark, t("comboEnd"));
      audio.play("burn");
      sayKey("burnStatus", { name: ingredientName(event.ingredient), ingredient: event.ingredient });
    } else if (event.type === "phase") {
      audio.play("phase");
      sayKey("popularStatus", { name: ingredientName(event.ingredient), ingredient: event.ingredient });
    }
  }

  // Syncs the core to the clock, reacts to what happened, then repaints.
  // Frame timing only drives the visual effects (dt), never the rules.
  function pump(ts) {
    const dtMs = lastFrameTs ? Math.min(100, Math.max(0, ts - lastFrameTs)) : 0;
    lastFrameTs = ts;
    let snap = null;
    let ended = false;
    if (game) {
      snap = game.snapshot();
      for (const event of game.drainEvents()) {
        if (event.type === "end") {
          ended = true;
        } else {
          handleEvent(event);
        }
      }
    }
    updateHud(snap);
    updateSlots(snap);
    emitSteam(snap, dtMs);
    stepEffects(dtMs);
    drawScene(snap, ts);
    drawEffects();
    if (snap && snap.status === "running") {
      audio.tickBgm();
    }
    if (ended) {
      finishGame();
    }
  }

  // ---- screens ----------------------------------------------------------------------

  function setGameInert(inert) {
    el.gameArea.inert = inert;
    if (inert) {
      el.gameArea.setAttribute("aria-hidden", "true");
    } else {
      el.gameArea.removeAttribute("aria-hidden");
    }
  }

  function showScreen(name) {
    el.screenStart.hidden = name !== "start";
    el.pauseOverlay.hidden = name !== "pause";
    el.screenResult.hidden = name !== "result";
    setGameInert(name !== "game");
    setSoundOpen(false);
  }

  // The sound panel sits on top of whichever card is showing.
  function setSoundOpen(open) {
    el.soundOverlay.hidden = !open;
    el.screenStart.inert = open;
    el.pauseOverlay.inert = open;
    el.screenResult.inert = open;
  }

  // Opening it mid-game pauses first, so closing it lands on the pause card
  // and play only continues from the resume button.
  function openSound() {
    if (game && game.status === "running") {
      pauseGame("manual");
    }
    renderSound();
    setSoundOpen(true);
    el.soundCloseButton.focus();
  }

  function closeSound() {
    if (el.soundOverlay.hidden) {
      return;
    }
    setSoundOpen(false);
    if (!el.pauseOverlay.hidden) {
      el.pauseSoundButton.focus();
    } else if (!el.screenStart.hidden) {
      el.startSoundButton.focus();
    }
  }

  // Saves first, then applies. Runs from a tap, so it may open the audio
  // context and play a short sample of the channel that changed.
  function changeSound(channel, patch) {
    const next = store.saveAudio(Object.assign(audio.settings(), patch));
    audio.setSettings(next);
    renderSound();
    audio.unlock();
    if (channel === "se") {
      audio.play("good");
    } else {
      audio.previewBgm();
    }
  }

  function hideShareFallback() {
    shareStatusKey = "";
    el.shareFallback.hidden = true;
    el.shareFallbackText.value = "";
    setText("shareStatus", el.shareStatus, "");
  }

  // Drops everything that belongs to the previous round.
  function teardown() {
    stopLoop();
    clearTimers();
    audio.stopBgm();
    particles.clear();
    popups.clear();
    if (game) {
      game.dispose();
      game = null;
    }
    resultShown = false;
    lastFrameTs = 0;
    slotCache = [];
    shownPopular = "";
    shownNext = "";
    hideShareFallback();
    say("");
  }

  function renderChallengeInfo() {
    setText("challengeInfo", el.challengeInfo, challengeLabel());
  }

  function syncHash() {
    try {
      window.history.replaceState(null, "", Core.buildChallengeHash(seed));
    } catch (error) {
      // file:// pages or sandboxed frames may refuse; the share link still works
    }
  }

  function newSeed() {
    return Core.randomSeed(() => {
      const box = new Uint32Array(1);
      window.crypto.getRandomValues(box);
      return box[0];
    });
  }

  function showStart() {
    teardown();
    // A v1 best has no name attached, so it is shown apart and never ranked.
    const legacyBest = store.load().legacyBest;
    setText(
      "startLegacy",
      el.startLegacy,
      legacyBest > 0 ? t("legacyBest", { score: legacyBest }) : ""
    );
    el.startLegacy.hidden = legacyBest <= 0;
    renderRanking();
    renderChallengeInfo();
    showScreen("start");
    pump(now());
  }

  function startGame() {
    teardown();
    selected = Core.INGREDIENT_IDS[0];
    game = Core.createGame({ seed, now });
    game.select(selected);
    setText("player", el.hudPlayer, displayName(nickname));
    renderRanking();
    renderChallengeInfo();
    syncHash();
    showScreen("game");
    layout();
    game.start();
    audio.startBgm(true);
    sayKey("startStatus");
    pump(now());
    startLoop();
    slotEls[0].focus();
  }

  function finishGame() {
    if (!game || resultShown) {
      return;
    }
    resultShown = true;
    stopLoop();
    clearTimers();
    particles.clear();
    popups.clear();
    drawEffects();

    const results = game.results();
    lastScore = results.score;
    const outcome = store.recordScore(nickname, results.score);
    lastOutcome = outcome;
    lastResults = results;
    setText("resultNickname", el.resultNickname, displayName(nickname));
    setText("resultScore", el.resultScore, results.score);
    setText("resultPerfect", el.resultPerfect, results.perfectCount);
    setText("resultBurned", el.resultBurned, results.burnedCount);
    setText("resultMaxCombo", el.resultMaxCombo, results.maxCombo);
    renderResultBest();
    setText("resultSeed", el.resultSeed, challengeLabel());
    el.resultNewBest.hidden = !outcome.isNewBest;
    el.resultSaveNote.hidden = !outcome.isNewBest || outcome.persisted;
    renderRanking();
    sayKey("endStatus", { score: results.score });
    audio.stopBgm();
    audio.play("end");
    showScreen("result");
    el.retryButton.focus();
  }

  function pauseGame(reason) {
    if (!game) {
      return;
    }
    const paused = game.pause();
    pump(now());
    if (!paused) {
      return;
    }
    stopLoop();
    audio.stopBgm();
    audio.suspend();
    pauseReasonKey = reason === "hidden" ? "hiddenReason" : "pauseReason";
    setText("pauseReason", el.pauseReason, t(pauseReasonKey));
    showScreen("pause");
    el.resumeButton.focus();
  }

  // Only ever called from the resume button: returning to the tab is not enough.
  function resumeGame() {
    if (!game || !game.resume()) {
      return;
    }
    audio.unlock();
    audio.resume();
    audio.startBgm(false);
    showScreen("game");
    lastFrameTs = 0;
    pump(now());
    startLoop();
    slotEls[0].focus();
  }

  // ---- input ------------------------------------------------------------------------

  function selectIngredient(id) {
    if (!Core.ingredientById(id)) {
      return;
    }
    selected = id;
    if (game) {
      game.select(id);
    }
    slotCache = [];
    updateTray(shownPopular);
    if (game && game.status === "running") {
      sayKey("selectedStatus", { name: ingredientName(id), ingredient: id });
    }
    pump(now());
  }

  function onSlot(index) {
    if (!game) {
      return;
    }
    audio.unlock();
    const result = game.tapSlot(index);
    if (result.type === "placed") {
      audio.play("place");
      sayKey("placedStatus", { name: ingredientName(result.ingredient), ingredient: result.ingredient });
    } else if (result.type === "collected") {
      const name = ingredientName(result.ingredient);
      const pop = GRADE_POP[result.grade];
      if (result.grade === "PERFECT" || result.grade === "GOOD") {
        const sub = "x" + (result.multiplierTenths / 10).toFixed(1) + (result.bonus ? t("popupPopular", { bonus: result.bonus }) : "");
        popup(index, result.grade, pop.mark + " +" + result.points, sub);
        flyToPlate(index, result.ingredient, result.ageMs / Core.ingredientById(result.ingredient).idealMs);
        burst(index, pop.color, result.grade === "PERFECT" ? 12 : 5);
        audio.play(result.grade === "PERFECT" ? "perfect" : "good");
        sayKey("collectedStatus", { name, ingredient: result.ingredient, grade: result.grade, points: result.points });
      } else if (result.grade === "RAW") {
        popup(index, "RAW", pop.mark + " 0", t("comboEnd"));
        audio.play("raw");
        sayKey("rawStatus", { name, ingredient: result.ingredient });
      } else {
        popup(index, "BURNT", pop.mark + " 0", "");
        sayKey("clearedStatus", { name, ingredient: result.ingredient });
      }
    }
    pump(now());
  }

  function onStartSubmit(event) {
    event.preventDefault();
    const result = Core.normalizeNickname(el.nicknameInput.value);
    if (!result.ok) {
      el.nicknameError.textContent = t("nicknameError", { max: Core.NICKNAME_MAX });
      el.nicknameError.hidden = false;
      el.nicknameInput.setAttribute("aria-invalid", "true");
      el.nicknameInput.focus();
      return;
    }
    clearNicknameError();
    nickname = result.value;
    store.saveNickname(result.isGuest ? "" : result.value);
    audio.unlock();
    startGame();
  }

  function clearNicknameError() {
    el.nicknameError.hidden = true;
    el.nicknameError.textContent = "";
    el.nicknameInput.removeAttribute("aria-invalid");
  }

  function onShare() {
    const url = Core.buildChallengeUrl(window.location.href, seed);
    const text = t("shareText", { score: lastScore });
    hideShareFallback();
    Core.shareChallenge({ nav: window.navigator, title: "BBQ Party", text, url }).then((outcome) => {
      if (outcome.method === "clipboard") {
        shareStatusKey = "copied";
        setText("shareStatus", el.shareStatus, t(shareStatusKey));
        later(() => { shareStatusKey = ""; setText("shareStatus", el.shareStatus, ""); }, 4000);
      } else if (outcome.method === "fallback") {
        el.shareFallbackText.value = url;
        el.shareFallback.hidden = false;
        el.shareFallbackText.focus();
        el.shareFallbackText.select();
      }
    });
  }

  function onKeydown(event) {
    if (event.key === "Escape" && !el.soundOverlay.hidden) {
      closeSound();
      return;
    }
    if (!game || game.status !== "running" || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const index = Core.INGREDIENT_IDS.map((id, i) => String(i + 1)).indexOf(event.key);
    if (index !== -1) {
      selectIngredient(Core.INGREDIENT_IDS[index]);
    } else if (event.key === "Escape" || event.key === "p" || event.key === "P") {
      pauseGame("manual");
    }
  }

  function renderIngredientText() {
    for (const item of Core.INGREDIENTS) {
      ingEls[item.id].name.textContent = i18n.language() === "en" ? (item.id === "steak" ? "Steak" : item.id === "kalbi" ? "Kalbi" : item.nameEn) : item.short;
      ingEls[item.id].meta.textContent = seconds(item.idealMs) + t("separator") + item.base + t("points");
      ingEls[item.id].window.textContent = perfectTag(item) + " " + seconds(item.perfectMs);
    }
  }
  function renderResultBest() {
    if (!lastOutcome || !lastResults) return;
    const outcome = lastOutcome;
    setText("resultBest", el.resultBest, outcome.rank > 0
      ? t("personalBest", { name: displayName(nickname), score: outcome.best, rank: outcome.rank })
      : lastResults.score > 0 ? t("outsideLocal", { count: Core.MAX_PLAYERS }) : t("zeroLocal"));
  }
  function changeLanguage() {
    i18n.setLanguage(i18n.language() === "ja" ? "en" : "ja");
    textCache = {};
    slotCache = [];
    popups.clear();
    i18n.applyStatic(document);
    renderIngredientText();
    renderSound();
    renderRanking();
    renderChallengeInfo();
    renderResultBest();
    const legacyBest = store.load().legacyBest;
    setText("startLegacy", el.startLegacy, legacyBest > 0 ? t("legacyBest", { score: legacyBest }) : "");
    setText("player", el.hudPlayer, displayName(nickname));
    setText("resultNickname", el.resultNickname, displayName(nickname));
    setText("resultSeed", el.resultSeed, challengeLabel());
    setText("pauseReason", el.pauseReason, t(pauseReasonKey));
    if (linkNoticeKey) el.linkNotice.textContent = t(linkNoticeKey);
    if (!el.nicknameError.hidden) el.nicknameError.textContent = t("nicknameError", { max: Core.NICKNAME_MAX });
    if (shareStatusKey) setText("shareStatus", el.shareStatus, t(shareStatusKey));
    if (messageState) {
      const values = Object.assign({}, messageState.values);
      if (values.ingredient) values.name = ingredientName(values.ingredient);
      el.statusLine.textContent = t(messageState.key, values);
    }
    updateTray(shownPopular);
    // Repaint only: no clock, seed, recording or audio restart.
    layout();
    pump(now());
  }

  function bind() {
    for (const id of i18n.buttons) $(id).addEventListener("click", changeLanguage);
    el.startForm.addEventListener("submit", onStartSubmit);
    el.nicknameInput.addEventListener("input", clearNicknameError);
    slotEls.forEach((slot, index) => slot.addEventListener("click", () => onSlot(index)));
    for (const item of Core.INGREDIENTS) {
      ingEls[item.id].button.addEventListener("click", () => selectIngredient(item.id));
    }
    for (const opener of [el.soundButton, el.startSoundButton, el.pauseSoundButton]) {
      opener.addEventListener("click", openSound);
    }
    el.soundCloseButton.addEventListener("click", closeSound);
    for (const channel of ["se", "bgm"]) {
      const parts = soundEls[channel];
      const volume = () => audio.settings()[channel + "Volume"];
      parts.toggle.addEventListener("click", () => {
        changeSound(channel, { [channel + "Muted"]: !audio.settings()[channel + "Muted"] });
      });
      parts.down.addEventListener("click", () => changeSound(channel, { [channel + "Volume"]: Math.max(1, volume() - 1) }));
      parts.up.addEventListener("click", () => {
        changeSound(channel, { [channel + "Volume"]: Math.min(Core.VOLUME_MAX, volume() + 1) });
      });
    }
    el.pauseButton.addEventListener("click", () => pauseGame("manual"));
    el.resumeButton.addEventListener("click", resumeGame);
    el.retryButton.addEventListener("click", () => {
      audio.unlock();
      startGame();
    });
    el.newChallengeButton.addEventListener("click", () => {
      seed = newSeed();
      el.linkNotice.hidden = true;
      audio.unlock();
      startGame();
    });
    el.titleButton.addEventListener("click", () => {
      showStart();
      el.nicknameInput.focus();
    });
    el.shareButton.addEventListener("click", onShare);

    // Fast taps, double clicks and drags must not select or drag game text.
    // Form fields (nickname, the share link to copy) keep normal selection.
    const keepGameUnselected = (event) => {
      const tag = event.target && event.target.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        event.preventDefault();
      }
    };
    el.app.addEventListener("selectstart", keepGameUnselected);
    el.app.addEventListener("dragstart", keepGameUnselected);

    document.addEventListener("keydown", onKeydown);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || document.visibilityState === "hidden") {
        pauseGame("hidden");
        audio.stopBgm();
        audio.suspend();
      }
    });
    window.addEventListener("pagehide", () => {
      pauseGame("hidden");
      audio.close();
    });
    const relayout = () => {
      layout();
      pump(now());
    };
    window.addEventListener("resize", relayout);
    window.addEventListener("orientationchange", relayout);
    if (typeof window.ResizeObserver === "function") {
      new window.ResizeObserver(relayout).observe(el.grill);
    }
  }

  function init() {
    i18n.applyStatic(document);
    renderIngredientText();

    const record = store.load();
    audio.setSettings(record.audio);
    renderSound();
    el.nicknameInput.value = record.nickname;

    // A v1 link is never replayed: with six ingredients its seed would pick a
    // different popular order, so the player is told and gets a new challenge.
    const link = Core.parseChallengeHash(window.location.hash);
    if (link.ok) {
      seed = link.seed;
      linkNoticeKey = "linkChallenge";
      el.linkNotice.textContent = t(linkNoticeKey);
      el.linkNotice.hidden = false;
    } else {
      seed = newSeed();
      if (link.reason === "legacy") {
        linkNoticeKey = "linkLegacy";
        el.linkNotice.textContent = t(linkNoticeKey);
        el.linkNotice.hidden = false;
      } else if (link.reason !== "empty") {
        linkNoticeKey = "linkInvalid";
        el.linkNotice.textContent = t(linkNoticeKey);
        el.linkNotice.hidden = false;
      }
    }

    bind();
    layout();
    showStart();
  }

  init();
})();
