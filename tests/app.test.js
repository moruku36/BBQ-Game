"use strict";

// Boots the real page scripts in a strict fake browser (see helpers) and
// drives them the way a player would: form submit, button clicks, time.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../core.js");
const { boot, createStorage, ROOT } = require("./helpers/fake-browser.js");

const SEED = 20261008;
const HASH = "#v=1&seed=" + SEED;
const SCHEDULE = Core.buildSchedule(SEED);
const nameOf = (id) => Core.ingredientById(id).name;
// An ingredient that is not popular in phase 0, so scores have no bonus.
const PLAIN = Core.INGREDIENT_IDS.find((id) => id !== SCHEDULE[0]);
const PLAIN_ITEM = Core.ingredientById(PLAIN);

function started(options) {
  const env = boot(Object.assign({ hash: HASH }, options));
  env.advance(1000);
  env.start(options && options.nickname);
  env.t0 = env.clock;
  env.at = (activeMs, fps) => env.runUntil(env.t0 + activeMs, fps === undefined ? 60 : fps);
  return env;
}

// Places PLAIN in `slot` now and collects it at its ideal time.
function cookPerfect(env, slot, placeAt) {
  env.at(placeAt);
  env.click("ing-" + PLAIN);
  env.click("slot-" + slot);
  env.at(placeAt + PLAIN_ITEM.idealMs);
  env.click("slot-" + slot);
}

test("the page boots to the start screen and the timer waits for start", () => {
  const env = boot({ hash: HASH });
  assert.equal(env.$("screenStart").hidden, false);
  assert.equal(env.$("screenResult").hidden, true);
  assert.equal(env.$("pauseOverlay").hidden, true);
  assert.equal(env.$("gameArea").inert, true);
  assert.equal(env.text("hudTime"), "60");
  assert.equal(env.rafCallbacks.size, 0, "no frame loop before start");

  env.advance(30000);
  assert.equal(env.text("hudTime"), "60");
  env.click("slot-0");
  assert.equal(env.$("slot-0").className, "slot is-empty");

  env.start();
  assert.equal(env.$("screenStart").hidden, true);
  assert.equal(env.$("gameArea").inert, false);
  assert.equal(env.text("hudTime"), "60");
  env.advance(1500);
  assert.equal(env.text("hudTime"), "59");
  assert.equal(env.text("hudPlayer"), "ゲスト");
});

test("tray and popular HUD show the real ingredient table and schedule", () => {
  const env = started();
  for (const item of Core.INGREDIENTS) {
    assert.equal(env.text("ingName-" + item.id), item.name);
    assert.equal(env.text("ingMeta-" + item.id), (item.idealMs / 1000).toFixed(1) + "秒・" + item.base + "点");
  }
  assert.equal(env.text("popularName"), nameOf(SCHEDULE[0]));
  assert.equal(env.$("ingPop-" + SCHEDULE[0]).hidden, false);
  assert.equal(env.$("nextWrap").classList.contains("is-visible"), false);

  env.at(7100);
  assert.equal(env.$("nextWrap").classList.contains("is-visible"), true);
  assert.equal(env.text("nextName"), nameOf(SCHEDULE[1]));

  env.at(10100);
  assert.equal(env.text("popularName"), nameOf(SCHEDULE[1]));
  assert.equal(env.$("nextWrap").classList.contains("is-visible"), false);
  assert.equal(env.$("ingPop-" + SCHEDULE[0]).hidden, true);
  assert.equal(env.$("ingPop-" + SCHEDULE[1]).hidden, false);
});

