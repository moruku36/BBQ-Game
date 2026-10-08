"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

// Deterministic clock: tests move time by hand, nothing waits.
function setup(seed, startAt) {
  const clock = { t: startAt === undefined ? 5000 : startAt };
  const game = Core.createGame({ seed: seed === undefined ? 7 : seed, now: () => clock.t });
  const t0 = clock.t;
  return {
    clock,
    game,
    at(activeMs) {
      clock.t = t0 + activeMs;
    },
  };
}

// Places `id` in `slot` at active time `placeAt` and collects it `age` ms later.
function cook(ctx, slot, id, placeAt, age) {
  ctx.at(placeAt);
  ctx.game.select(id);
  assert.equal(ctx.game.tapSlot(slot).type, "placed");
  ctx.at(placeAt + age);
  return ctx.game.tapSlot(slot);
}

// A seed whose phase-0 popular ingredient is not `id`, so no bonus interferes.
function seedWithoutPopular(id) {
  for (let seed = 0; seed < 1000; seed += 1) {
    if (Core.buildSchedule(seed)[0] !== id) {
      return seed;
    }
  }
  throw new Error("no seed found");
}

function seedWithPopular(id) {
  for (let seed = 0; seed < 1000; seed += 1) {
    if (Core.buildSchedule(seed)[0] === id) {
      return seed;
    }
  }
  throw new Error("no seed found");
}

// ---- cooking boundaries -----------------------------------------------------

const SPEC = {
  shrimp: { ideal: 3000, base: 80, perfect: 800, goodStart: 2400, perfectEnd: 3800, burn: 4500 },
  sausage: { ideal: 3800, base: 100, perfect: 800, goodStart: 3040, perfectEnd: 4600, burn: 5700 },
  shiitake: { ideal: 4200, base: 100, perfect: 1400, goodStart: 3360, perfectEnd: 5600, burn: 6300 },
  kalbi: { ideal: 4700, base: 125, perfect: 800, goodStart: 3760, perfectEnd: 5500, burn: 7050 },
  corn: { ideal: 6000, base: 160, perfect: 800, goodStart: 4800, perfectEnd: 6800, burn: 9000 },
  steak: { ideal: 7000, base: 210, perfect: 500, goodStart: 5600, perfectEnd: 7500, burn: 10500 },
};
const ORIGINAL_FOUR = ["shrimp", "sausage", "kalbi", "corn"];

test("ingredients match the design table", () => {
  assert.deepEqual(Core.INGREDIENT_IDS, ["shrimp", "sausage", "shiitake", "kalbi", "corn", "steak"]);
  assert.deepEqual(Object.keys(SPEC), Core.INGREDIENT_IDS);
  for (const [id, spec] of Object.entries(SPEC)) {
    const item = Core.ingredientById(id);
    assert.equal(item.idealMs, spec.ideal);
    assert.equal(item.base, spec.base);
    assert.equal(item.perfectMs, spec.perfect);
    assert.deepEqual(Core.windowsFor(id), {
      goodStartMs: spec.goodStart,
      perfectStartMs: spec.ideal,
      perfectEndMs: spec.perfectEnd,
      burnMs: spec.burn,
    });
    assert.ok(item.name && item.short && Array.from(item.short).length <= 5, id + " has a tray-sized short name");
  }
});

test("the four original ingredients keep their version 1 timing and points", () => {
  const v1 = { shrimp: [3000, 80], sausage: [3800, 100], kalbi: [4700, 125], corn: [6000, 160] };
  for (const id of ORIGINAL_FOUR) {
    const item = Core.ingredientById(id);
    assert.deepEqual([item.idealMs, item.base, item.perfectMs], v1[id].concat(Core.PERFECT_WINDOW_MS), id);
  }
});

test("PERFECT width gives each new ingredient its character", () => {
  const shiitake = Core.ingredientById("shiitake");
  const steak = Core.ingredientById("steak");
  const widths = Core.INGREDIENTS.map((item) => item.perfectMs);
  assert.equal(shiitake.perfectMs, Math.max(...widths), "shiitake has the widest PERFECT window");
  assert.equal(steak.perfectMs, Math.min(...widths), "steak has the narrowest PERFECT window");
  assert.equal(widths.filter((width) => width === shiitake.perfectMs).length, 1);
  assert.equal(widths.filter((width) => width === steak.perfectMs).length, 1);
  // Mid speed: slower than the fastest, faster than the slowest of the old four.
  assert.ok(shiitake.idealMs > SPEC.sausage.ideal && shiitake.idealMs < SPEC.kalbi.ideal);
  // Slowest and worth the most.
  assert.equal(steak.idealMs, Math.max(...Core.INGREDIENTS.map((item) => item.idealMs)));
  assert.equal(steak.base, Math.max(...Core.INGREDIENTS.map((item) => item.base)));
  // Every window still leaves a late GOOD band before the burn.
  for (const id of Core.INGREDIENT_IDS) {
    const w = Core.windowsFor(id);
    assert.ok(w.perfectEndMs < w.burnMs, id);
  }
});

// Points per second a slot earns from an ingredient when the tap lands within
// +-errorMs of the middle of its PERFECT window: PERFECT when inside the
// window, otherwise GOOD (60%).
function ratePerSecond(item, errorMs) {
  const perfectChance = errorMs <= 0 ? 1 : Math.min(1, item.perfectMs / (2 * errorMs));
  return ((item.base * (0.6 + 0.4 * perfectChance)) / item.idealMs) * 1000;
}

test("no ingredient is the best choice for every player", () => {
  const perfectRate = (id) => ratePerSecond(Core.ingredientById(id), 0);
  const rates = Core.INGREDIENT_IDS.map(perfectRate);
  assert.ok(Math.max(...rates) / Math.min(...rates) < 1.3, "PERFECT rates stay within 30% of each other");
  for (const id of ORIGINAL_FOUR) {
    assert.ok(perfectRate("steak") > perfectRate(id), "steak pays most when timed perfectly");
    assert.ok(perfectRate("shiitake") < perfectRate(id), "shiitake pays least when timed perfectly");
    // A steak that only reaches GOOD earns less than any PERFECT.
    assert.ok(perfectRate("steak") * 0.6 < perfectRate(id));
  }
  assert.ok(perfectRate("steak") * 0.6 < perfectRate("shiitake"));

  const bestAt = (errorMs) =>
    Core.INGREDIENTS.slice().sort((a, b) => ratePerSecond(b, errorMs) - ratePerSecond(a, errorMs))[0].id;
  assert.equal(bestAt(200), "steak", "precise timing: the expert ingredient wins");
  assert.ok(ORIGINAL_FOUR.includes(bestAt(400)), "average timing: the original four win");
  assert.equal(bestAt(700), "shiitake", "loose timing: the beginner ingredient wins");
});

test("judging uses the exact inclusive/exclusive boundaries for every ingredient", () => {
  for (const [id, spec] of Object.entries(SPEC)) {
    const cases = [
      [0, "RAW"],
      [spec.goodStart - 1, "RAW"],
      [spec.goodStart - 0.001, "RAW"],
      [spec.goodStart, "GOOD"], // 0.8T inclusive
      [spec.ideal - 0.001, "GOOD"], // T exclusive
      [spec.ideal, "PERFECT"], // T inclusive
      [spec.perfectEnd, "PERFECT"], // T + PERFECT width inclusive
      [spec.perfectEnd + 0.001, "GOOD"],
      [spec.burn - 1, "GOOD"],
      [spec.burn, "GOOD"], // 1.5T inclusive
      [spec.burn + 0.001, "BURNT"],
      [spec.burn + 60000, "BURNT"],
    ];
    for (const [age, grade] of cases) {
      assert.equal(Core.judge(id, age), grade, id + " at " + age + "ms");
    }
  }
});

