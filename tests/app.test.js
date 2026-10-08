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
const HASH = "#v=2&seed=" + SEED;
const SCHEDULE = Core.buildSchedule(SEED);
const nameOf = (id) => Core.ingredientById(id).name;
// An ingredient that is not popular in phase 0, so scores have no bonus.
const PLAIN = Core.INGREDIENT_IDS.find((id) => id !== SCHEDULE[0]);
const PLAIN_ITEM = Core.ingredientById(PLAIN);
const seedLabel = (seed) => "チャレンジ v2 No. " + seed;
const bestLabel = (name, best, rank) => name + " さんのベスト: " + best + "点（この端末で" + rank + "位）";
// Line endings are normalized so the checks hold for any checkout.
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

function started(options) {
  const env = boot(Object.assign({ hash: HASH }, options));
  env.advance(1000);
  env.start(options && options.nickname);
  env.t0 = env.clock;
  env.at = (activeMs, fps) => env.runUntil(env.t0 + activeMs, fps === undefined ? 60 : fps);
  // Back to the title, then a new round under `nickname`.
  env.again = (nickname) => {
    env.click("titleButton");
    env.start(nickname);
    env.t0 = env.clock;
  };
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

// `perfects` PERFECT collections five seconds apart (all inside the first two
// phases, where PLAIN is not popular), then on to the result screen.
function finishRound(env, perfects) {
  for (let i = 0; i < perfects; i += 1) {
    cookPerfect(env, i, i * 5000);
  }
  env.at(60100, 20);
}

function rankRows(env, board) {
  return [0, 1, 2].map((i) => env.text(board + "Name-" + i) + " " + env.text(board + "Score-" + i));
}

test("the page boots to the start screen and the timer waits for start", () => {
  const env = boot({ hash: HASH });
  assert.equal(env.$("screenStart").hidden, false);
  assert.equal(env.$("screenResult").hidden, true);
  assert.equal(env.$("pauseOverlay").hidden, true);
  assert.equal(env.$("soundOverlay").hidden, true);
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

test("tray and popular HUD show the real six-ingredient table and schedule", () => {
  const env = started();
  for (const item of Core.INGREDIENTS) {
    assert.equal(env.text("ingName-" + item.id), item.short);
    assert.equal(env.text("ingMeta-" + item.id), (item.idealMs / 1000).toFixed(1) + "秒・" + item.base + "点");
    const label = env.$("ing-" + item.id).getAttribute("aria-label");
    assert.ok(label.startsWith(item.name + "。"), label);
    assert.match(label, new RegExp("PERFECTの幅" + (item.perfectMs / 1000).toFixed(1) + "秒"));
  }
  // The PERFECT width is spelled out in words and seconds, not just drawn.
  assert.equal(env.text("ingWindow-shiitake"), "★広め 1.4秒");
  assert.equal(env.text("ingWindow-steak"), "★狭め 0.5秒");
  assert.equal(env.text("ingWindow-shrimp"), "★幅 0.8秒");
  assert.match(env.$("ing-shiitake").getAttribute("aria-label"), /やさしい/);
  assert.match(env.$("ing-steak").getAttribute("aria-label"), /上級/);

  assert.equal(env.text("popularName"), nameOf(SCHEDULE[0]));
  assert.equal(env.$("ingPop-" + SCHEDULE[0]).hidden, false);
  assert.match(env.$("ing-" + SCHEDULE[0]).getAttribute("aria-label"), /いま人気 \+50/);
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

test("all six ingredients take their turn as popular in the HUD and the tray", () => {
  const seen = new Set();
  for (const seed of [0, 1, 7, SEED]) {
    const env = started({ hash: "#v=2&seed=" + seed });
    const schedule = Core.buildSchedule(seed);
    for (let phase = 0; phase < Core.PHASE_COUNT; phase += 1) {
      env.at(phase * 10000 + 5000, 10);
      assert.equal(env.text("popularName"), nameOf(schedule[phase]), "seed " + seed + " phase " + phase);
      const marked = Core.INGREDIENT_IDS.filter((id) => !env.$("ingPop-" + id).hidden);
      assert.deepEqual(marked, [schedule[phase]]);
      seen.add(schedule[phase]);
    }
  }
  assert.equal(seen.size, 6);
});

test("steak and shiitake are judged by their own PERFECT width on the page", () => {
  const env = started({ hash: "#v=2&seed=0" }); // phase 0 popular: sausage
  env.click("ing-steak");
  env.click("slot-0");
  env.click("ing-shiitake");
  env.click("slot-1");
  env.at(5600);
  assert.equal(env.$("slot-1").className, "slot is-perfect", "shiitake is still PERFECT 1.4s after its ideal time");
  env.click("slot-1");
  assert.equal(env.text("hudScore"), "100");
  assert.equal(env.$("slot-0").className, "slot is-good", "steak has only just reached GOOD");
  env.at(7500);
  assert.equal(env.$("slot-0").className, "slot is-perfect");
  env.at(7520);
  assert.equal(env.$("slot-0").className, "slot is-late", "steak leaves PERFECT after 0.5s");
  assert.equal(env.text("slotBadge-0"), "◇ GOOD 注意");
  env.click("slot-0");
  assert.equal(env.text("hudScore"), String(100 + Math.round(210 * 0.6 * 1.1)));
});

test("number keys 1 to 6 pick the six ingredients", () => {
  const env = started();
  Core.INGREDIENT_IDS.forEach((id, index) => {
    env.document.dispatch("keydown", { key: String(index + 1) });
    assert.equal(env.$("ing-" + id).getAttribute("aria-pressed"), "true", id);
  });
  env.document.dispatch("keydown", { key: "7" });
  assert.equal(env.$("ing-steak").getAttribute("aria-pressed"), "true");
  env.document.dispatch("keydown", { key: "1", ctrlKey: true });
  assert.equal(env.$("ing-steak").getAttribute("aria-pressed"), "true", "browser shortcuts are left alone");
  env.document.dispatch("keydown", { key: "p" });
  assert.equal(env.$("pauseOverlay").hidden, false);
});

test("place, watch the label change, collect: score, combo and slot update", () => {
  const env = started();
  env.click("ing-" + PLAIN);
  assert.equal(env.$("ing-" + PLAIN).getAttribute("aria-pressed"), "true");
  assert.equal(env.$("ing-steak").getAttribute("aria-pressed"), "false");

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
  assert.equal(env.text("resultBest"), bestLabel("Ken", expected, 1));
  assert.equal(env.$("resultNewBest").hidden, false);
  assert.equal(env.$("resultSaveNote").hidden, true);
  assert.equal(env.text("hudTime"), "0");

  env.advance(5000);
  env.click("slot-5");
  assert.equal(env.$("slot-5").className, "slot is-empty");
  assert.equal(env.text("hudScore"), String(expected));
  const saved = JSON.parse(env.storage.data.get(Core.STORAGE_KEY));
  assert.deepEqual(saved.players, [{ name: "Ken", best: expected }]);
  assert.equal(saved.v, 2);
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
  assert.equal(env.text("resultBest"), bestLabel("ゲスト", firstScore, 1));
  assert.equal(env.text("resultSeed"), seedLabel(SEED));
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
  assert.equal(env.text("resultSeed"), seedLabel(SEED));
  env.click("newChallengeButton");
  env.advance(60100);
  assert.equal(env.text("resultSeed"), seedLabel(31337));
  assert.equal(env.replacedHashes[env.replacedHashes.length - 1], "#v=2&seed=31337");
  env.click("retryButton");
  env.advance(60100);
  assert.equal(env.text("resultSeed"), seedLabel(31337));
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
    at(137 + PLAIN_ITEM.idealMs + PLAIN_ITEM.perfectMs); // last PERFECT instant
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
    // One of each of the six ingredients, one per slot.
    Core.INGREDIENT_IDS.forEach((id, slot) => {
      env.click("ing-" + id);
      env.click("slot-" + slot);
    });
    env.at(2600, 30);
    env.click("slot-0"); // shrimp GOOD: fly + sparks
    env.at(3900, 30);
    env.click("slot-1"); // sausage PERFECT
    env.at(4000, 30);
    env.click("slot-0"); // a second steak
    env.at(4500, 30);
    env.click("slot-0"); // RAW popup
    env.at(5000, 30);
    env.click("slot-2"); // shiitake PERFECT
    env.at(7200, 30); // steak PERFECT on the grill, kalbi burnt
    assert.equal(env.$("slot-5").className, "slot is-perfect");
    env.at(12000, 30); // kalbi, corn and steak have burnt: smoke
    for (const slot of [3, 4, 5]) {
      assert.equal(env.$("slot-" + slot).className, "slot is-burnt");
    }
    env.click("slot-3");
    env.at(13000, 30);
    assert.ok(env.stats.drawCalls > 1000);
    assert.deepEqual(env.audioErrors, []);
  }
});

test("reduced motion still plays and draws", () => {
  const env = started({ reducedMotion: true });
  cookPerfect(env, 0, 0);
  env.at(PLAIN_ITEM.idealMs + 500);
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base));
});

// ---- top three on this device ----------------------------------------------------

test("the top three of this device shows while playing: one best per name", () => {
  const storage = createStorage();
  const env = started({ storage, nickname: "Aki" });
  assert.deepEqual(rankRows(env, "hudRank"), ["— ", "— ", "— "], "an empty ranking invents nobody");
  finishRound(env, 2);
  assert.equal(env.text("resultBest"), bestLabel("Aki", 168, 1));

  env.again("Ken");
  finishRound(env, 1);
  env.again("");
  finishRound(env, 3);
  assert.equal(env.text("resultBest"), bestLabel("ゲスト", 264, 1));
  assert.deepEqual(rankRows(env, "resultRank"), ["ゲスト（名前なし共通） 264点", "Aki 168点", "Ken 80点"]);

  // A fourth player: the top three is on screen during play, without Bob.
  env.again("Bob");
  assert.deepEqual(rankRows(env, "hudRank"), ["ゲスト 264点", "Aki 168点", "Ken 80点"]);
  assert.equal(env.$("gameArea").inert, false);
  for (const i of [0, 1, 2]) {
    assert.equal(env.$("hudRank-" + i).classList.contains("is-me"), false);
    assert.equal(env.$("hudRank-" + i).classList.contains("is-empty"), false);
  }
  finishRound(env, 1);
  // Same score as Ken, reached later: Ken stays third.
  assert.equal(env.text("resultBest"), bestLabel("Bob", 80, 4));
  assert.equal(env.$("resultNewBest").hidden, false);
  assert.deepEqual(rankRows(env, "resultRank"), ["ゲスト（名前なし共通） 264点", "Aki 168点", "Ken 80点"]);

  // The same name again is the same player, and a worse round changes nothing.
  env.again("Ken");
  assert.equal(env.$("hudRank-2").classList.contains("is-me"), true, "the current player is marked");
  assert.equal(env.$("hudRank-0").classList.contains("is-me"), false);
  finishRound(env, 0);
  assert.equal(env.text("resultScore"), "0");
  assert.equal(env.text("resultBest"), bestLabel("Ken", 80, 3));
  assert.equal(env.$("resultNewBest").hidden, true);

  // Typing the guest name is the shared guest entry, not a second one.
  env.again("ゲスト");
  assert.equal(env.$("hudRank-0").classList.contains("is-me"), true);
  finishRound(env, 1);
  assert.equal(env.text("resultBest"), bestLabel("ゲスト", 264, 1));
  assert.equal(env.$("resultNewBest").hidden, true);

  env.click("titleButton");
  assert.deepEqual(rankRows(env, "startRank"), ["ゲスト（名前なし共通） 264点", "Aki 168点", "Ken 80点"]);
  assert.equal(env.$("startRank-0").classList.contains("is-me"), false);
  assert.deepEqual(JSON.parse(storage.data.get(Core.STORAGE_KEY)).players, [
    { name: "ゲスト", best: 264 },
    { name: "Aki", best: 168 },
    { name: "Ken", best: 80 },
    { name: "Bob", best: 80 },
  ]);

  // A reload shows the same order.
  const reloaded = boot({ hash: HASH, storage });
  assert.deepEqual(rankRows(reloaded, "startRank"), ["ゲスト（名前なし共通） 264点", "Aki 168点", "Ken 80点"]);
  assert.equal(reloaded.$("nicknameInput").value, "", "a guest round leaves no remembered name");
});

test("a round without points is not recorded and says so", () => {
  const env = started({ nickname: "Zero" });
  finishRound(env, 0);
  assert.equal(env.text("resultBest"), "1点以上とると、この端末のランキングに記録されます");
  assert.equal(env.$("resultNewBest").hidden, true);
  assert.deepEqual(rankRows(env, "resultRank"), ["— ", "— ", "— "]);
  assert.equal(env.storage.data.has(Core.STORAGE_KEY) ? JSON.parse(env.storage.data.get(Core.STORAGE_KEY)).players.length : 0, 0);
});

test("the ranking is labelled as this device only, on every board", () => {
  const html = read("index.html");
  assert.equal((html.replace(/<[^>]*>/g, "").match(/この端末の上位3人/g) || []).length, 3, "HUD, start card and result card");
  assert.match(html, /同じ名前は1人として、ベストだけを残します/);
  assert.match(html, /名前なしは全員「ゲスト」の1枠です/);
  assert.equal((html.match(/公開ランキングへの送信は別に選べます/g) || []).length, 2);
  // The HUD board sits inside the game area, before the grill.
  const game = html.slice(html.indexOf('<main class="game"'), html.indexOf("</main>"));
  assert.ok(game.indexOf('id="hudRankTitle"') > 0 && game.indexOf('id="hudRankTitle"') < game.indexOf('id="grill"'));
  const js = ["core.js", "app.js"].map(read).join("\n");
  assert.doesNotMatch(read("core.js"), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/, "rules and device records stay offline");
});

test("a version 1 best is shown apart and never ranked under the last nickname", () => {
  const legacy = JSON.stringify({ v: 1, bestScore: 999, nickname: "Ken", muted: false });
  const storage = createStorage({ [Core.LEGACY_STORAGE_KEY]: legacy });
  const env = started({ storage });
  // The old nickname is only offered as the form value.
  assert.equal(env.text("hudPlayer"), "Ken");
  assert.deepEqual(rankRows(env, "hudRank"), ["— ", "— ", "— "]);
  finishRound(env, 1);
  assert.equal(env.text("resultBest"), bestLabel("Ken", 80, 1), "Ken's best is what Ken scored now, not the old 999");
  assert.equal(env.$("resultNewBest").hidden, false);
  assert.deepEqual(rankRows(env, "resultRank"), ["Ken 80点", "— ", "— "]);
  assert.equal(storage.data.get(Core.LEGACY_STORAGE_KEY), legacy);

  const fresh = boot({ hash: HASH, storage: createStorage({ [Core.LEGACY_STORAGE_KEY]: legacy }) });
  assert.equal(fresh.$("startLegacy").hidden, false);
  assert.match(fresh.text("startLegacy"), /旧バージョン\(v1・4食材\)の最高: 999点/);
  assert.match(fresh.text("startLegacy"), /ランキング対象外/);
  assert.deepEqual(rankRows(fresh, "startRank"), ["— ", "— ", "— "]);
  assert.doesNotMatch(rankRows(fresh, "startRank").join(""), /999/);

  const none = boot({ hash: HASH });
  assert.equal(none.$("startLegacy").hidden, true);
  assert.equal(none.text("startLegacy"), "");
});

// ---- storage -------------------------------------------------------------------

test("the game is fully playable when localStorage throws", () => {
  for (const storage of ["throw-access", "throw-methods"]) {
    const env = started({ storage, nickname: "Aki" });
    cookPerfect(env, 0, 0);
    env.at(60100);
    assert.equal(env.$("screenResult").hidden, false, storage);
    assert.equal(env.text("resultScore"), String(PLAIN_ITEM.base), storage);
    assert.equal(env.text("resultBest"), bestLabel("Aki", PLAIN_ITEM.base, 1), storage);
    assert.equal(env.$("resultSaveNote").hidden, false, storage + ": the player is told it could not be saved");
    assert.deepEqual(rankRows(env, "resultRank"), ["Aki 80点", "— ", "— "], storage);
    env.click("retryButton");
    assert.equal(env.text("hudTime"), "60", storage);
    env.click("soundButton");
    env.click("bgmToggle");
    env.click("seDown");
    assert.equal(env.text("seLevel"), "4/5", storage + ": settings still work for this session");
    env.click("soundCloseButton");
    env.click("resumeButton");
    assert.equal(env.rafCallbacks.size, 1, storage);
  }
});

test("corrupt stored data does not stop the game or leak into the page", () => {
  const raws = [
    "{not json",
    "[]",
    '{"players":"<b>9</b>","nickname":["x"],"audio":"1","legacyBest":"<i>"}',
    '{"players":[{"name":"<b>9</b>","best":"<b>9</b>"}],"audio":{"seVolume":99,"bgmVolume":-1}}',
  ];
  for (const raw of raws) {
    const env = boot({ hash: HASH, stored: { [Core.STORAGE_KEY]: raw } });
    assert.deepEqual(rankRows(env, "startRank"), ["— ", "— ", "— "], raw);
    assert.equal(env.$("startLegacy").hidden, true, raw);
    assert.equal(env.$("nicknameInput").value, "", raw);
    assert.equal(env.text("seLevel"), "5/5", raw);
    assert.equal(env.text("bgmLevel"), "3/5", raw);
    env.start();
    env.advance(60100);
    assert.equal(env.$("screenResult").hidden, false, raw);
  }
});

test("bests and nickname persist on this device across reloads", () => {
  const storage = createStorage();
  const first = started({ storage, nickname: "Ken" });
  cookPerfect(first, 0, 0);
  first.at(60100);

  const second = boot({ hash: HASH, storage });
  assert.deepEqual(rankRows(second, "startRank"), ["Ken " + PLAIN_ITEM.base + "点", "— ", "— "]);
  assert.equal(second.$("nicknameInput").value, "Ken");
});

// ---- nickname --------------------------------------------------------------------

test("a nickname with markup is shown as literal text everywhere", () => {
  const payload = "<img src=x>";
  const storage = createStorage();
  const env = started({ nickname: payload, storage });
  assert.equal(env.text("hudPlayer"), payload);
  finishRound(env, 1);
  assert.equal(env.text("resultNickname"), payload);
  assert.equal(env.text("resultRankName-0"), payload);
  assert.equal(env.text("resultBest"), bestLabel(payload, 80, 1));
  env.click("retryButton");
  assert.equal(env.text("hudRankName-0"), payload);

  // Stored and reloaded: still only ever a form value / text.
  const again = boot({ hash: HASH, storage });
  assert.equal(again.$("nicknameInput").value, payload);
  assert.equal(again.text("startRankName-0"), payload);

  // Names planted straight into storage are shown as text or dropped.
  const planted = JSON.stringify({
    v: 2,
    players: [
      { name: "<script>x", best: 500 },
      { name: "<img src=x onerror=alert(1)>", best: 900 },
      { name: "ok", best: 1e99 },
      { name: "‮evil", best: 400 },
    ],
  });
  const hostile = boot({ hash: HASH, stored: { [Core.STORAGE_KEY]: planted } });
  assert.deepEqual(rankRows(hostile, "startRank"), ["<script>x 500点", "evil 400点", "— "]);

  // The fake DOM throws on any innerHTML access; the sources must not use
  // HTML-string sinks at all.
  for (const file of ["app.js", "art.js", "core.js"]) {
    assert.doesNotMatch(read(file), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, file);
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
  assert.equal(linked.text("challengeInfo"), seedLabel(SEED));
  assert.equal(linked.$("linkNotice").hidden, false);
  assert.match(linked.text("linkNotice"), /リンクのチャレンジ/);

  const plain = boot({ hash: "", randomSeed: 555 });
  assert.equal(plain.text("challengeInfo"), seedLabel(555));
  assert.equal(plain.$("linkNotice").hidden, true);

  for (const hash of ["#v=9&seed=5", "#v=2&seed=99999999999", "#v=2&seed=5&name=<script>alert(1)</script>", "#junk"]) {
    const env = boot({ hash, randomSeed: 777 });
    assert.equal(env.text("challengeInfo"), seedLabel(777), hash);
    assert.match(env.text("linkNotice"), /正しくない/, hash);
    env.start();
    assert.equal(env.$("screenStart").hidden, true, hash);
  }

  const noCrypto = boot({ hash: "", crypto: false });
  assert.match(noCrypto.text("challengeInfo"), /^チャレンジ v2 No\. \d+$/);
});

test("a version 1 link is explained and replaced, never replayed as version 2", async () => {
  const shared = [];
  const env = boot({ hash: "#v=1&seed=" + SEED, randomSeed: 4242, navigator: { share: async (payload) => shared.push(payload) } });
  assert.equal(env.text("challengeInfo"), seedLabel(4242), "the v1 seed number is not reused");
  assert.equal(env.$("linkNotice").hidden, false);
  assert.match(env.text("linkNotice"), /旧バージョン v1 のリンク/);
  assert.match(env.text("linkNotice"), /新しい v2 チャレンジ/);
  assert.doesNotMatch(env.text("linkNotice"), /正しくない/);

  env.advance(1000);
  env.start();
  assert.deepEqual(env.replacedHashes, ["#v=2&seed=4242"], "the address bar no longer carries the v1 link");
  assert.equal(env.text("popularName"), nameOf(Core.buildSchedule(4242)[0]));
  env.advance(60100, 20);
  assert.equal(env.text("resultSeed"), seedLabel(4242));
  env.click("shareButton");
  await env.flush();
  assert.equal(shared[0].url, "https://example.test/BBQ-Game/#v=2&seed=4242");
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

// ---- text selection ----------------------------------------------------------------

// The CSS rule block for an exact selector list, e.g. block(css, ".app").
function block(css, selector) {
  const pattern = new RegExp("(?:^|\\})\\s*" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "m");
  const match = pattern.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  assert.ok(match, "CSS rule for " + selector);
  return match[1];
}

test("fast taps, double clicks and drags cannot select game text", () => {
  const css = read("styles.css");
  const app = block(css, ".app");
  assert.match(app, /(?:^|[\s;])user-select:\s*none/);
  assert.match(app, /-webkit-user-select:\s*none/);
  assert.match(app, /-webkit-touch-callout:\s*none/);

  const env = started();
  const blocked = ["slot-0", "ing-steak", "hudScore", "hudRankName-0", "popularName", "statusLine", "scene", "pauseButton", "app"];
  for (const type of ["selectstart", "dragstart"]) {
    for (const id of blocked) {
      const event = env.$("app").dispatch(type, { target: env.$(id) });
      assert.equal(event.defaultPrevented, true, type + " on #" + id);
    }
  }

  // Hammering a slot and the tray like an impatient player changes nothing odd.
  env.click("ing-" + PLAIN);
  for (let i = 0; i < 12; i += 1) {
    env.click("slot-0");
    env.$("app").dispatch("selectstart", { target: env.$("slot-0") });
    env.click("ing-" + PLAIN);
  }
  assert.equal(env.$("slot-0").className, "slot is-raw");
  assert.equal(env.text("hudScore"), "0");
  assert.equal(env.document.activeElement, env.$("slot-0"), "keyboard focus stays where the game put it");
});

test("the nickname field and the share link stay selectable and copyable", async () => {
  const css = read("styles.css");
  const fields = block(css, "input,\ntextarea,\n.copyable");
  assert.match(fields, /(?:^|[\s;])user-select:\s*text/);
  assert.match(fields, /-webkit-user-select:\s*text/);
  assert.ok(css.indexOf(".copyable {") > css.indexOf(".app {"), "the exception comes after the game-wide rule");

  const html = read("index.html");
  assert.match(html, /<input class="field-input" id="nicknameInput"/);
  assert.match(html, /<input class="field-input" id="shareFallbackText" type="text" readonly>/);
  assert.match(html, /class="copyable" id="resultSeed"/);
  assert.match(html, /class="copyable" id="challengeInfo"/);

  const env = started({ navigator: {} });
  for (const type of ["selectstart", "dragstart"]) {
    for (const id of ["nicknameInput", "shareFallbackText"]) {
      const event = env.$("app").dispatch(type, { target: env.$(id) });
      assert.equal(event.defaultPrevented, false, type + " on #" + id);
    }
  }
  env.at(60100, 20);
  env.click("shareButton");
  await env.flush();
  const field = env.$("shareFallbackText");
  assert.equal(env.$("shareFallback").hidden, false);
  assert.equal(env.document.activeElement, field, "the link field is focused");
  assert.equal(field.selectedText, "https://example.test/BBQ-Game/" + HASH, "and its whole text is selected, ready to copy");
});

test("blocking selection leaves keyboard use, focus rings and scrolling alone", () => {
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const html = read("index.html");
  assert.doesNotMatch(css, /outline:\s*(?:none|0)\b/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid/);
  assert.match(block(css, ".overlay"), /overflow:\s*auto/, "tall cards can still scroll on small screens");
  assert.doesNotMatch(block(css, ".game"), /pointer-events|touch-action/);
  assert.match(block(css, "button"), /touch-action:\s*manipulation/);
  assert.doesNotMatch(html, /tabindex="-1"|user-scalable=no|maximum-scale/);
  assert.equal((html.match(/<button type="button" class="slot"/g) || []).length, 6);
  assert.equal((html.match(/<button type="button" class="ing"/g) || []).length, 6);
  // Only selection and dragging are intercepted, nothing a keyboard or a tap needs.
  const blockedEvents = read("app.js").match(/addEventListener\("(?:selectstart|dragstart|mousedown|touchstart|pointerdown|contextmenu)"/g);
  assert.deepEqual(blockedEvents, ['addEventListener("selectstart"', 'addEventListener("dragstart"']);
});

// ---- sound -------------------------------------------------------------------------

const audible = (notes) => notes.filter((osc) => osc.stopAt > osc.startAt);
const voiceOf = (notes, type) => notes.filter((osc) => osc.type === type);
// The melody (square) or bass (triangle) frequencies for `count` notes from the top.
function tune(voice, count) {
  const hz = [];
  for (let step = 0; hz.length < count; step += 1) {
    const midi = Core.BGM[voice][step % Core.BGM[voice].length];
    if (midi) {
      hz.push(Core.midiToHz(midi));
    }
  }
  return hz;
}

// No two audible notes of one voice sound at once: a doubled loop would.
function assertNoOverlap(ctx, label) {
  for (const type of ["square", "triangle"]) {
    const notes = audible(voiceOf(ctx.notes("bgm"), type)).sort((a, b) => a.startAt - b.startAt);
    for (let i = 1; i < notes.length; i += 1) {
      assert.ok(notes[i].startAt >= notes[i - 1].stopAt - 1e-9, label + ": " + type + " note " + i + " overlaps the one before");
    }
  }
}

test("audio is created only after a user gesture and is torn down with the page", () => {
  const env = boot({ hash: HASH });
  env.advance(5000);
  env.resize(400, 800);
  env.setHidden(true);
  env.setHidden(false);
  env.click("startSoundButton");
  env.click("soundCloseButton");
  assert.equal(env.audioContexts.length, 0, "no AudioContext without a gesture that needs sound");

  env.start();
  assert.equal(env.audioContexts.length, 1);
  const ctx = env.audioContexts[0];
  const before = ctx.notes("se").length;
  env.click("slot-0");
  assert.equal(ctx.notes("se").length, before + 1, "placing plays a sound effect");

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

  // Back from the page cache: one new context, never two live ones.
  env.click("resumeButton");
  env.advance(2000);
  assert.equal(env.audioContexts.length, 2);
  assert.equal(env.audioContexts.filter((item) => item.state !== "closed").length, 1);
  assert.ok(env.audioContexts[1].notes("bgm").length > 0);
  assert.deepEqual(env.audioErrors, []);
});

test("the BGM starts with the round and plays every note of the loop once", () => {
  const env = started();
  const ctx = env.audioContexts[0];
  assert.ok(ctx.notes("bgm").length > 0, "the first notes are scheduled from the start gesture");
  assert.equal(ctx.buses().bgm.gain.value, (3 / 5) * (3 / 5));
  assert.equal(ctx.buses().se.gain.value, 1);
  env.at(20000);

  for (const [type, voice] of [["square", "melody"], ["triangle", "bass"]]) {
    const notes = voiceOf(ctx.notes("bgm"), type);
    assert.ok(notes.length > 30, voice);
    assert.deepEqual(notes.map((osc) => osc.frequency.value), tune(voice, notes.length), voice + " follows the score, looping");
    assert.equal(new Set(notes.map((osc) => osc.startAt)).size, notes.length, voice + ": one note per step");
  }
  const loopSec = Core.BGM.stepSec * Core.BGM.melody.length;
  assert.ok(loopSec < 20, "the loop has already wrapped around in this test");
  assertNoOverlap(ctx, "20s of play");
  assert.equal(env.timeouts.size, 0, "the BGM owns no timer");
  assert.equal(env.rafCallbacks.size, 1);
  assert.equal(env.audioContexts.length, 1);
  assert.doesNotMatch(read("app.js") + read("core.js"), /setInterval|new Audio\(|<audio|\.mp3|\.ogg|\.wav|decodeAudioData/);
  assert.deepEqual(env.audioErrors, []);
});

test("manual pause stops the BGM and resume continues it without overlap", () => {
  const env = started();
  const ctx = env.audioContexts[0];
  env.at(5000);
  env.click("pauseButton");
  const pausedAt = ctx.currentTime;
  const count = ctx.notes("bgm").length;
  assert.equal(ctx.state, "suspended");
  for (const osc of ctx.notes("bgm")) {
    assert.ok(osc.stopAt <= pausedAt + 0.0601, "every sounding or scheduled note is cut at the pause");
  }

  env.advance(30000);
  env.click("pauseButton"); // inert, and pausing twice changes nothing
  assert.equal(ctx.notes("bgm").length, count, "nothing is scheduled while paused");
  assert.equal(ctx.currentTime, pausedAt);

  env.click("resumeButton");
  env.click("resumeButton");
  assert.equal(ctx.state, "running");
  env.advance(6000);
  const melody = voiceOf(ctx.notes("bgm"), "square");
  assert.ok(ctx.notes("bgm").length > count + 20);
  assert.deepEqual(melody.map((osc) => osc.frequency.value), tune("melody", melody.length), "the tune carries on, it does not restart");
  for (const osc of ctx.notes("bgm").slice(count)) {
    assert.ok(osc.startAt >= pausedAt + Core.BGM.leadSec - 1e-9);
  }
  assertNoOverlap(ctx, "pause and resume");
  assert.equal(env.audioContexts.length, 1);
  assert.equal(env.rafCallbacks.size, 1);
});

test("a hidden tab stops the BGM until the player resumes", () => {
  const env = started();
  const ctx = env.audioContexts[0];
  env.at(8000);
  env.setHidden(true);
  const count = ctx.notes("bgm").length;
  assert.equal(ctx.state, "suspended");
  env.advance(60000, 0);
  env.setHidden(false);
  env.advance(5000);
  assert.equal(ctx.state, "suspended", "coming back to the tab does not restart the music");
  assert.equal(ctx.notes("bgm").length, count);

  env.click("resumeButton");
  env.advance(3000);
  assert.ok(ctx.notes("bgm").length > count);
  assertNoOverlap(ctx, "hidden tab");

  // Hiding again while already paused, or on the result screen, stays quiet.
  env.click("pauseButton");
  env.setHidden(true);
  env.setHidden(false);
  const paused = ctx.notes("bgm").length;
  env.advance(4000);
  assert.equal(ctx.notes("bgm").length, paused);
  assert.equal(env.audioContexts.length, 1);
});

test("the BGM stops at the end of the round and the end jingle still plays", () => {
  const env = started();
  const ctx = env.audioContexts[0];
  env.at(59990);
  const effects = ctx.notes("se").length;
  env.at(60100);
  assert.equal(env.$("screenResult").hidden, false);
  assert.equal(ctx.notes("se").length, effects + 4, "the four-note end jingle");
  const count = ctx.notes("bgm").length;
  const endedAt = ctx.currentTime;
  for (const osc of ctx.notes("bgm")) {
    assert.ok(osc.stopAt <= endedAt + 0.0601);
  }
  env.advance(30000);
  env.setHidden(true);
  env.setHidden(false);
  env.advance(5000);
  assert.equal(ctx.notes("bgm").length, count, "no music on the result screen");
  assertNoOverlap(ctx, "end of round");
});

test("retry restarts the tune from the top on the same context, never doubled", () => {
  const env = started();
  const ctx = env.audioContexts[0];
  env.at(60100);
  const before = ctx.notes("bgm").length;
  env.click("retryButton");
  env.click("retryButton");
  env.advance(15000);
  const fresh = ctx.notes("bgm").slice(before);
  const melody = voiceOf(fresh, "square");
  assert.ok(melody.length > 20);
  // The second press restarts the round at once: its notes replace the first press's.
  const live = audible(melody);
  assert.deepEqual(live.map((osc) => osc.frequency.value), tune("melody", live.length), "from the first note of the score");
  assertNoOverlap(ctx, "retry");
  assert.equal(env.audioContexts.length, 1);
  assert.equal(env.rafCallbacks.size, 1);
  assert.equal(env.timeouts.size, 0);

  // Retry from a paused game, and a new challenge, behave the same.
  env.click("pauseButton");
  env.click("titleButton");
  env.start();
  env.advance(3000);
  env.advance(60100, 20);
  env.click("newChallengeButton");
  env.advance(4000);
  assertNoOverlap(ctx, "title, start and new challenge");
  assert.equal(env.audioContexts.length, 1);
  assert.deepEqual(env.audioErrors, []);
});

test("sound effects and BGM have their own switch and volume, set before starting", () => {
  const storage = createStorage();
  const env = boot({ hash: HASH, storage });
  env.click("startSoundButton");
  assert.equal(env.$("soundOverlay").hidden, false);
  assert.equal(env.$("screenStart").inert, true);
  assert.equal(env.document.activeElement, env.$("soundCloseButton"));
  assert.deepEqual(["seToggle", "seLevel", "bgmToggle", "bgmLevel"].map(env.text), ["♪ オン", "5/5", "♪ オン", "3/5"]);
  assert.equal(env.$("seToggle").getAttribute("aria-pressed"), "true");
  assert.equal(env.$("seUp").disabled, true);
  assert.equal(env.audioContexts.length, 0, "opening the panel is silent");

  // BGM volume: a one-bar sample plays so the level can be judged.
  env.click("bgmUp");
  assert.equal(env.audioContexts.length, 1);
  const ctx = env.audioContexts[0];
  assert.equal(env.text("bgmLevel"), "4/5");
  assert.equal(ctx.buses().bgm.gain.value, (4 / 5) * (4 / 5));
  assert.ok(ctx.notes("bgm").length > 0);
  assert.equal(ctx.notes("se").length, 0);
  env.click("bgmUp");
  assert.equal(env.$("bgmUp").disabled, true);
  env.click("bgmUp");
  assert.equal(env.text("bgmLevel"), "5/5");
  assertNoOverlap(ctx, "repeated samples");

  // BGM off leaves the effects alone.
  const sampled = ctx.notes("bgm").length;
  env.click("bgmToggle");
  assert.equal(env.text("bgmToggle"), "✕ オフ");
  assert.equal(env.$("bgmToggle").getAttribute("aria-pressed"), "false");
  assert.equal(env.$("bgmToggle").classList.contains("is-off"), true);
  assert.equal(env.text("soundText"), "効果音のみ");
  assert.equal(ctx.buses().bgm.gain.value, 0);
  assert.equal(ctx.buses().se.gain.value, 1);

  for (let i = 0; i < 6; i += 1) {
    env.click("seDown");
  }
  assert.equal(env.text("seLevel"), "1/5");
  assert.equal(env.$("seDown").disabled, true);
  assert.equal(ctx.buses().se.gain.value, (1 / 5) * (1 / 5));
  assert.equal(ctx.notes("se").length, 4, "each change plays one sample of that channel");
  assert.equal(ctx.notes("bgm").length, sampled);
  assert.deepEqual(JSON.parse(storage.data.get(Core.STORAGE_KEY)).audio, { seMuted: false, seVolume: 1, bgmMuted: true, bgmVolume: 5 });

  env.click("soundCloseButton");
  assert.equal(env.$("soundOverlay").hidden, true);
  assert.equal(env.$("screenStart").inert, false);
  assert.equal(env.document.activeElement, env.$("startSoundButton"));

  env.advance(1000);
  env.start();
  env.advance(5000);
  assert.equal(ctx.notes("bgm").length, sampled, "BGM off: the round is played without music");
  env.click("slot-0");
  assert.equal(ctx.notes("se").length, 5, "effects still play");
  assert.equal(env.audioContexts.length, 1);

  // A reload restores both channels.
  const reloaded = boot({ hash: HASH, storage });
  assert.deepEqual(["seToggle", "seLevel", "bgmToggle", "bgmLevel", "soundText"].map(reloaded.text), ["♪ オン", "1/5", "✕ オフ", "5/5", "効果音のみ"]);
  assert.match(reloaded.$("soundButton").getAttribute("aria-label"), /効果音のみ/);
  assert.deepEqual(env.audioErrors.concat(reloaded.audioErrors), []);
});

test("effects off keeps the BGM; the in-game sound button pauses first", () => {
  const stored = { [Core.STORAGE_KEY]: JSON.stringify({ v: 2, audio: { seMuted: true, seVolume: 5, bgmMuted: false, bgmVolume: 3 } }) };
  const env = started({ stored });
  const ctx = env.audioContexts[0];
  assert.equal(env.text("soundText"), "BGMのみ");
  env.click("slot-0");
  env.at(4000);
  assert.equal(ctx.notes("se").length, 0);
  assert.ok(ctx.notes("bgm").length > 10);

  env.click("soundButton");
  assert.equal(env.$("soundOverlay").hidden, false);
  assert.equal(env.$("pauseOverlay").hidden, false, "the game is paused behind the panel");
  assert.equal(env.$("pauseOverlay").inert, true);
  assert.equal(env.rafCallbacks.size, 0);
  const count = ctx.notes("bgm").length;
  env.click("seToggle");
  assert.equal(env.text("soundText"), "音あり");
  assert.equal(ctx.notes("se").length, 1);

  env.document.dispatch("keydown", { key: "Escape" });
  assert.equal(env.$("soundOverlay").hidden, true);
  assert.equal(env.$("pauseOverlay").hidden, false, "closing the panel does not resume the game");
  assert.equal(env.$("pauseOverlay").inert, false);
  assert.equal(env.document.activeElement, env.$("pauseSoundButton"));
  env.advance(5000);
  assert.equal(ctx.notes("bgm").length, count);
  assert.equal(env.text("hudTime"), "56");

  env.click("resumeButton");
  env.advance(3000);
  assert.ok(ctx.notes("bgm").length > count);
  assertNoOverlap(ctx, "sound panel");
});

test("with both channels off no audio context is opened until one is switched on", () => {
  const stored = { [Core.STORAGE_KEY]: JSON.stringify({ v: 2, audio: { seMuted: true, seVolume: 4, bgmMuted: true, bgmVolume: 2 } }) };
  const env = started({ stored });
  assert.equal(env.text("soundText"), "音なし");
  assert.equal(env.$("soundButton").classList.contains("is-muted"), true);
  env.click("slot-0");
  env.at(5000);
  assert.equal(env.audioContexts.length, 0);

  env.click("soundButton");
  env.click("bgmToggle");
  assert.equal(env.audioContexts.length, 1);
  const ctx = env.audioContexts[0];
  assert.equal(ctx.buses().bgm.gain.value, (2 / 5) * (2 / 5));
  env.click("soundCloseButton");
  env.click("resumeButton");
  env.advance(3000);
  assert.ok(ctx.notes("bgm").length > 0);
  assert.equal(ctx.notes("se").length, 0);

  // Switching everything off again mid-game silences and suspends it.
  env.click("soundButton");
  const count = ctx.notes("bgm").length;
  env.click("bgmToggle");
  assert.equal(ctx.state, "suspended");
  env.click("soundCloseButton");
  env.click("resumeButton");
  env.advance(5000);
  assert.equal(ctx.notes("bgm").length, count);
  assert.equal(ctx.state, "suspended");
  assert.equal(env.audioContexts.length, 1);
});

test("a version 1 mute carries over as both channels off", () => {
  const env = boot({ hash: HASH, stored: { [Core.LEGACY_STORAGE_KEY]: '{"v":1,"bestScore":0,"nickname":"","muted":true}' } });
  assert.equal(env.text("soundText"), "音なし");
  assert.deepEqual(["seToggle", "bgmToggle"].map(env.text), ["✕ オフ", "✕ オフ"]);
});

test("the game runs without Web Audio support", () => {
  const env = started({ audio: false });
  cookPerfect(env, 0, 0);
  assert.equal(env.text("hudScore"), String(PLAIN_ITEM.base));
  env.click("soundButton");
  env.click("bgmUp");
  env.click("seToggle");
  assert.equal(env.text("bgmLevel"), "4/5");
  env.click("soundCloseButton");
  env.click("resumeButton");
  env.at(60100, 20);
  assert.equal(env.$("screenResult").hidden, false);
});

// ---- mobile design -------------------------------------------------------------------

const px = (text, property) => {
  const match = new RegExp("(?:^|[\\s;])" + property + ":\\s*(\\d+)px").exec(text);
  assert.ok(match, property);
  return Number(match[1]);
};

test("six ingredients sit in a 3 x 2 tray on phones and 2 x 3 beside the grill on desktop", () => {
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const desktop = css.slice(css.indexOf("@media (min-width: 900px)"), css.indexOf("@media (prefers-reduced-motion"));
  const small = css.slice(css.indexOf("@media (max-height: 700px)"), css.indexOf("@media (min-width: 900px)"));
  const base = css.slice(0, css.indexOf("@media (max-height: 700px)"));
  assert.ok(desktop && small && base);

  assert.match(block(base, ".tray"), /grid-template-columns:\s*repeat\(3,/);
  assert.match(block(desktop, ".tray"), /grid-template-columns:\s*repeat\(2,/);
  assert.match(block(base, ".grill"), /grid-template-columns:\s*repeat\(3,/);
  assert.match(block(base, ".game"), /grid-template-rows:\s*auto auto auto auto minmax\(0, 1fr\) auto auto/, "only the grill row stretches");
  assert.match(block(base, ".app"), /overflow:\s*hidden/, "one screen, no page scroll");
  assert.match(block(base, ".app"), /height:\s*100dvh/);
  // On desktop the grill takes the wide column and the side column holds the rest.
  assert.match(block(desktop, ".game"), /"grill hud"\s*"grill rank"\s*"grill popular"\s*"grill tray"/);

  // Touch targets stay at 44px or more.
  assert.ok(px(block(base, ".slot"), "min-height") >= 44 && px(block(base, ".slot"), "min-width") >= 44);
  assert.ok(px(block(base, ".ing"), "min-height") >= 44 && px(block(small, ".ing"), "min-height") >= 44);
  assert.ok(px(block(base, ".icon-btn"), "min-height") >= 44);
  assert.ok(px(block(base, ".step-btn"), "min-height") >= 44 && px(block(base, ".step-btn"), "min-width") >= 44);
  assert.ok(px(block(base, ".btn"), "min-height") >= 44);
  assert.ok(px(block(base, ".sound-row .sound-toggle"), "min-height") >= 44);

  // The top three is one slim line on phones.
  assert.ok(px(block(base, ".rank"), "min-height") <= 28);
  assert.match(block(base, ".rank-list"), /grid-template-columns:\s*repeat\(3,/);
  assert.match(block(base, ".rank-name"), /text-overflow:\s*ellipsis/);
});

test("the declared sizes leave the grill most of a 360x640 and a 390x844 screen", () => {
  // Arithmetic on the CSS numbers, not a browser measurement: the fixed rows
  // are added up and the grill gets what is left.
  const css = read("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const small = css.slice(css.indexOf("@media (max-height: 700px)"), css.indexOf("@media (min-width: 900px)"));
  const base = css.slice(0, css.indexOf("@media (max-height: 700px)"));
  const budget = (height, rules) => {
    const gap = px(block(rules, ".game"), "gap");
    const top = px(block(base, ".topbar"), "min-height");
    const hud = 62; // two text lines, padding and border of a HUD card
    const rank = px(block(rules, ".rank"), "min-height") + 6; // the title may wrap to two lines
    const popular = px(block(rules, ".popular"), "min-height");
    const status = px(block(base, ".status"), "min-height");
    const tray = px(block(rules, ".ing"), "min-height") * 2 + 8;
    const padding = 16;
    return height - (top + hud + rank + popular + status + tray + padding + gap * 6);
  };
  const at640 = budget(640, small);
  const at844 = budget(844, base);
  assert.ok(at640 >= 250, "360x640 leaves " + at640 + "px for the grill row");
  assert.ok(at640 / 640 > 0.38);
  assert.ok(at844 >= 420, "390x844 leaves " + at844 + "px for the grill row");
  // Two rows of slots are each well above the 44px minimum.
  assert.ok((at640 - 32 - 6) / 2 >= 100);
});

// ---- static page checks --------------------------------------------------------------

test("the page is static, loads no external resources and has no heat slider", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const js = ["core.js", "art.js", "i18n.js", "app.js"].map(read).join("\n");

  assert.match(html, /<title>BBQ Party<\/title>/);
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//, "no external scripts, styles or fonts");
  assert.doesNotMatch(css, /@import|url\(/);
  assert.doesNotMatch(read("core.js"), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/);
  assert.match(read("ranking-config.js"), /apiBase: "https:\/\/cyhqsliolbcgxvlblvas\.supabase\.co\/functions\/v1\/bbq-ranking"/);
  assert.doesNotMatch(html, /type="range"/);
  assert.doesNotMatch(html + js, /heat|火力/i);
  assert.equal((html.match(/class="slot"/g) || []).length, 6);
  assert.equal((html.match(/class="ing"/g) || []).length, 6);
  for (const id of Core.INGREDIENT_IDS) {
    assert.match(html, new RegExp('id="ing-' + id + '" data-ingredient="' + id + '"'));
  }
  assert.match(html, /公開ランキングへの送信は別に選べます/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});

test("instructions do not depend on where the tray happens to be", () => {
  const html = read("index.html");
  const texts = [html, read("app.js"), read("README.md"), read("README.ja.md")].join("\n");
  assert.match(html.replace(/<[^>]*>/g, ""), /食材トレイから食材をえらぶ/);
  assert.doesNotMatch(texts, /下のトレイ|右のトレイ|上のトレイ|左のトレイ|画面下の|画面右の/);
  assert.doesNotMatch(texts, /tray (?:below|at the bottom|on the right)|(?:bottom|right-hand|lower) tray/i);
});

test("the favicon is a self-made same-origin asset with fallbacks", () => {
  const html = read("index.html");
  assert.match(html, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="icon" href="favicon\.ico" sizes="32x32">/);
  assert.match(html, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/);

  const svg = read("favicon.svg");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64">/);
  assert.doesNotMatch(svg, /<script|<image|<use|<foreignObject|href=|url\(|style=|on\w+=/i);

  const ico = fs.readFileSync(path.join(ROOT, "favicon.ico"));
  assert.deepEqual([...ico.subarray(0, 8)], [0, 0, 1, 0, 1, 0, 32, 32], "one 32x32 icon");
  const png = fs.readFileSync(path.join(ROOT, "apple-touch-icon.png"));
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.deepEqual([...png.subarray(0, 8)], signature);
  assert.deepEqual([...ico.subarray(22, 30)], signature, "the ICO holds a PNG");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [180, 180]);
  assert.ok(ico.length < 4096 && png.length < 16384);
});

test("the page asks not to be indexed and ships a strict CSP that its own code obeys", () => {
  const html = read("index.html");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  // A robots.txt that blocks crawling would stop crawlers from ever reading the noindex.
  assert.equal(fs.existsSync(path.join(ROOT, "robots.txt")), false);

  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  assert.ok(meta, "CSP meta");
  const policy = {};
  for (const part of meta[1].split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    policy[name] = values.join(" ");
  }
  assert.deepEqual(policy, {
    "default-src": "'none'",
    "script-src": "'self'",
    "style-src": "'self'",
    "img-src": "'self'",
    "connect-src": "https://cyhqsliolbcgxvlblvas.supabase.co",
    "object-src": "'none'",
    "base-uri": "'none'",
    "form-action": "'none'",
  });
  // frame-ancestors, sandbox and report-uri are ignored in a meta tag: not claimed.
  assert.doesNotMatch(meta[1], /unsafe-inline|unsafe-eval|frame-ancestors|report-uri|sandbox|\*|data:|blob:/);
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<link"), "the policy comes before anything it governs");
  assert.ok(html.indexOf(meta[0]) < html.indexOf("<script"));

  // What the policy forbids must not be in the page, or the game would break.
  assert.doesNotMatch(html, /<style|\sstyle="|\son[a-z]+="|javascript:|<iframe|<object|<embed|<base\b|<audio|<video/i);
  assert.deepEqual(html.match(/<script[^>]*>[^<]*<\/script>/g), [
    '<script src="core.js"></script>',
    '<script src="art.js"></script>',
    '<script src="i18n.js"></script>',
    '<script src="ranking-config.js"></script>',
    '<script src="ranking.js"></script>',
    '<script src="app.js"></script>',
  ]);
  assert.deepEqual(html.match(/<link rel="stylesheet"[^>]*>/g), ['<link rel="stylesheet" href="styles.css">']);
  const js = ["core.js", "art.js", "app.js"].map(read).join("\n");
  assert.doesNotMatch(js, /setAttribute\("style"|cssText|createElement\("(?:script|style|link|iframe|img)"\)|new Image\(|import\(|new Worker|\beval\(|new Function|setTimeout\(\s*["'`]/);
  assert.doesNotMatch(read("styles.css"), /url\(|@import|@font-face/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.match(html, /<form class="card" id="startForm" novalidate>/, "the form has no action; submit is handled in script");
});

test("no workflow, dependency or secret is added to the repository", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.private, true);
  const workflows = path.join(ROOT, ".github", "workflows");
  if (fs.existsSync(workflows)) {
    for (const file of fs.readdirSync(workflows)) {
      const text = fs.readFileSync(path.join(workflows, file), "utf8");
      assert.match(text, /^permissions:/m, file + " declares its permissions");
      assert.doesNotMatch(text, /permissions:\s*write-all|secrets\.(?!GITHUB_TOKEN)/, file);
    }
  }
});

test("both READMEs describe the same release and its limits", () => {
  const en = read("README.md");
  const ja = read("README.ja.md");
  for (const readme of [en, ja]) {
    for (const fact of ["#v=2&seed=", "#v=1&seed=", "noindex", "Content-Security-Policy", "localStorage", "360×640", "390×844", "X-Frame-Options", "BROWSER-VERIFICATION.md"]) {
      assert.ok(readme.includes(fact), fact);
    }
    for (const item of Core.INGREDIENTS) {
      const row = readme.split("\n").find((line) => line.startsWith("|") && line.includes(item.name) && line.includes(item.nameEn));
      assert.ok(row, item.id + " has a table row");
      assert.ok(row.includes(String(item.base)) && row.includes((item.idealMs / 1000).toFixed(1)) && row.includes((item.perfectMs / 1000).toFixed(1)), row);
    }
  }
  const headings = (text) => text.split("\n").filter((line) => line.startsWith("## ")).length;
  assert.equal(headings(en), headings(ja), "same sections in both languages");
  assert.match(en, /not (?:an )?access control/i);
  assert.match(ja, /アクセス制限ではありません/);
});


// A slow leaderboard must never gate or correct the publication disclosure.
for (const mode of ["delayed", "failed"]) {
  test("publication immediately shows this round's name/score when top is " + mode, async () => {
    const pendingTop = [];
    let issued = 0;
    const env = started({
      nickname: "First",
      rankingConfig: { apiBase: "https://ranking.example.test" },
      fetch: async (url, options) => {
        if (url.endsWith("/runs")) {
          const body = JSON.parse(options.body);
          issued++;
          return new Response(JSON.stringify({
            runId: "10000000-0000-4000-8000-" + String(issued).padStart(12, "0"),
            seed: body.seed, version: 2, mode: "standard", expiresAt: Date.now() + 900000,
          }));
        }
        if (url.includes("/top?")) return new Promise((resolve, reject) => pendingTop.push({ resolve, reject }));
        throw new Error("unexpected publication request");
      },
    });
    await env.flush();
    let priorScore = null;
    for (const [name, count] of [["First", 1], ["Second", 2]]) {
      if (name === "Second") {
        env.again(name);
        await env.flush();
      }
      finishRound(env, count);
      const score = env.text("resultScore");
      assert.ok(Number(score) > 0);
      if (priorScore !== null) assert.notEqual(score, priorScore, "second round has a different score");
      priorScore = score;
      // No await or GET completion before checking the just-opened result.
      assert.equal(env.$("screenResult").hidden, false);
      assert.ok(env.text("publishDisclosure").includes("「" + name + "」"), "current name");
      assert.ok(env.text("publishDisclosure").includes("スコア " + score + " 点"), "current score immediately");
      assert.match(env.text("onlineResultStatus"), /読み込み中/);
      assert.equal(env.$("publishButton").disabled, true, "consent remains off");
      const request = pendingTop[pendingTop.length - 1];
      assert.ok(request, "result refresh is pending");
      if (mode === "failed") request.reject(new Error("leaderboard unavailable"));
      else env.advance(8001, 0); // Client timeout, while top fetch still has not answered.
      await env.flush();
      assert.match(env.text("onlineResultStatus"), /接続できません/);
      assert.ok(env.text("publishDisclosure").includes("スコア " + score + " 点"), "failure never replaces current score");
      env.$("publishConsent").checked = true;
      env.$("publishConsent").dispatch("change");
      assert.equal(env.$("publishButton").disabled, false, "only current verified run can be published");
      assert.ok(env.text("publishDisclosure").includes("「" + name + "」"), "consent uses current name");
    }
  });
}