test("place, watch the label change, collect: score, combo and slot update", () => {
  const env = started();
  env.click("ing-" + PLAIN);
  assert.equal(env.$("ing-" + PLAIN).getAttribute("aria-pressed"), "true");
  assert.equal(env.$("ing-shrimp").getAttribute("aria-pressed"), PLAIN === "shrimp" ? "true" : "false");

  env.at(100);
  env.click("slot-2");
  assert.equal(env.$("slot-2").className, "slot is-raw");
  assert.equal(env.text("slotBadge-2"), "○ 生");
  assert.match(env.$("slot-2").getAttribute("aria-label"), /まだ生/);

  env.at(100 + PLAIN_ITEM.idealMs * 0.9);
  assert.equal(env.$("slot-2").className, "slot is-good");
  assert.equal(env.text("slotBadge-2"), "◆ GOOD");

  env.at(100 + PLAIN_ITEM.idealMs + 100);
  assert.equal(env.$("slot-2").className, "slot is-perfect");
  assert.equal(env.text("slotBadge-2"), "★ PERFECT");
  env.click("slot-2");
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base));
  assert.equal(env.text("hudCombo"), "1");
  assert.equal(env.text("hudMult"), "x1.1");
  assert.equal(env.$("slot-2").className, "slot is-empty");
  assert.equal(env.$("slotBadge-2").hidden, true);
});

test("pulling raw food scores nothing and a double tap cannot collect twice", () => {
  const env = started();
  env.click("ing-" + PLAIN);
  env.at(100);
  env.click("slot-0");
  env.click("slot-0"); // bounce: ignored by the tap guard
  assert.equal(env.$("slot-0").className, "slot is-raw");

  env.at(900);
  env.click("slot-0");
  assert.equal(env.text("hudScore"), "0");
  assert.equal(env.text("hudCombo"), "0");

  env.at(2000);
  env.click("slot-1");
  env.at(2000 + PLAIN_ITEM.idealMs);
  env.click("slot-1");
  env.click("slot-1");
  env.click("slot-1");
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base));
  assert.equal(env.text("hudCombo"), "1");
  assert.equal(env.$("slot-1").className, "slot is-empty", "the extra taps did not re-place food");
});

test("burnt food is labelled, resets the combo once, and scores nothing", () => {
  const env = started();
  cookPerfect(env, 0, 0);
  assert.equal(env.text("hudCombo"), "1");
  const placedAt = PLAIN_ITEM.idealMs + 500;
  env.at(placedAt);
  env.click("slot-1");
  env.at(placedAt + PLAIN_ITEM.idealMs * 1.5 + 50);
  assert.equal(env.$("slot-1").className, "slot is-burnt");
  assert.equal(env.text("slotBadge-1"), "✕ コゲ");
  assert.equal(env.text("hudCombo"), "0");
  env.click("slot-1");
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base));
  assert.equal(env.$("slot-1").className, "slot is-empty");
});

test("hiding the page pauses food and timer until the player presses resume", () => {
  const env = started();
  env.click("ing-" + PLAIN);
  env.at(1000);
  env.click("slot-0");
  env.at(2000);

  env.setHidden(true);
  assert.equal(env.$("pauseOverlay").hidden, false);
  assert.equal(env.$("gameArea").inert, true);
  assert.equal(env.rafCallbacks.size, 0, "the frame loop stops while paused");

  env.advance(300000, 0);
  env.setHidden(false);
  env.advance(5000);
  assert.equal(env.$("pauseOverlay").hidden, false, "coming back does not resume by itself");
  assert.equal(env.text("hudTime"), "58");
  env.click("slot-0");
  assert.equal(env.$("slot-0").className, "slot is-raw", "nothing can be collected while paused");

  const resumedAt = env.clock;
  env.click("resumeButton");
  assert.equal(env.$("pauseOverlay").hidden, true);
  assert.equal(env.$("gameArea").inert, false);
  assert.equal(env.rafCallbacks.size, 1);

  // 1000ms of cooking before the pause; finish to the ideal time afterwards.
  env.runUntil(resumedAt + PLAIN_ITEM.idealMs - 1000, 60);
  env.click("slot-0");
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base), "the hidden time did not cook the food");
  env.advance(900);
  assert.equal(env.text("hudTime"), String(60 - Math.floor((PLAIN_ITEM.idealMs + 1900) / 1000) - 0));
});

