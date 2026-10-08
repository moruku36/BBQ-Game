// BBQ Party — browser wiring: DOM, Canvas rendering, sound and lifecycle.
// All rules live in core.js; this file only reads snapshots and reacts.
(function () {
  "use strict";

  const Core = window.BBQCore;
  const Art = window.BBQArt;
  if (!Core || !Art) {
    return;
  }

  const MAX_PARTICLES = 80;
  const MAX_POPUPS = 12;
  const MAX_DPR = 2;
  const URGENT_MS = 10000;

  const STAGE_UI = {
    raw: { badge: "○ 生", say: "まだ生", cls: "is-raw" },
    "good-early": { badge: "◆ GOOD", say: "GOOD", cls: "is-good" },
    perfect: { badge: "★ PERFECT", say: "PERFECT", cls: "is-perfect" },
    "good-late": { badge: "◇ GOOD 注意", say: "GOOD・もうすぐコゲる", cls: "is-late" },
    burnt: { badge: "✕ コゲ", say: "コゲた", cls: "is-burnt" },
  };
  const GRADE_POP = {
    PERFECT: { mark: "★ PERFECT", color: "#57b94f" },
    GOOD: { mark: "◆ GOOD", color: "#f7c531" },
    RAW: { mark: "○ 生", color: "#e8e0d0" },
    BURNT: { mark: "✕ コゲ", color: "#ff8a70" },
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"),
    scene: $("scene"),
    fx: $("fx"),
    gameArea: $("gameArea"),
    hudPlayer: $("hudPlayer"),
    muteButton: $("muteButton"),
    muteText: $("muteText"),
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
    challengeInfo: $("challengeInfo"),
    linkNotice: $("linkNotice"),
    startBest: $("startBest"),
    pauseOverlay: $("pauseOverlay"),
    pauseReason: $("pauseReason"),
    resumeButton: $("resumeButton"),
    screenResult: $("screenResult"),
    resultNickname: $("resultNickname"),
    resultScore: $("resultScore"),
    resultNewBest: $("resultNewBest"),
    resultPerfect: $("resultPerfect"),
    resultBurned: $("resultBurned"),
    resultMaxCombo: $("resultMaxCombo"),
    resultBest: $("resultBest"),
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
      pop: $("ingPop-" + item.id),
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
    return Core.ingredientById(id).name;
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

  const audio = (function () {
    let ctx = null;
    let muted = false;

    function settle(promise) {
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
    }

    // Only called from click/submit/keydown handlers, never at load.
    function unlock() {
      if (muted) {
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) {
        return;
      }
      try {
        if (!ctx) {
          ctx = new Ctor();
        }
        if (ctx.state === "suspended") {
          settle(ctx.resume());
        }
      } catch (error) {
        ctx = null;
      }
    }

    function tone(freq, delay, duration, type, volume, slideTo) {
      const start = ctx.currentTime + delay;
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
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(start);
      osc.stop(start + duration + 0.02);
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
      if (muted || !ctx || ctx.state === "closed") {
        return;
      }
      try {
        sounds[name]();
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
      if (!muted && ctx && ctx.state === "suspended") {
        settle(ctx.resume());
      }
    }

    function close() {
      if (ctx) {
        try {
          settle(ctx.close());
        } catch (error) {
          // already closed
        }
        ctx = null;
      }
    }

    function setMuted(value) {
      muted = value;
      if (muted) {
        suspend();
      }
    }

    return { unlock, play, suspend, resume, close, setMuted, isMuted: () => muted };
  })();

  function renderMute() {
    const muted = audio.isMuted();
    el.muteButton.setAttribute("aria-pressed", muted ? "true" : "false");
    el.muteButton.setAttribute("aria-label", muted ? "サウンド: オフ（押すとオン）" : "サウンド: オン（押すとミュート）");
    el.muteButton.classList.toggle("is-muted", muted);
    setText("mute", el.muteText, muted ? "音なし" : "音あり");
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
      Art.drawTimingBar(ctx, rect.x + (rect.w - barW) / 2, rect.y + rect.h - 17, barW, 8, Core.cookWindows(item.idealMs), food.ageMs);
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
        slot.setAttribute("aria-label", "網" + (i + 1) + ": 空き。押すと" + ingredientName(selected) + "を置く");
        badgeEls[i].hidden = true;
        plusEls[i].hidden = false;
        continue;
      }
      const ui = STAGE_UI[food.stage];
      slot.className = "slot " + ui.cls;
      slot.setAttribute("aria-label", "網" + (i + 1) + ": " + ingredientName(food.id) + "・" + ui.say + "。押すと回収");
      badgeEls[i].textContent = ui.badge;
      badgeEls[i].hidden = false;
      plusEls[i].hidden = true;
    }
  }

  function updateTray(popularId) {
    for (const item of Core.INGREDIENTS) {
      const parts = ingEls[item.id];
      const isSelected = item.id === selected;
      parts.button.setAttribute("aria-pressed", isSelected ? "true" : "false");
      parts.button.classList.toggle("is-selected", isSelected);
      parts.button.classList.toggle("is-popular", item.id === popularId);
      parts.pop.hidden = item.id !== popularId;
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
    setText("popularCountdown", el.popularCountdown, "あと" + Math.ceil(popular.msToNext / 1000) + "秒");
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

  function say(message) {
    textCache.status = message;
    el.statusLine.textContent = message;
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
      popup(event.slot, "BURNT", GRADE_POP.BURNT.mark, "コンボ終了");
      audio.play("burn");
      say(ingredientName(event.ingredient) + "がコゲた…コンボ終了");
    } else if (event.type === "phase") {
      audio.play("phase");
      say("人気が" + ingredientName(event.ingredient) + "に変わった！");
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
  }

  function hideShareFallback() {
    el.shareFallback.hidden = true;
    el.shareFallbackText.value = "";
    setText("shareStatus", el.shareStatus, "");
  }

  // Drops everything that belongs to the previous round.
  function teardown() {
    stopLoop();
    clearTimers();
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
    setText("challengeInfo", el.challengeInfo, "チャレンジ No. " + seed);
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
    const record = store.load();
    setText("startBest", el.startBest, "この端末のベスト: " + record.bestScore + "点");
    renderChallengeInfo();
    showScreen("start");
    pump(now());
  }

  function startGame() {
    teardown();
    selected = Core.INGREDIENT_IDS[0];
    game = Core.createGame({ seed, now });
    game.select(selected);
    setText("player", el.hudPlayer, nickname);
    renderChallengeInfo();
    syncHash();
    showScreen("game");
    layout();
    game.start();
    say("食材をえらんで、空いた網をタップ！");
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
    const best = store.saveBest(results.score);
    setText("resultNickname", el.resultNickname, nickname);
    setText("resultScore", el.resultScore, results.score);
    setText("resultPerfect", el.resultPerfect, results.perfectCount);
    setText("resultBurned", el.resultBurned, results.burnedCount);
    setText("resultMaxCombo", el.resultMaxCombo, results.maxCombo);
    setText("resultBest", el.resultBest, "この端末のベスト: " + best.bestScore + "点");
    setText("resultSeed", el.resultSeed, "チャレンジ No. " + seed);
    el.resultNewBest.hidden = !best.isNewBest;
    say("タイムアップ！スコア " + results.score + "点");
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
    audio.suspend();
    setText(
      "pauseReason",
      el.pauseReason,
      reason === "hidden" ? "画面をはなれたので止めました。タイマーも食材も止まっています。" : "タイマーも食材も止まっています。"
    );
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
      say(ingredientName(id) + "をえらんだ");
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
      say(ingredientName(result.ingredient) + "を置いた");
    } else if (result.type === "collected") {
      const name = ingredientName(result.ingredient);
      const pop = GRADE_POP[result.grade];
      if (result.grade === "PERFECT" || result.grade === "GOOD") {
        const sub = "x" + (result.multiplierTenths / 10).toFixed(1) + (result.bonus ? " ・人気+" + result.bonus : "");
        popup(index, result.grade, pop.mark + " +" + result.points, sub);
        flyToPlate(index, result.ingredient, result.ageMs / Core.ingredientById(result.ingredient).idealMs);
        burst(index, pop.color, result.grade === "PERFECT" ? 12 : 5);
        audio.play(result.grade === "PERFECT" ? "perfect" : "good");
        say(name + " " + result.grade + "！ +" + result.points + "点");
      } else if (result.grade === "RAW") {
        popup(index, "RAW", pop.mark + " 0", "コンボ終了");
        audio.play("raw");
        say(name + "はまだ生だった… 0点");
      } else {
        popup(index, "BURNT", pop.mark + " 0", "");
        say("コゲた" + name + "を片づけた");
      }
    }
    pump(now());
  }

  function onStartSubmit(event) {
    event.preventDefault();
    const result = Core.normalizeNickname(el.nicknameInput.value);
    if (!result.ok) {
      el.nicknameError.textContent = "ニックネームは" + Core.NICKNAME_MAX + "文字までにしてください。";
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
    const text = "BBQ Party で" + lastScore + "点！同じチャレンジで勝負しよう";
    hideShareFallback();
    Core.shareChallenge({ nav: window.navigator, title: "BBQ Party", text, url }).then((outcome) => {
      if (outcome.method === "clipboard") {
        setText("shareStatus", el.shareStatus, "リンクをコピーしました");
        later(() => setText("shareStatus", el.shareStatus, ""), 4000);
      } else if (outcome.method === "fallback") {
        el.shareFallbackText.value = url;
        el.shareFallback.hidden = false;
        el.shareFallbackText.focus();
        el.shareFallbackText.select();
      }
    });
  }

  function onKeydown(event) {
    if (!game || game.status !== "running" || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const index = ["1", "2", "3", "4"].indexOf(event.key);
    if (index !== -1) {
      selectIngredient(Core.INGREDIENT_IDS[index]);
    } else if (event.key === "Escape" || event.key === "p" || event.key === "P") {
      pauseGame("manual");
    }
  }

  function bind() {
    el.startForm.addEventListener("submit", onStartSubmit);
    el.nicknameInput.addEventListener("input", clearNicknameError);
    slotEls.forEach((slot, index) => slot.addEventListener("click", () => onSlot(index)));
    for (const item of Core.INGREDIENTS) {
      ingEls[item.id].button.addEventListener("click", () => selectIngredient(item.id));
    }
    el.muteButton.addEventListener("click", () => {
      const muted = !audio.isMuted();
      audio.setMuted(muted);
      store.saveMuted(muted);
      if (!muted && game && game.status === "running") {
        audio.unlock();
        audio.resume();
      }
      renderMute();
    });
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

    document.addEventListener("keydown", onKeydown);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || document.visibilityState === "hidden") {
        pauseGame("hidden");
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
    for (const item of Core.INGREDIENTS) {
      ingEls[item.id].name.textContent = item.name;
      ingEls[item.id].meta.textContent = (item.idealMs / 1000).toFixed(1) + "秒・" + item.base + "点";
    }

    const record = store.load();
    audio.setMuted(record.muted);
    renderMute();
    el.nicknameInput.value = record.nickname;

    const link = Core.parseChallengeHash(window.location.hash);
    if (link.ok) {
      seed = link.seed;
      el.linkNotice.textContent = "（リンクのチャレンジ）";
      el.linkNotice.hidden = false;
    } else {
      seed = newSeed();
      if (link.reason !== "empty") {
        el.linkNotice.textContent = "（リンクが正しくないため、新しいチャレンジにしました）";
        el.linkNotice.hidden = false;
      }
    }

    bind();
    layout();
    showStart();
  }

  init();
})();