test("stages tell early GOOD from late GOOD", () => {
  assert.equal(Core.cookStage("shrimp", 2500), "good-early");
  assert.equal(Core.cookStage("shrimp", 3000), "perfect");
  assert.equal(Core.cookStage("shrimp", 4000), "good-late");
  assert.equal(Core.cookStage("shrimp", 4501), "burnt");
});

test("PERFECT never outlives 1.5T when T + 0.8s would pass it", () => {
  // T = 1.2s: T + 0.8s = 2.0s is past 1.5T = 1.8s, so PERFECT ends at 1.8s.
  assert.equal(Core.cookWindows(1200).perfectEndMs, 1800);
  assert.equal(Core.stageForAge(1200, 1800), "perfect");
  assert.equal(Core.stageForAge(1200, 1800.001), "burnt");
  // T = 3.0s: T + 0.8s is below 1.5T, so a late GOOD band runs to 1.5T inclusive.
  assert.equal(Core.stageForAge(3000, 3800.001), "good-late");
  assert.equal(Core.stageForAge(3000, 4500), "good-late");
  // An explicit PERFECT width is honoured and capped the same way.
  assert.equal(Core.stageForAge(3000, 3500, 500), "perfect");
  assert.equal(Core.stageForAge(3000, 3500.001, 500), "good-late");
  assert.equal(Core.cookWindows(1200, 5000).perfectEndMs, 1800);
});

test("steak and shiitake are judged by their own PERFECT width in a game", () => {
  const steak = setup(seedWithoutPopular("steak"));
  steak.game.start();
  assert.equal(cook(steak, 0, "steak", 0, 6999).grade, "GOOD");
  assert.equal(cook(steak, 1, "steak", 0, 7000).grade, "PERFECT");
  assert.equal(cook(steak, 2, "steak", 0, 7500).grade, "PERFECT");
  const late = cook(steak, 3, "steak", 0, 7501);
  assert.deepEqual([late.grade, late.stage], ["GOOD", "good-late"]);
  assert.equal(cook(steak, 4, "steak", 0, 10500).grade, "GOOD");
  assert.equal(cook(steak, 5, "steak", 0, 10501).grade, "BURNT");

  const shiitake = setup(seedWithoutPopular("shiitake"));
  shiitake.game.start();
  assert.equal(cook(shiitake, 0, "shiitake", 0, 3360).grade, "GOOD");
  assert.equal(cook(shiitake, 1, "shiitake", 0, 5600).grade, "PERFECT", "still PERFECT 1.4s after the ideal time");
  assert.equal(cook(shiitake, 2, "shiitake", 0, 5601).grade, "GOOD");
  assert.equal(cook(shiitake, 3, "shiitake", 0, 6301).grade, "BURNT");
});

test("non-numeric ages are treated as RAW, never as a score", () => {
  assert.equal(Core.judge("corn", NaN), "RAW");
  assert.equal(Core.judge("corn", -5), "RAW");
});

// ---- scoring -----------------------------------------------------------------

test("GOOD is 60% of base and PERFECT is 100% of base", () => {
  for (const [id, spec] of Object.entries(SPEC)) {
    assert.equal(Core.scoreCollection(id, "PERFECT", 0, false).points, spec.base);
    assert.equal(Core.scoreCollection(id, "GOOD", 0, false).points, (spec.base * 3) / 5);
    assert.equal(Core.scoreCollection(id, "RAW", 0, false).points, 0);
    assert.equal(Core.scoreCollection(id, "BURNT", 0, false).points, 0);
  }
});

test("multiplier is min(2, 1 + 0.1n) from the combo before collection", () => {
  const expected = { 0: 100, 1: 110, 5: 150, 9: 190, 10: 200, 11: 200, 40: 200 };
  for (const [combo, points] of Object.entries(expected)) {
    assert.equal(Core.scoreCollection("sausage", "PERFECT", Number(combo), false).points, points);
  }
  assert.equal(Core.multiplierTenths(0), 10);
  assert.equal(Core.multiplierTenths(10), 20);
  assert.equal(Core.multiplierTenths(99), 20);
});

test("fractional scores round half up exactly", () => {
  // 80 x 0.6 x 1.1 = 52.8 -> 53
  assert.equal(Core.scoreCollection("shrimp", "GOOD", 1, false).points, 53);
  // 125 x 0.6 x 1.1 = 82.5 -> 83
  assert.equal(Core.scoreCollection("kalbi", "GOOD", 1, false).points, 83);
  // 125 x 1.3 = 162.5 -> 163
  assert.equal(Core.scoreCollection("kalbi", "PERFECT", 3, false).points, 163);
});

test("popular bonus is a flat +50 added after the multiplier", () => {
  // combo 10 -> x2.0: 100 x 2 + 50 = 250, not (100 + 50) x 2 = 300.
  const perfect = Core.scoreCollection("sausage", "PERFECT", 10, true);
  assert.equal(perfect.points, 250);
  assert.equal(perfect.bonus, 50);
  assert.equal(perfect.cookedPoints, 200);
  assert.equal(Core.scoreCollection("sausage", "GOOD", 0, true).points, 110);
  // No bonus without a successful cook.
  assert.equal(Core.scoreCollection("sausage", "RAW", 10, true).points, 0);
  assert.equal(Core.scoreCollection("sausage", "BURNT", 10, true).points, 0);
});

// ---- game: collecting and combo ------------------------------------------------

test("raw food scores 0, including straight after placing", () => {
  const ctx = setup(seedWithoutPopular("shrimp"));
  ctx.game.start();
  const instant = cook(ctx, 0, "shrimp", 0, Core.TAP_GUARD_MS);
  assert.equal(instant.grade, "RAW");
  assert.equal(instant.points, 0);
  const almost = cook(ctx, 1, "shrimp", 1000, 2399);
  assert.equal(almost.grade, "RAW");
  assert.equal(ctx.game.snapshot().score, 0);
  assert.equal(ctx.game.results().rawCount, 2);
});

test("collection in the game honours the PERFECT end and 1.5T boundaries", () => {
  const ctx = setup(seedWithoutPopular("shrimp"));
  ctx.game.start();
  assert.equal(cook(ctx, 0, "shrimp", 0, 2400).grade, "GOOD");
  assert.equal(cook(ctx, 1, "shrimp", 0, 3000).grade, "PERFECT");
  assert.equal(cook(ctx, 2, "shrimp", 0, 3800).grade, "PERFECT");
  assert.equal(cook(ctx, 3, "shrimp", 0, 3801).grade, "GOOD");
  const edge = cook(ctx, 4, "shrimp", 0, 4500);
  assert.equal(edge.grade, "GOOD");
  assert.equal(ctx.game.results().burnedCount, 0);
  assert.equal(cook(ctx, 5, "shrimp", 0, 4501).grade, "BURNT");
  assert.equal(ctx.game.results().burnedCount, 1);
});

test("combo grows by one per GOOD/PERFECT and scoring uses the combo before", () => {
  const ctx = setup(seedWithoutPopular("sausage"));
  ctx.game.start();
  const first = cook(ctx, 0, "sausage", 0, 3800);
  assert.deepEqual([first.comboBefore, first.comboAfter, first.points], [0, 1, 100]);
  const second = cook(ctx, 1, "sausage", 0, 3900);
  assert.deepEqual([second.comboBefore, second.comboAfter, second.points], [1, 2, 110]);
  const third = cook(ctx, 2, "sausage", 0, 5000); // late GOOD: 60 x 1.2
  assert.deepEqual([third.grade, third.comboBefore, third.comboAfter, third.points], ["GOOD", 2, 3, 72]);
  const snap = ctx.game.snapshot();
  assert.equal(snap.score, 282);
  assert.equal(snap.combo, 3);
  assert.equal(snap.multiplierTenths, 13);
});