test("hiding the page before start or after the end does nothing", () => {
  const env = boot({ hash: HASH });
  env.setHidden(true);
  env.setHidden(false);
  assert.equal(env.$("pauseOverlay").hidden, true);
  assert.equal(env.$("screenStart").hidden, false);
  env.start();
  env.advance(61000);
  assert.equal(env.$("screenResult").hidden, false);
  env.setHidden(true);
  env.setHidden(false);
  assert.equal(env.$("pauseOverlay").hidden, true);
  assert.equal(env.$("screenResult").hidden, false);
});

test("the pause button and resume keep active time exact", () => {
  const env = started();
  env.at(4000);
  env.click("pauseButton");
  assert.equal(env.$("pauseOverlay").hidden, false);
  env.advance(20000);
  env.click("resumeButton");
  env.advance(55900);
  assert.equal(env.$("screenResult").hidden, true, "59.9s active: still playing");
  env.advance(200);
  assert.equal(env.$("screenResult").hidden, false);
});

test("the game ends at 60s: result shown, no placing or collecting afterwards", () => {
  const env = started({ nickname: "Ken" });
  cookPerfect(env, 0, 0);
  cookPerfect(env, 1, 5000);
  env.at(58000);
  env.click("slot-3"); // still raw when time runs out
  env.at(59990);
  assert.equal(env.$("screenResult").hidden, true);

  // The tap lands after 60s but before any frame has rendered the end.
  env.at(60005, 0);
  env.click("slot-3");
  env.click("slot-4");
  assert.equal(env.$("screenResult").hidden, false);
  assert.equal(env.$("gameArea").inert, true);
  assert.equal(env.rafCallbacks.size, 0, "the frame loop stops at the end");

  const expected = PLAIN_ITEM.base + Math.round(PLAIN_ITEM.base * 1.1);
  assert.equal(env.text("resultScore"), String(expected));
  assert.equal(env.text("resultPerfect"), "2");
  assert.equal(env.text("resultBurned"), "0");
  assert.equal(env.text("resultMaxCombo"), "2");
  assert.equal(env.text("resultNickname"), "Ken");
  assert.equal(env.text("resultBest"), "この端末のベスト: " + expected + "点");
  assert.equal(env.$("resultNewBest").hidden, false);
  assert.equal(env.text("hudTime"), "0");

  env.advance(5000);
  env.click("slot-5");
  assert.equal(env.$("slot-5").className, "slot is-empty");
  assert.equal(env.text("hudScore"), String(expected));
  assert.equal(JSON.parse(env.storage.data.get(Core.STORAGE_KEY)).bestScore, expected);
});

test("retry restarts the same challenge from a clean slate", async () => {
  const clipboard = [];
  const env = started({ navigator: { clipboard: { writeText: async (text) => clipboard.push(text) } } });
  const listeners = env.listenerCount();

  const popularSeen = [];
  cookPerfect(env, 0, 0);
  env.at(6000);
  env.click("slot-4"); // left on the grill until the end
  for (let phase = 0; phase < Core.PHASE_COUNT; phase += 1) {
    env.at(phase * 10000 + 9000);
    popularSeen.push(env.text("popularName"));
  }
  assert.deepEqual(popularSeen, SCHEDULE.map(nameOf));
  env.at(60100);
  assert.equal(env.$("screenResult").hidden, false);
  const firstScore = env.text("resultScore");

  env.click("shareButton");
  await env.flush();
  assert.equal(env.text("shareStatus"), "リンクをコピーしました");
  assert.equal(env.timeouts.size, 1);

  env.click("retryButton");
  env.click("retryButton"); // an impatient second press must not double anything
  assert.equal(env.$("screenResult").hidden, true);
  assert.equal(env.$("gameArea").inert, false);
  assert.equal(env.rafCallbacks.size, 1, "exactly one frame loop");
  assert.equal(env.timeouts.size, 0, "pending timers from the last round are cancelled");
  assert.equal(env.listenerCount(), listeners, "no listeners are added per game");
  assert.equal(env.text("shareStatus"), "");
  assert.equal(env.text("hudTime"), "60");
  assert.equal(env.text("hudScore"), "0");
  assert.equal(env.text("hudCombo"), "0");
  assert.equal(env.text("hudMult"), "x1.0");
  for (let i = 0; i < Core.SLOT_COUNT; i += 1) {
    assert.equal(env.$("slot-" + i).className, "slot is-empty");
    assert.equal(env.$("slotBadge-" + i).hidden, true);
  }
  assert.equal(env.$("ing-" + Core.INGREDIENT_IDS[0]).getAttribute("aria-pressed"), "true");
  assert.equal(env.$("timeCard").classList.contains("is-urgent"), false);

  // Same seed, same schedule, and the full 60 seconds again.
  env.t0 = env.clock;
  const popularAgain = [];
  for (let phase = 0; phase < Core.PHASE_COUNT; phase += 1) {
    env.at(phase * 10000 + 9000);
    popularAgain.push(env.text("popularName"));
  }
  assert.deepEqual(popularAgain, popularSeen);
  assert.equal(env.$("screenResult").hidden, true);
  env.at(60100);
  assert.equal(env.$("screenResult").hidden, false);
  assert.equal(env.text("resultScore"), "0");
  assert.equal(env.$("resultNewBest").hidden, true);
  assert.equal(env.text("resultBest"), "この端末のベスト: " + firstScore + "点");
  assert.equal(env.text("resultSeed"), "チャレンジ No. " + SEED);
});

test("retry while paused or mid-game also leaves a single clean loop", () => {
  const env = started();
  cookPerfect(env, 0, 0);
  env.at(8000);
  env.click("slot-1");
  env.setHidden(true);
  env.setHidden(false);
  env.click("titleButton");
  assert.equal(env.$("pauseOverlay").hidden, true);
  assert.equal(env.$("screenStart").hidden, false);
  assert.equal(env.rafCallbacks.size, 0);
  assert.equal(env.text("hudScore"), "0");
  assert.equal(env.$("slot-1").className, "slot is-empty");

  env.advance(20000);
  env.start();
  assert.equal(env.rafCallbacks.size, 1);
  assert.equal(env.text("hudTime"), "60");
  env.advance(59900);
  assert.equal(env.$("screenResult").hidden, true);
  env.advance(200);
  assert.equal(env.$("screenResult").hidden, false);
});

test("a new challenge changes the seed; retry keeps it", () => {
  const env = started({ randomSeed: 31337 });
  env.at(60100);
  assert.equal(env.text("resultSeed"), "チャレンジ No. " + SEED);
  env.click("newChallengeButton");
  env.advance(60100);
  assert.equal(env.text("resultSeed"), "チャレンジ No. 31337");
  assert.equal(env.replacedHashes[env.replacedHashes.length - 1], "#v=1&seed=31337");
  env.click("retryButton");
  env.advance(60100);
  assert.equal(env.text("resultSeed"), "チャレンジ No. 31337");
});

test("the same inputs give the same result at 30, 60 and 144 FPS", () => {
  const play = (fps) => {
    const env = started();
    const at = (ms) => env.at(ms, fps);
    env.click("ing-" + PLAIN);
    at(137);
    env.click("slot-0");
    at(411);
    env.click("slot-1");
    at(733);
    env.click("slot-2");
    at(137 + PLAIN_ITEM.idealMs + 800); // last PERFECT instant
    env.click("slot-0");
    at(411 + PLAIN_ITEM.idealMs * 0.8); // first GOOD instant
    env.click("slot-1");
    at(733 + PLAIN_ITEM.idealMs * 1.5 + 333); // burnt by now
    at(20000);
    env.setHidden(true);
    env.advance(7777, fps);
    env.setHidden(false);
    env.click("resumeButton");
    env.t0 += 7777;
    at(21000);
    env.click("slot-3");
    at(21000 + PLAIN_ITEM.idealMs);
    env.click("slot-3");
    at(60100);
    return ["resultScore", "resultPerfect", "resultBurned", "resultMaxCombo"].map((id) => env.text(id));
  };
  const baseline = play(60);
  // PERFECT x1.0, GOOD x1.1, burn resets the combo, then PERFECT x1.0 again
  // (plus the flat bonus if PLAIN happens to be popular by then).
  const good = Math.round(PLAIN_ITEM.base * 0.6 * 1.1);
  const lateBonus = Core.popularAt(SCHEDULE, 21000 + PLAIN_ITEM.idealMs).current === PLAIN ? Core.POPULAR_BONUS : 0;
  assert.deepEqual(baseline, [String(PLAIN_ITEM.base + good + PLAIN_ITEM.base + lateBonus), "2", "1", "2"]);
  assert.deepEqual(play(30), baseline);
  assert.deepEqual(play(144), baseline);
  assert.deepEqual(play(7), baseline);
});