test("collecting RAW resets the combo but keeps max combo", () => {
  const ctx = setup(seedWithoutPopular("shrimp"));
  ctx.game.start();
  cook(ctx, 0, "shrimp", 0, 3000);
  cook(ctx, 1, "shrimp", 0, 3100);
  const raw = cook(ctx, 2, "shrimp", 3200, 500);
  assert.deepEqual([raw.grade, raw.comboBefore, raw.comboAfter], ["RAW", 2, 0]);
  const next = cook(ctx, 3, "shrimp", 4000, 3000);
  assert.equal(next.points, 80); // multiplier is back to x1.0
  assert.equal(ctx.game.results().maxCombo, 2);
});

test("a burn fires once at the 1.5T crossing and resets the combo once", () => {
  const ctx = setup(seedWithoutPopular("shrimp"));
  ctx.game.start();
  ctx.game.select("shrimp");
  ctx.at(0);
  ctx.game.tapSlot(0); // will be left to burn at 4500

  ctx.at(4500);
  ctx.game.sync();
  assert.deepEqual(ctx.game.drainEvents(), [], "age == 1.5T is still GOOD");

  ctx.at(4500.5);
  ctx.game.sync();
  const events = ctx.game.drainEvents();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: "burn", slot: 0, ingredient: "shrimp", atMs: 4500 });
  assert.equal(ctx.game.results().burnedCount, 1);

  // Build a combo while the burnt food is still sitting on the grill.
  cook(ctx, 1, "shrimp", 5000, 3000);
  cook(ctx, 2, "shrimp", 5000, 3200);
  for (let t = 8300; t < 12000; t += 7) {
    ctx.at(t);
    ctx.game.sync();
  }
  assert.equal(ctx.game.snapshot().combo, 2, "the burnt item must not keep resetting the combo");
  assert.equal(ctx.game.drainEvents().filter((event) => event.type === "burn").length, 0);
  assert.equal(ctx.game.results().burnedCount, 1);

  // Clearing the burnt food gives nothing and does not reset again.
  const cleared = ctx.game.tapSlot(0);
  assert.deepEqual([cleared.grade, cleared.points, cleared.comboAfter], ["BURNT", 0, 2]);
  assert.equal(ctx.game.results().burnedCount, 1);
});

test("a burn that happened before a tap is applied before that tap scores", () => {
  const ctx = setup(seedWithoutPopular("shrimp"));
  ctx.game.start();
  cook(ctx, 0, "shrimp", 0, 3000); // combo 1
  ctx.at(3100);
  ctx.game.tapSlot(1); // shrimp, burns at 7600
  ctx.at(3200);
  ctx.game.tapSlot(2); // shrimp, perfect window 6200..7000... collected late below
  // No sync happens between 3200 and 7700: the tap itself must notice the burn.
  ctx.at(7700);
  const late = ctx.game.tapSlot(2);
  assert.equal(late.grade, "GOOD");
  assert.equal(late.comboBefore, 0);
  assert.equal(late.points, 48);
});

// ---- popular schedule ----------------------------------------------------------

test("the schedule is deterministic per seed with six phases and no adjacent repeat", () => {
  for (let seed = 0; seed < 3000; seed += 1) {
    const schedule = Core.buildSchedule(seed);
    assert.equal(schedule.length, 6);
    for (let i = 0; i < schedule.length; i += 1) {
      assert.ok(Core.INGREDIENT_IDS.includes(schedule[i]));
      if (i > 0) {
        assert.notEqual(schedule[i], schedule[i - 1], "seed " + seed + " repeats at phase " + i);
      }
    }
    assert.deepEqual(Core.buildSchedule(seed), schedule);
  }
  assert.deepEqual(Core.buildSchedule(Core.MAX_SEED).length, 6);
});

test("known seeds keep producing the same schedule (challenge links stay valid)", () => {
  assert.deepEqual(Core.buildSchedule(1), Core.createGame({ seed: 1, now: () => 0 }).schedule);
  const distinct = new Set();
  const seen = new Set();
  for (let seed = 0; seed < 200; seed += 1) {
    const schedule = Core.buildSchedule(seed);
    distinct.add(schedule.join(","));
    schedule.forEach((id) => seen.add(id));
  }
  assert.ok(distinct.size > 50, "different seeds should give varied schedules");
  for (const id of Core.INGREDIENT_IDS) {
    assert.ok([...distinct].some((key) => key.startsWith(id)), id + " can open a challenge");
  }
  assert.equal(seen.size, 6, "all six ingredients take turns being popular");
});

// Pinned version 2 schedules. If one of these changes, existing v2 challenge
// links change meaning: bump CHALLENGE_VERSION instead of editing this table.
const V2_SCHEDULES = {
  0: ["sausage", "shrimp", "shiitake", "shrimp", "kalbi", "shiitake"],
  1: ["kalbi", "shrimp", "kalbi", "steak", "corn", "sausage"],
  7: ["shrimp", "sausage", "steak", "kalbi", "shiitake", "kalbi"],
  20261008: ["steak", "shiitake", "shrimp", "shiitake", "corn", "shrimp"],
  4294967295: ["steak", "shrimp", "corn", "steak", "corn", "shiitake"],
};

test("version 2 seeds are pinned to their six-ingredient schedules", () => {
  assert.equal(Core.CHALLENGE_VERSION, 2);
  assert.ok(Object.keys(V2_SCHEDULES).length >= 4);
  for (const [seed, schedule] of Object.entries(V2_SCHEDULES)) {
    assert.deepEqual(Core.buildSchedule(Number(seed)), schedule, "seed " + seed);
  }
});

test("invalid seeds are rejected", () => {
  for (const bad of [-1, 1.5, NaN, Infinity, Core.MAX_SEED + 1, "7", null]) {
    assert.throws(() => Core.buildSchedule(bad), RangeError);
    assert.throws(() => Core.createGame({ seed: bad, now: () => 0 }), RangeError);
  }
});

test("popular ingredient changes every 10s and previews the next for the last 3s", () => {
  const schedule = ["shrimp", "corn", "kalbi", "sausage", "corn", "shrimp"];
  assert.equal(Core.popularAt(schedule, 0).current, "shrimp");
  assert.equal(Core.popularAt(schedule, 9999).current, "shrimp");
  assert.equal(Core.popularAt(schedule, 10000).current, "corn");
  assert.equal(Core.popularAt(schedule, 59999).current, "shrimp");
  assert.equal(Core.popularAt(schedule, 60000).phase, 5);

  assert.equal(Core.popularAt(schedule, 6999).showNext, false);
  const preview = Core.popularAt(schedule, 7000);
  assert.deepEqual([preview.showNext, preview.next, preview.msToNext], [true, "corn", 3000]);
  assert.equal(Core.popularAt(schedule, 9999).showNext, true);
  assert.equal(Core.popularAt(schedule, 10000).showNext, false);
  assert.equal(Core.popularAt(schedule, 58000).showNext, false, "the last phase has nothing to preview");
  assert.equal(Core.popularAt(schedule, 58000).next, null);
});