test("resizing mid-game keeps the game state and redraws", () => {
  const env = started();
  cookPerfect(env, 0, 0);
  env.at(6000);
  env.click("slot-1");
  env.at(7000);
  const before = env.stats.drawCalls;
  env.resize(360, 640);
  env.resize(1280, 800);
  assert.ok(env.stats.drawCalls > before, "the scene is repainted for the new size");
  assert.equal(env.$("scene").width, 2560);
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base));
  assert.equal(env.text("hudCombo"), "1");
  assert.equal(env.text("hudTime"), "53");
  assert.equal(env.$("slot-1").className, "slot is-raw");
  assert.equal(env.$("screenStart").hidden, true);
  assert.equal(env.rafCallbacks.size, 1);
  env.at(6000 + PLAIN_ITEM.idealMs);
  env.click("slot-1");
  assert.equal(env.text("hudCombo"), "2");
});

test("every food, stage and effect draws with real Canvas API members only", () => {
  // The fake 2D context throws on unknown members and non-finite numbers.
  for (const size of [[390, 844], [360, 640], [1440, 900]]) {
    const env = started({ width: size[0], height: size[1] });
    Core.INGREDIENT_IDS.forEach((id, slot) => {
      env.click("ing-" + id);
      env.click("slot-" + slot);
    });
    env.at(2600, 30);
    env.click("slot-0"); // shrimp GOOD: fly + sparks
    env.at(3900, 30);
    env.click("slot-1"); // sausage PERFECT
    env.at(4000, 30);
    env.click("slot-4");
    env.at(4500, 30);
    env.click("slot-4"); // RAW popup
    env.at(12000, 30); // kalbi and corn burn: smoke
    env.click("slot-2");
    env.at(13000, 30);
    assert.ok(env.stats.drawCalls > 1000);
  }
});

test("reduced motion still plays and draws", () => {
  const env = started({ reducedMotion: true });
  cookPerfect(env, 0, 0);
  env.at(PLAIN_ITEM.idealMs + 500);
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base));
});

// ---- storage -------------------------------------------------------------------

test("the game is fully playable when localStorage throws", () => {
  for (const storage of ["throw-access", "throw-methods"]) {
    const env = started({ storage, nickname: "Aki" });
    cookPerfect(env, 0, 0);
    env.at(60100);
    assert.equal(env.$("screenResult").hidden, false, storage);
    assert.equal(env.text("resultScore"), String(PLAIN_ITEM.base), storage);
    assert.equal(env.text("resultBest"), "この端末のベスト: " + PLAIN_ITEM.base + "点", storage);
    env.click("muteButton");
    env.click("retryButton");
    assert.equal(env.text("hudTime"), "60", storage);
  }
});

test("corrupt stored data does not stop the game or leak into the page", () => {
  for (const raw of ["{not json", "[]", '{"bestScore":"<b>9</b>","nickname":["x"],"muted":"1"}']) {
    const env = boot({ hash: HASH, stored: { [Core.STORAGE_KEY]: raw } });
    assert.equal(env.text("startBest"), "この端末のベスト: 0点", raw);
    assert.equal(env.$("nicknameInput").value, "", raw);
    env.start();
    env.advance(60100);
    assert.equal(env.$("screenResult").hidden, false, raw);
  }
});