test("the +50 bonus follows the popular ingredient at the moment of collection", () => {
  const seed = seedWithPopular("shrimp");
  const schedule = Core.buildSchedule(seed);
  const ctx = setup(seed);
  ctx.game.start();
  const inPhase = cook(ctx, 0, "shrimp", 0, 3000);
  assert.deepEqual([inPhase.bonus, inPhase.points], [50, 130]);

  // Placed during phase 0 but collected at exactly 10.000s: phase 1 decides.
  const onBoundary = cook(ctx, 1, "shrimp", 7000, 3000);
  assert.equal(onBoundary.bonus, 0, "phase 1 never repeats phase 0");
  assert.equal(onBoundary.points, 88);

  const nextPopular = schedule[1];
  const ideal = Core.ingredientById(nextPopular).idealMs;
  const later = cook(ctx, 2, nextPopular, 11000, ideal);
  assert.equal(later.bonus, 50);

  const raw = cook(ctx, 3, nextPopular, 18000, 300);
  assert.deepEqual([raw.grade, raw.bonus, raw.points], ["RAW", 0, 0]);
});

// ---- time: start, pause, end ----------------------------------------------------

test("the timer does not run before start", () => {
  const ctx = setup();
  ctx.at(45000);
  assert.equal(ctx.game.snapshot().remainingMs, 60000);
  assert.equal(ctx.game.tapSlot(0).type, "ignored");
  ctx.game.start();
  assert.equal(ctx.game.snapshot().remainingMs, 60000);
  ctx.at(46000);
  assert.equal(ctx.game.snapshot().remainingMs, 59000);
});

test("pause freezes the timer and the food; only resume restarts them", () => {
  const ctx = setup(seedWithoutPopular("shrimp"));
  ctx.game.start();
  ctx.game.select("shrimp");
  ctx.at(1000);
  ctx.game.tapSlot(0);

  ctx.at(3000);
  assert.equal(ctx.game.pause(), true);
  assert.equal(ctx.game.status, "paused");

  ctx.at(3000 + 600000); // ten minutes in the background
  let snap = ctx.game.snapshot();
  assert.equal(snap.status, "paused");
  assert.equal(snap.activeMs, 3000);
  assert.equal(snap.slots[0].ageMs, 2000);
  assert.equal(snap.slots[0].stage, "raw");
  assert.equal(ctx.game.tapSlot(0).type, "ignored", "no collecting while paused");
  assert.deepEqual(ctx.game.drainEvents(), []);

  assert.equal(ctx.game.resume(), true);
  ctx.at(3000 + 600000 + 1000);
  snap = ctx.game.snapshot();
  assert.equal(snap.activeMs, 4000);
  assert.equal(snap.slots[0].ageMs, 3000);
  assert.equal(snap.slots[0].stage, "perfect");
  assert.equal(ctx.game.tapSlot(0).grade, "PERFECT");
});

test("pause and resume are no-ops in the wrong state", () => {
  const ctx = setup();
  assert.equal(ctx.game.pause(), false);
  assert.equal(ctx.game.resume(), false);
  ctx.game.start();
  assert.equal(ctx.game.start(), false);
  assert.equal(ctx.game.resume(), false);
  assert.equal(ctx.game.pause(), true);
  assert.equal(ctx.game.pause(), false);
});

test("the game ends at exactly 60s of active time and then accepts nothing", () => {
  const ctx = setup(seedWithoutPopular("shrimp"));
  ctx.game.start();
  ctx.game.select("shrimp");
  ctx.at(56500);
  ctx.game.tapSlot(0); // perfect from 59500
  ctx.at(59999);
  assert.equal(ctx.game.snapshot().status, "running");
  ctx.game.drainEvents();

  ctx.at(60000);
  // The tap arrives before any frame noticed the end: it must still be refused.
  assert.deepEqual(ctx.game.tapSlot(0), { type: "ignored", reason: "ended" });
  assert.deepEqual(ctx.game.tapSlot(1), { type: "ignored", reason: "ended" });
  assert.equal(ctx.game.status, "ended");
  assert.equal(ctx.game.snapshot().remainingMs, 0);

  ctx.at(99999);
  ctx.game.sync();
  ctx.game.snapshot();
  const ends = ctx.game.drainEvents().filter((event) => event.type === "end");
  assert.equal(ends.length, 1, "the end event fires once");
  assert.equal(ctx.game.snapshot().activeMs, 60000);
  assert.equal(ctx.game.pause(), false);
  assert.equal(ctx.game.results().score, 0);
});

test("food only burns if it crosses 1.5T inside the 60 seconds", () => {
  const ctx = setup();
  ctx.game.start();
  ctx.game.select("shrimp");
  ctx.at(55499);
  ctx.game.tapSlot(0); // crosses at 59999
  ctx.at(55500);
  ctx.game.tapSlot(1); // would cross exactly at 60000: the game is over first
  ctx.at(120000);
  ctx.game.sync();
  assert.equal(ctx.game.results().burnedCount, 1);
});

// ---- double taps and restart -----------------------------------------------------

test("rapid taps cannot collect twice or instantly pull the food back off", () => {
  const ctx = setup(seedWithoutPopular("shrimp"));
  ctx.game.start();
  ctx.game.select("shrimp");
  ctx.at(0);
  assert.equal(ctx.game.tapSlot(0).type, "placed");
  ctx.at(40);
  assert.deepEqual(ctx.game.tapSlot(0), { type: "ignored", reason: "guard" });
  assert.notEqual(ctx.game.snapshot().slots[0], null);

  ctx.at(3000);
  assert.equal(ctx.game.tapSlot(0).grade, "PERFECT");
  assert.deepEqual(ctx.game.tapSlot(0), { type: "ignored", reason: "guard" });
  ctx.at(3050);
  assert.deepEqual(ctx.game.tapSlot(0), { type: "ignored", reason: "guard" });
  const snap = ctx.game.snapshot();
  assert.equal(snap.score, 80);
  assert.equal(snap.combo, 1);
  assert.equal(snap.slots[0], null, "the second tap did not place a new item either");

  ctx.at(3000 + Core.TAP_GUARD_MS);
  assert.equal(ctx.game.tapSlot(0).type, "placed");
  // Other slots are never blocked by another slot's guard.
  assert.equal(ctx.game.tapSlot(1).type, "placed");
});

test("invalid slot numbers and ingredients are ignored", () => {
  const ctx = setup();
  ctx.game.start();
  for (const bad of [-1, 6, 1.5, "0", null, undefined]) {
    assert.equal(ctx.game.tapSlot(bad).type, "ignored");
  }
  assert.equal(ctx.game.select("pineapple"), false);
  assert.equal(ctx.game.snapshot().selected, "shrimp");
});

test("a retry with the same seed starts clean with the same schedule", () => {
  const first = setup(4242);
  first.game.start();
  cook(first, 0, "corn", 0, 6000);
  cook(first, 1, "corn", 0, 6100);
  first.game.tapSlot(2);
  first.game.dispose();

  // The stale handle is inert.
  first.at(7000);
  assert.deepEqual(first.game.tapSlot(3), { type: "ignored", reason: "disposed" });
  assert.equal(first.game.start(), false);
  assert.equal(first.game.resume(), false);
  first.at(70000);
  first.game.sync();
  assert.deepEqual(first.game.drainEvents(), []);

  const second = setup(4242, 999999);
  assert.deepEqual(second.game.schedule, first.game.schedule);
  second.game.start();
  const snap = second.game.snapshot();
  assert.deepEqual(
    [snap.score, snap.combo, snap.maxCombo, snap.perfectCount, snap.burnedCount, snap.activeMs],
    [0, 0, 0, 0, 0, 0]
  );
  assert.ok(snap.slots.every((slot) => slot === null));
  assert.equal(second.game.tapSlot(0).type, "placed", "no tap guard leaks from the old game");
});

// ---- frame-rate independence -------------------------------------------------------

// One fixed list of player inputs, replayed while "rendering" at a given rate.
const SCRIPT = [
  { at: 200, select: "shrimp" },
  { at: 210, tap: 0 },
  { at: 400, select: "corn" },
  { at: 410, tap: 1 },
  { at: 600, select: "kalbi" },
  { at: 610, tap: 2 },
  { at: 3300, tap: 0 }, // shrimp PERFECT
  { at: 3600, select: "sausage" },
  { at: 3610, tap: 0 },
  { at: 5400, tap: 2 }, // kalbi PERFECT
  { at: 6500, tap: 1 }, // corn PERFECT
  { at: 6700, tap: 0 }, // sausage GOOD (early)
  { at: 7000, tap: 3 }, // sausage, left to burn at 12700
  { at: 7100, select: "shrimp" },
  { at: 7110, tap: 4 },
  { at: 8000, tap: 4 }, // shrimp RAW
  { at: 9000, tap: 5 }, // shrimp
  { at: 12017, tap: 5 }, // shrimp PERFECT, 683ms before the sausage burns
  { at: 12733, tap: 1 }, // shrimp placed just after the burn
  { at: 15900, tap: 1 }, // shrimp PERFECT with combo 0
  { at: 20000, pause: true },
  { at: 31234, resume: true },
  { at: 32000, select: "corn" },
  { at: 32010, tap: 0 },
  { at: 39500, tap: 0 }, // corn GOOD (early), 6256ms active
  { at: 60000, select: "kalbi" },
  { at: 60010, tap: 2 },
  { at: 65700, tap: 2 }, // kalbi GOOD late
  { at: 70000, tap: 5 }, // shrimp placed 1.2s before the end
  { at: 71300, tap: 5 }, // after the end: ignored
];

function replay(seed, frameTimes) {
  const clock = { t: 0 };
  const game = Core.createGame({ seed, now: () => clock.t });
  const outcomes = [];
  const burns = [];
  const collect = () => {
    for (const event of game.drainEvents()) {
      if (event.type === "burn") {
        burns.push(event.slot + "@" + event.atMs);
      }
    }
  };
  game.start();
  const steps = SCRIPT.map((step) => ({ at: step.at, step })).concat(frameTimes.map((at) => ({ at, step: null })));
  steps.sort((a, b) => a.at - b.at || (a.step ? 1 : -1));
  for (const { at, step } of steps) {
    clock.t = at;
    if (!step) {
      game.snapshot(); // what a rendered frame does
    } else if (step.select) {
      game.select(step.select);
    } else if (step.pause) {
      game.pause();
    } else if (step.resume) {
      game.resume();
    } else {
      const result = game.tapSlot(step.tap);
      outcomes.push([step.at, result.type, result.grade || "", result.points || 0, result.comboAfter || 0].join(":"));
    }
    collect();
  }
  clock.t = 80000;
  game.snapshot();
  collect();
  return { results: game.results(), status: game.status, outcomes, burns: burns.sort() };
}

function framesAt(fps) {
  const times = [];
  for (let k = 1; (k * 1000) / fps < 80000; k += 1) {
    times.push((k * 1000) / fps);
  }
  return times;
}

test("30, 60 and 144 FPS produce identical outcomes", () => {
  const seed = 20261008;
  const baseline = replay(seed, []); // no frames at all: inputs alone
  assert.equal(baseline.status, "ended");
  assert.ok(baseline.results.score > 0);
  assert.ok(baseline.results.perfectCount >= 4);
  assert.equal(baseline.results.burnedCount, 1);
  assert.ok(baseline.outcomes.some((line) => line.includes(":RAW:")));
  assert.ok(baseline.outcomes[baseline.outcomes.length - 1].includes("ignored"));

  for (const fps of [30, 60, 144]) {
    assert.deepEqual(replay(seed, framesAt(fps)), baseline, fps + " FPS");
  }

  // Janky rendering: long stalls and uneven frames.
  const janky = [];
  let t = 0;
  let k = 0;
  while (t < 80000) {
    k += 1;
    t += k % 37 === 0 ? 2500 : 4 + ((k * 7919) % 90);
    janky.push(t);
  }
  assert.deepEqual(replay(seed, janky), baseline, "irregular frames");
});

// ---- local record -------------------------------------------------------------------