test("best score and nickname persist on this device across reloads", () => {
  const storage = createStorage();
  const first = started({ storage, nickname: "Ken" });
  cookPerfect(first, 0, 0);
  first.at(60100);

  const second = boot({ hash: HASH, storage });
  assert.equal(second.text("startBest"), "この端末のベスト: " + PLAIN_ITEM.base + "点");
  assert.equal(second.$("nicknameInput").value, "Ken");
});

// ---- nickname --------------------------------------------------------------------

test("a nickname with markup is shown as literal text everywhere", () => {
  const payload = "<img src=x>";
  const storage = createStorage();
  const env = started({ nickname: payload, storage });
  assert.equal(env.text("hudPlayer"), payload);
  env.at(60100);
  assert.equal(env.text("resultNickname"), payload);

  // Stored and reloaded: still only ever a form value / text.
  const again = boot({ hash: HASH, storage });
  assert.equal(again.$("nicknameInput").value, payload);

  // The fake DOM throws on any innerHTML access; the sources must not use
  // HTML-string sinks at all.
  for (const file of ["app.js", "art.js", "core.js"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, file);
  }
});

test("a too-long nickname is refused with a message and the game does not start", () => {
  const env = boot({ hash: HASH });
  const event = env.start("x".repeat(13));
  assert.equal(event.defaultPrevented, true);
  assert.equal(env.$("screenStart").hidden, false);
  assert.equal(env.$("nicknameError").hidden, false);
  assert.match(env.text("nicknameError"), /12文字/);
  assert.equal(env.$("nicknameInput").getAttribute("aria-invalid"), "true");
  assert.equal(env.rafCallbacks.size, 0);
  assert.equal(env.audioContexts.length, 0);

  env.$("nicknameInput").value = "x".repeat(12);
  env.$("nicknameInput").dispatch("input");
  assert.equal(env.$("nicknameError").hidden, true);
  env.start();
  assert.equal(env.$("screenStart").hidden, true);
  assert.equal(env.text("hudPlayer"), "x".repeat(12));
});

// ---- challenge link and share -------------------------------------------------------

test("a valid challenge link selects the seed; a bad one falls back with a notice", () => {
  const linked = boot({ hash: HASH });
  assert.equal(linked.text("challengeInfo"), "チャレンジ No. " + SEED);
  assert.equal(linked.$("linkNotice").hidden, false);
  assert.match(linked.text("linkNotice"), /リンクのチャレンジ/);

  const plain = boot({ hash: "", randomSeed: 555 });
  assert.equal(plain.text("challengeInfo"), "チャレンジ No. 555");
  assert.equal(plain.$("linkNotice").hidden, true);

  for (const hash of ["#v=9&seed=5", "#v=1&seed=99999999999", "#v=1&seed=5&name=<script>alert(1)</script>", "#junk"]) {
    const env = boot({ hash, randomSeed: 777 });
    assert.equal(env.text("challengeInfo"), "チャレンジ No. 777", hash);
    assert.match(env.text("linkNotice"), /正しくない/, hash);
    env.start();
    assert.equal(env.$("screenStart").hidden, true, hash);
  }

  const noCrypto = boot({ hash: "", crypto: false });
  assert.match(noCrypto.text("challengeInfo"), /^チャレンジ No\. \d+$/);
});

test("nothing is shared until the player presses share", async () => {
  const shared = [];
  const env = started({ nickname: "SecretKen", navigator: { share: async (payload) => shared.push(payload) } });
  cookPerfect(env, 0, 0);
  env.at(60100);
  await env.flush();
  assert.equal(shared.length, 0);

  env.click("shareButton");
  await env.flush();
  assert.equal(shared.length, 1);
  assert.equal(shared[0].url, "https://example.test/BBQ-Game/" + HASH);
  assert.doesNotMatch(JSON.stringify(shared[0]), /SecretKen/);
  assert.equal(env.$("shareFallback").hidden, true);
});