function memoryStorage(initial) {
  const data = new Map(Object.entries(initial || {}));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const EMPTY_RECORD = { nickname: "", players: [], legacyBest: 0, audio: Object.assign({}, Core.DEFAULT_AUDIO) };

test("each name keeps one best on this device and only improves", () => {
  const storage = memoryStorage();
  const store = Core.createRecordStore(() => storage);
  assert.deepEqual(store.load(), EMPTY_RECORD);
  assert.deepEqual(store.top(), []);
  assert.deepEqual(store.recordScore("Ken", 300), { best: 300, rank: 1, isNewBest: true, persisted: true });
  assert.deepEqual(store.recordScore("Ken", 120), { best: 300, rank: 1, isNewBest: false, persisted: true });
  assert.deepEqual(store.recordScore("Ken", 300), { best: 300, rank: 1, isNewBest: false, persisted: true });
  assert.deepEqual(store.recordScore("  Ken ", 450), { best: 450, rank: 1, isNewBest: true, persisted: true });
  assert.deepEqual(store.recordScore("Aki", 500), { best: 500, rank: 1, isNewBest: true, persisted: true });
  assert.deepEqual(store.recordScore("ken", 100), { best: 100, rank: 3, isNewBest: true, persisted: true });
  assert.deepEqual(store.top(), [
    { name: "Aki", best: 500, guest: false },
    { name: "Ken", best: 450, guest: false },
    { name: "ken", best: 100, guest: false },
  ]);
  store.saveNickname("  Ken  ");

  const reopened = Core.createRecordStore(() => storage);
  assert.deepEqual(reopened.load().players, store.load().players);
  assert.equal(reopened.load().nickname, "Ken");
  assert.deepEqual(reopened.recordScore("Ken", 449), { best: 450, rank: 2, isNewBest: false, persisted: true });

  const saved = JSON.parse(storage.data.get(Core.STORAGE_KEY));
  assert.equal(saved.v, 2);
  assert.deepEqual(saved.players, [
    { name: "Aki", best: 500 },
    { name: "Ken", best: 450 },
    { name: "ken", best: 100 },
  ]);
});

test("tied scores rank in the order they were reached, across reloads", () => {
  const storage = memoryStorage();
  const store = Core.createRecordStore(() => storage);
  store.recordScore("B", 200);
  store.recordScore("A", 200);
  store.recordScore("C", 200);
  assert.deepEqual(store.top().map((player) => player.name), ["B", "A", "C"]);
  // Matching your own best changes nothing; passing a tie moves you ahead of it.
  store.recordScore("C", 200);
  assert.deepEqual(store.top().map((player) => player.name), ["B", "A", "C"]);
  store.recordScore("D", 100);
  assert.equal(store.recordScore("D", 200).rank, 4, "reaching the tie later ranks behind it");
  assert.equal(store.recordScore("C", 201).rank, 1);
  assert.deepEqual(store.top(4).map((player) => player.name), ["C", "B", "A", "D"]);
  for (let i = 0; i < 3; i += 1) {
    const again = Core.createRecordStore(() => storage);
    assert.deepEqual(again.top(4).map((player) => player.name), ["C", "B", "A", "D"]);
  }
});

test("players without a name share one guest entry, as does typing the guest name", () => {
  const store = Core.createRecordStore(() => memoryStorage());
  assert.equal(store.recordScore("", 100).rank, 1);
  assert.deepEqual(store.recordScore("   ", 90), { best: 100, rank: 1, isNewBest: false, persisted: true });
  assert.deepEqual(store.recordScore(undefined, 150), { best: 150, rank: 1, isNewBest: true, persisted: true });
  assert.equal(store.recordScore(Core.DEFAULT_NICKNAME, 180).best, 180);
  assert.deepEqual(store.top(), [{ name: Core.DEFAULT_NICKNAME, best: 180, guest: true }]);
  assert.equal(store.recordScore("ゲスト2", 50).rank, 2, "any other text is its own player");
  // Composed and decomposed spellings of the same text are the same player.
  store.recordScore("\u30ac", 60);
  assert.equal(store.recordScore("\u30ab\u3099", 70).best, 70);
  assert.equal(store.top(9).length, 3);
});

test("invalid names and scores are never recorded", () => {
  const storage = memoryStorage();
  const store = Core.createRecordStore(() => storage);
  store.recordScore("Ken", 300);
  const invalid = [0, -1, 1.5, NaN, Infinity, "500", null, undefined, Core.MAX_SCORE + 1, 2 ** 53, Number.MAX_SAFE_INTEGER];
  for (const score of invalid) {
    assert.deepEqual(store.recordScore("Ken", score), { best: 300, rank: 1, isNewBest: false, persisted: true }, String(score));
    assert.deepEqual(store.recordScore("New", score), { best: 0, rank: 0, isNewBest: false, persisted: true }, String(score));
    assert.equal(Core.isValidScore(score), false, String(score));
  }
  assert.deepEqual(store.recordScore("x".repeat(13), 900), { best: 0, rank: 0, isNewBest: false, persisted: true });
  assert.equal(store.recordScore("Max", Core.MAX_SCORE).rank, 1);
  assert.equal(store.top(9).length, 2);
  assert.ok(Core.MAX_SCORE >= Core.SLOT_COUNT * 20 * (210 * 2 + Core.POPULAR_BONUS), "the cap is above any reachable score");
});

test("the stored list is capped and a low score cannot push anyone out", () => {
  const storage = memoryStorage();
  const store = Core.createRecordStore(() => storage);
  for (let i = 0; i < Core.MAX_PLAYERS; i += 1) {
    assert.equal(store.recordScore("p" + i, 1000 - i).rank, i + 1);
  }
  assert.deepEqual(store.recordScore("late", 5), { best: 0, rank: 0, isNewBest: false, persisted: true });
  assert.equal(store.load().players.length, Core.MAX_PLAYERS);
  assert.equal(store.recordScore("late", 995).rank, 7, "behind p5, who reached 995 first");
  const players = store.load().players;
  assert.equal(players.length, Core.MAX_PLAYERS);
  assert.equal(players.some((player) => player.name === "p" + (Core.MAX_PLAYERS - 1)), false, "the lowest entry dropped off");
  assert.equal(JSON.parse(storage.data.get(Core.STORAGE_KEY)).players.length, Core.MAX_PLAYERS);
  assert.equal(Core.RANK_SHOWN, 3);
  assert.equal(store.top().length, 3);
});

test("unavailable or throwing storage falls back to memory", () => {
  const variants = {
    "getter throws": () => {
      throw new Error("SecurityError");
    },
    "storage is null": () => null,
    "storage is undefined": () => undefined,
    "methods throw": () => ({
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    }),
  };
  for (const [name, getStorage] of Object.entries(variants)) {
    const store = Core.createRecordStore(getStorage);
    assert.deepEqual(store.load(), EMPTY_RECORD, name);
    assert.deepEqual(store.recordScore("Aki", 450), { best: 450, rank: 1, isNewBest: true, persisted: false }, name);
    assert.doesNotThrow(() => store.saveNickname("Aki"), name);
    assert.equal(store.saveAudio({ bgmMuted: true }).bgmMuted, true, name);
    assert.equal(store.top()[0].best, 450, name + ": the best survives for this session");
    assert.equal(store.load().audio.bgmMuted, true, name);
  }
});

test("a full quota keeps reads working and reports the unsaved best", () => {
  const storage = memoryStorage();
  const store = Core.createRecordStore(() => storage);
  store.recordScore("Ken", 100);
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.deepEqual(store.recordScore("Ken", 200), { best: 200, rank: 1, isNewBest: true, persisted: false });
  assert.equal(Core.createRecordStore(() => storage).top()[0].best, 100, "the last successful save is what a reload sees");
});

test("corrupt stored data is ignored field by field", () => {
  const corrupt = [
    "",
    "{",
    "null",
    "[]",
    "42",
    '"text"',
    '{"players":"Ken"}',
    '{"players":{"0":{"name":"Ken","best":5}}}',
    '{"players":[null,7,"x",[],{"name":"Ken"},{"best":5},{"name":7,"best":5},{"name":"Ken","best":"900"}]}',
    '{"players":[{"name":"Ken","best":-5},{"name":"Ken","best":12.5},{"name":"Ken","best":1e99},{"name":"Ken","best":0}]}',
    '{"players":[{"name":"' + "x".repeat(13) + '","best":5}]}',
    '{"legacyBest":"900","nickname":{"a":1},"audio":"loud"}',
    '{"__proto__":{"players":[{"name":"Ken","best":777}],"legacyBest":777}}',
    '{"players":[{"__proto__":{"name":"Ken","best":777}}]}',
  ];
  for (const raw of corrupt) {
    const storage = memoryStorage({ [Core.STORAGE_KEY]: raw });
    const store = Core.createRecordStore(() => storage);
    assert.deepEqual(store.load(), EMPTY_RECORD, raw);
    assert.equal(store.recordScore("Ken", 10).isNewBest, true, raw);
  }

  const partly = memoryStorage({
    [Core.STORAGE_KEY]: JSON.stringify({
      v: 2,
      nickname: "x".repeat(200),
      legacyBest: 640,
      players: [
        { name: "Low", best: 10 },
        { name: "<b>Top</b>", best: 900 },
        { name: "Bad", best: 9999999 },
        { name: "Low", best: 400 },
        { name: " Tie ", best: 400 },
        { name: "", best: 30 },
      ],
      audio: { seMuted: 1, seVolume: 9, bgmMuted: true, bgmVolume: 2 },
    }),
  });
  assert.deepEqual(Core.createRecordStore(() => partly).load(), {
    nickname: "",
    players: [
      { name: "<b>Top</b>", best: 900, guest: false },
      { name: "Low", best: 400, guest: false },
      { name: "Tie", best: 400, guest: false },
      { name: Core.DEFAULT_NICKNAME, best: 30, guest: true },
    ],
    legacyBest: 640,
    audio: { seMuted: false, seVolume: 5, bgmMuted: true, bgmVolume: 2 },
  });
});

test("an oversized stored list is cut to the cap without scanning it all", () => {
  const players = [];
  for (let i = 0; i < 5000; i += 1) {
    players.push({ name: "n" + i, best: i + 1 });
  }
  const storage = memoryStorage({ [Core.STORAGE_KEY]: JSON.stringify({ v: 2, players }) });
  const loaded = Core.createRecordStore(() => storage).load().players;
  assert.equal(loaded.length, Core.MAX_PLAYERS);
  assert.equal(loaded[0].best, Core.MAX_PLAYERS * 10, "only a bounded prefix is considered");
});

test("a version 1 best is kept apart and never given to a name", () => {
  const legacy = JSON.stringify({ v: 1, bestScore: 1234, nickname: "Ken", muted: true });
  const storage = memoryStorage({ [Core.LEGACY_STORAGE_KEY]: legacy });
  const store = Core.createRecordStore(() => storage);
  assert.deepEqual(store.load(), {
    nickname: "Ken",
    players: [],
    legacyBest: 1234,
    audio: { seMuted: true, seVolume: 5, bgmMuted: true, bgmVolume: 3 },
  });
  assert.deepEqual(store.top(), [], "the old best is not on the ranking, under any name");
  assert.equal(storage.data.has(Core.STORAGE_KEY), false, "loading alone writes nothing");

  // Ken has to earn a v2 entry; the old 1234 neither blocks nor counts.
  assert.deepEqual(store.recordScore("Ken", 300), { best: 300, rank: 1, isNewBest: true, persisted: true });
  assert.equal(storage.data.get(Core.LEGACY_STORAGE_KEY), legacy, "the v1 record is left untouched");
  const reopened = Core.createRecordStore(() => storage).load();
  assert.equal(reopened.legacyBest, 1234);
  assert.deepEqual(reopened.players, [{ name: "Ken", best: 300, guest: false }]);

  for (const raw of ['{"bestScore":"9"}', '{"bestScore":-1}', '{"bestScore":1e99}', "[]", "{"]) {
    const broken = Core.createRecordStore(() => memoryStorage({ [Core.LEGACY_STORAGE_KEY]: raw }));
    assert.deepEqual(broken.load(), EMPTY_RECORD, raw);
  }
  const unmuted = Core.createRecordStore(() => memoryStorage({ [Core.LEGACY_STORAGE_KEY]: '{"bestScore":50,"muted":false}' }));
  assert.deepEqual(unmuted.load().audio, Core.DEFAULT_AUDIO);
});

test("sound settings are stored per channel and repaired when damaged", () => {
  const storage = memoryStorage();
  const store = Core.createRecordStore(() => storage);
  assert.deepEqual(store.load().audio, { seMuted: false, seVolume: 5, bgmMuted: false, bgmVolume: 3 });
  assert.deepEqual(store.saveAudio({ seMuted: true, seVolume: 2, bgmMuted: false, bgmVolume: 5 }), {
    seMuted: true,
    seVolume: 2,
    bgmMuted: false,
    bgmVolume: 5,
  });
  assert.deepEqual(Core.createRecordStore(() => storage).load().audio, { seMuted: true, seVolume: 2, bgmMuted: false, bgmVolume: 5 });
  for (const bad of [0, 6, -1, 2.5, "3", null, NaN]) {
    const repaired = store.saveAudio({ seVolume: bad, bgmVolume: bad, seMuted: "yes", bgmMuted: 1 });
    assert.deepEqual(repaired, Core.DEFAULT_AUDIO, String(bad));
  }
  assert.deepEqual(store.saveAudio(null), Core.DEFAULT_AUDIO);
  assert.equal(Object.isFrozen(Core.DEFAULT_AUDIO), true);
});

// ---- background music ------------------------------------------------------------------

test("the BGM is a bounded original loop of plain notes", () => {
  assert.equal(Core.BGM.melody.length, 64);
  assert.equal(Core.BGM.bass.length, Core.BGM.melody.length);
  for (const midi of Core.BGM.melody.concat(Core.BGM.bass)) {
    assert.ok(midi === 0 || (Number.isInteger(midi) && midi >= 36 && midi <= 96), String(midi));
  }
  assert.ok(Core.BGM.melody.filter(Boolean).length > 24);
  assert.equal(Core.midiToHz(69), 440);
  assert.ok(Math.abs(Core.midiToHz(60) - 261.6256) < 0.001);
  assert.ok(Core.BGM.lookaheadSec > Core.BGM.stepSec, "polling once per step still schedules ahead");
});

// Polls the sequencer every stepMs from fromSec to toSec and returns the notes.
function pollBgm(seq, fromSec, toSec, stepMs) {
  const notes = [];
  for (let ms = Math.round(fromSec * 1000); ms <= toSec * 1000; ms += stepMs) {
    notes.push(...seq.due(ms / 1000));
  }
  return notes;
}

test("the sequencer hands out every note exactly once at any polling rate", () => {
  const loopSec = Core.BGM.stepSec * Core.BGM.melody.length;
  const key = (note) => note.voice + ":" + note.step + "@" + note.atSec.toFixed(4);
  const play = (stepMs) => {
    const seq = Core.createBgmSequencer();
    assert.deepEqual(seq.due(1), [], "nothing is due before start");
    assert.equal(seq.start(10), true);
    return pollBgm(seq, 10, 10 + loopSec * 2, stepMs).filter((note) => note.atSec < 10 + loopSec * 2);
  };
  const baseline = play(16);
  assert.equal(new Set(baseline.map(key)).size, baseline.length, "no note is scheduled twice");
  assert.ok(baseline.every((note) => note.atSec >= 10 && note.hz === Core.midiToHz(note.midi)));
  for (const voice of ["melody", "bass"]) {
    const steps = baseline.filter((note) => note.voice === voice).map((note) => note.step);
    const expected = [];
    Core.BGM[voice].forEach((midi, step) => midi && expected.push(step));
    assert.deepEqual(steps, expected.concat(expected), voice + " plays the loop in order, then loops");
  }
  for (const stepMs of [7, 33, 100, 250]) {
    assert.deepEqual(play(stepMs).map(key), baseline.map(key), stepMs + "ms polling");
  }
});

test("starting twice never doubles the loop; stop, resume and reset behave", () => {
  const seq = Core.createBgmSequencer();
  assert.deepEqual(seq.due(5), []);
  assert.equal(seq.start(0), true);
  assert.equal(seq.start(0), false, "a second start is ignored");
  assert.equal(seq.start(3), false);
  const first = pollBgm(seq, 0, 2, 16);
  assert.equal(new Set(first.map((note) => note.voice + note.atSec)).size, first.length);
  const stoppedAt = seq.step;
  assert.ok(stoppedAt > 0);

  seq.stop();
  assert.equal(seq.playing, false);
  assert.deepEqual(pollBgm(seq, 2, 60, 16), [], "nothing is due while stopped");
  assert.equal(seq.step, stoppedAt);

  // A resume carries on from the same step, timed from the new clock value.
  assert.equal(seq.start(100), true);
  const resumed = seq.due(100);
  assert.equal(resumed[0].step >= stoppedAt, true);
  assert.ok(resumed.every((note) => note.atSec >= 100 && note.atSec < 100 + Core.BGM.leadSec + Core.BGM.lookaheadSec));

  seq.stop();
  seq.reset();
  assert.equal(seq.step, 0);
  seq.start(200);
  assert.equal(seq.due(200)[0].step, 0, "a new round starts the tune from the top");
});

test("after a stall the tune carries on instead of bursting to catch up", () => {
  const seq = Core.createBgmSequencer();
  seq.start(0);
  seq.due(0);
  const late = seq.due(500);
  const perPoll = Math.ceil(Core.BGM.lookaheadSec / Core.BGM.stepSec) * 2;
  assert.ok(late.length <= perPoll, "one lookahead of notes at most");
  assert.ok(late.every((note) => note.atSec >= 500));
  for (const bad of [NaN, -1, undefined]) {
    assert.deepEqual(seq.due(bad), []);
  }
});

// ---- challenge link -------------------------------------------------------------------

test("valid version 2 fragments parse and round-trip", () => {
  assert.deepEqual(Core.parseChallengeHash("#v=2&seed=0"), { ok: true, version: 2, seed: 0 });
  assert.deepEqual(Core.parseChallengeHash("#v=2&seed=4294967295"), { ok: true, version: 2, seed: 4294967295 });
  for (const seed of [0, 1, 99, 20261008, Core.MAX_SEED]) {
    assert.equal(Core.buildChallengeHash(seed), "#v=2&seed=" + seed);
    assert.deepEqual(Core.parseChallengeHash(Core.buildChallengeHash(seed)), { ok: true, version: 2, seed });
  }
});

test("a version 1 link is reported as legacy and its seed is never reused", () => {
  assert.equal(Core.LEGACY_CHALLENGE_VERSION, 1);
  for (const hash of ["#v=1&seed=0", "#v=1&seed=20261008", "#v=1&seed=4294967295", "#v=1&seed=4294967296", "#v=1&seed=9999999999"]) {
    const parsed = Core.parseChallengeHash(hash);
    assert.deepEqual(parsed, { ok: false, reason: "legacy", version: 1 }, hash);
    assert.equal("seed" in parsed, false, "no seed is handed on to be replayed under v2 rules");
  }
  // A v1 link with anything extra is simply malformed, not legacy.
  assert.equal(Core.parseChallengeHash("#v=1&seed=5&name=Ken").reason, "format");
});

test("malformed, out-of-range or extended fragments are rejected", () => {
  assert.equal(Core.parseChallengeHash("").reason, "empty");
  assert.equal(Core.parseChallengeHash("#").reason, "empty");
  assert.equal(Core.parseChallengeHash(undefined).reason, "empty");
  assert.equal(Core.parseChallengeHash("#v=3&seed=5").reason, "version");
  assert.equal(Core.parseChallengeHash("#v=0&seed=5").reason, "version");
  assert.equal(Core.parseChallengeHash("#v=999&seed=5").reason, "version");
  assert.equal(Core.parseChallengeHash("#v=2&seed=4294967296").reason, "seed");
  assert.equal(Core.parseChallengeHash("#v=2&seed=9999999999").reason, "seed");
  const malformed = [
    "v=2&seed=5",
    "#seed=5&v=2",
    "#v=2",
    "#seed=5",
    "#v=2&seed=",
    "#v=2&seed=-5",
    "#v=2&seed=5.5",
    "#v=2&seed=1e3",
    "#v=2&seed=0x10",
    "#v=2&seed=05",
    "#v=02&seed=5",
    "#v=2&seed=12345678901",
    "#v=2&seed=5&name=Ken",
    "#v=2&seed=5&seed=6",
    "#v=2&seed=5 ",
    " #v=2&seed=5",
    "#v=2&seed=5\n",
    "#v=2&seed=５",
    "#V=2&SEED=5",
    "#v=2&seed=5#v=2&seed=6",
    "#v=2&seed=<script>",
    "#v=2%26seed=5",
    "#v=1&seed=05",
    "#v=1&seed=<script>",
  ];
  for (const hash of malformed) {
    assert.deepEqual(Core.parseChallengeHash(hash), { ok: false, reason: "format" }, JSON.stringify(hash));
  }
});

test("the challenge URL carries only version and seed", () => {
  const url = Core.buildChallengeUrl("https://example.test/BBQ-Game/index.html?name=Ken&x=1#v=1&seed=3&name=Ken", 77);
  assert.equal(url, "https://example.test/BBQ-Game/index.html#v=2&seed=77");
  assert.equal(Core.buildChallengeUrl("file:///C:/games/index.html", 5), "file:///C:/games/index.html#v=2&seed=5");
  assert.throws(() => Core.buildChallengeUrl("https://example.test/", -1), RangeError);
  assert.throws(() => Core.buildChallengeHash(1.5), RangeError);
});

test("random seeds are always in range, even with a broken generator", () => {
  assert.equal(Core.randomSeed(() => 12345), 12345);
  const fallbacks = [() => -1, () => 2 ** 40, () => NaN, () => "9", () => { throw new Error("no crypto"); }, undefined];
  for (const generator of fallbacks) {
    assert.ok(Core.isValidSeed(Core.randomSeed(generator)));
  }
});

// ---- nickname ------------------------------------------------------------------------

test("nickname is optional and limited to 12 characters", () => {
  assert.deepEqual(Core.normalizeNickname(""), { ok: true, value: "ゲスト", isGuest: true });
  assert.deepEqual(Core.normalizeNickname("   "), { ok: true, value: "ゲスト", isGuest: true });
  assert.deepEqual(Core.normalizeNickname(undefined), { ok: true, value: "ゲスト", isGuest: true });
  assert.deepEqual(Core.normalizeNickname(42), { ok: true, value: "ゲスト", isGuest: true });
  assert.deepEqual(Core.normalizeNickname("  Ken   Mori "), { ok: true, value: "Ken Mori", isGuest: false });
  assert.equal(Core.normalizeNickname("a".repeat(12)).ok, true);
  assert.equal(Core.normalizeNickname("a".repeat(13)).ok, false);
  assert.equal(Core.normalizeNickname("a".repeat(13)).error, "too-long");
  assert.equal(Core.normalizeNickname("や".repeat(12)).ok, true);
  assert.equal(Core.normalizeNickname("𠮷".repeat(12)).ok, true, "length counts characters, not UTF-16 units");
  assert.equal(Core.normalizeNickname("𠮷".repeat(13)).ok, false);
});

test("nickname keeps markup as literal text and drops invisible characters", () => {
  assert.equal(Core.normalizeNickname("<b>x</b>").value, "<b>x</b>");
  assert.equal(Core.normalizeNickname("a\u0000b\u202Ec\u200Bd\n").value, "abcd");
  assert.equal(Core.normalizeNickname("\u200B\u200B").isGuest, true);
});

// ---- share ---------------------------------------------------------------------------

const SHARE = { title: "BBQ Party", text: "score", url: "https://example.test/#v=1&seed=9" };

test("share prefers Web Share, then clipboard, then visible text", async () => {
  const calls = [];
  const full = {
    share: async (payload) => calls.push(["share", payload]),
    clipboard: { writeText: async (text) => calls.push(["clipboard", text]) },
  };
  assert.deepEqual(await Core.shareChallenge(Object.assign({ nav: full }, SHARE)), { method: "share" });
  assert.deepEqual(calls, [["share", SHARE]]);

  calls.length = 0;
  const clipboardOnly = { clipboard: full.clipboard };
  assert.deepEqual(await Core.shareChallenge(Object.assign({ nav: clipboardOnly }, SHARE)), { method: "clipboard" });
  assert.deepEqual(calls, [["clipboard", "score\n" + SHARE.url]]);

  for (const nav of [undefined, null, {}, { clipboard: {} }]) {
    assert.deepEqual(await Core.shareChallenge(Object.assign({ nav }, SHARE)), { method: "fallback", url: SHARE.url });
  }
});

test("share failures fall through, but a cancelled share sheet does not", async () => {
  const reject = (name) => async () => {
    const error = new Error(name);
    error.name = name;
    throw error;
  };
  const writes = [];
  const clipboard = { writeText: async (text) => writes.push(text) };

  const broken = { share: reject("NotAllowedError"), clipboard };
  assert.deepEqual(await Core.shareChallenge(Object.assign({ nav: broken }, SHARE)), { method: "clipboard" });
  assert.equal(writes.length, 1);

  const cancelled = { share: reject("AbortError"), clipboard };
  assert.deepEqual(await Core.shareChallenge(Object.assign({ nav: cancelled }, SHARE)), { method: "cancelled" });
  assert.equal(writes.length, 1, "nothing is copied behind the player's back");

  const allBroken = { share: reject("TypeError"), clipboard: { writeText: reject("NotAllowedError") } };
  assert.deepEqual(await Core.shareChallenge(Object.assign({ nav: allBroken }, SHARE)), {
    method: "fallback",
    url: SHARE.url,
  });
});

// ---- particles -------------------------------------------------------------------------

test("the particle pool never exceeds its bound and expires particles", () => {
  const pool = Core.createParticlePool(8);
  for (let i = 0; i < 500; i += 1) {
    pool.add({ life: 100 + i, tag: i });
    assert.ok(pool.items.length <= 8);
  }
  assert.deepEqual(pool.items.map((p) => p.tag), [492, 493, 494, 495, 496, 497, 498, 499]);
  let stepped = 0;
  pool.update(595, () => {
    stepped += 1;
  });
  assert.deepEqual(pool.items.map((p) => p.tag), [496, 497, 498, 499]);
  assert.equal(stepped, 4);
  pool.clear();
  assert.equal(pool.items.length, 0);
});