test("share falls back to clipboard, then to visible text with only version and seed", async () => {
  const copied = [];
  const viaClipboard = started({
    nickname: "SecretKen",
    navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
  });
  viaClipboard.at(60100);
  viaClipboard.click("shareButton");
  await viaClipboard.flush();
  assert.equal(copied.length, 1);
  assert.ok(copied[0].endsWith("https://example.test/BBQ-Game/" + HASH));
  assert.doesNotMatch(copied[0], /SecretKen/);
  assert.equal(viaClipboard.$("shareFallback").hidden, true);

  const bare = started({ nickname: "SecretKen", navigator: {} });
  bare.at(60100);
  assert.equal(bare.$("shareFallback").hidden, true);
  bare.click("shareButton");
  await bare.flush();
  assert.equal(bare.$("shareFallback").hidden, false);
  assert.equal(bare.$("shareFallbackText").value, "https://example.test/BBQ-Game/" + HASH);
  assert.equal(bare.$("shareFallbackText").hasAttribute("readonly"), true);
});

// ---- sound -------------------------------------------------------------------------

test("audio is created only after a user gesture and is torn down with the page", () => {
  const env = boot({ hash: HASH });
  env.advance(5000);
  env.resize(400, 800);
  env.setHidden(true);
  env.setHidden(false);
  assert.equal(env.audioContexts.length, 0, "no AudioContext without a gesture");

  env.start();
  assert.equal(env.audioContexts.length, 1);
  const ctx = env.audioContexts[0];
  env.click("slot-0");
  assert.ok(ctx.nodes > 0, "placing plays a sound");

  env.setHidden(true);
  assert.equal(ctx.state, "suspended");
  env.setHidden(false);
  assert.equal(ctx.state, "suspended");
  env.click("resumeButton");
  assert.equal(ctx.state, "running");

  env.window.dispatch("pagehide");
  assert.equal(ctx.state, "closed");
  assert.equal(env.$("pauseOverlay").hidden, false);
  assert.equal(env.audioContexts.length, 1);
});

test("mute silences sound, is remembered, and can be undone", () => {
  const storage = createStorage();
  const env = started({ storage });
  const ctx = env.audioContexts[0];
  env.click("muteButton");
  assert.equal(env.$("muteButton").getAttribute("aria-pressed"), "true");
  assert.equal(env.text("muteText"), "音なし");
  const before = ctx.nodes;
  env.click("slot-0");
  assert.equal(ctx.nodes, before);

  const reloaded = started({ storage });
  assert.equal(reloaded.$("muteButton").getAttribute("aria-pressed"), "true");
  reloaded.click("slot-0");
  assert.equal(reloaded.audioContexts.length, 0, "a muted game never opens an AudioContext");
  reloaded.click("muteButton");
  assert.equal(reloaded.$("muteButton").getAttribute("aria-pressed"), "false");
  assert.equal(reloaded.audioContexts.length, 1);
});

test("the game runs without Web Audio support", () => {
  const env = started({ audio: false });
  cookPerfect(env, 0, 0);
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base));
});

// ---- static page checks --------------------------------------------------------------

test("the page is static, loads no external resources and has no heat slider", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  const js = ["core.js", "art.js", "app.js"].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

  assert.match(html, /<title>BBQ Party<\/title>/);
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//, "no external scripts, styles or fonts");
  assert.doesNotMatch(css, /@import|url\(\s*['"]?(?:https?:)?\/\//);
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/);
  assert.doesNotMatch(html, /type="range"/);
  assert.doesNotMatch(html + js, /heat|火力/i);
  assert.equal((html.match(/class="slot"/g) || []).length, 6);
  assert.equal((html.match(/class="ing"/g) || []).length, 4);
  assert.match(html, /全国ランキングはありません/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});
