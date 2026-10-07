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
  shrimp: { ideal: 3000, base: 80, goodStart: 2400, perfectEnd: 3800, burn: 4500 },
  sausage: { ideal: 3800, base: 100, goodStart: 3040, perfectEnd: 4600, burn: 5700 },
  kalbi: { ideal: 4700, base: 125, goodStart: 3760, perfectEnd: 5500, burn: 7050 },
  corn: { ideal: 6000, base: 160, goodStart: 4800, perfectEnd: 6800, burn: 9000 },
};

test("ingredients match the design table", () => {
  assert.deepEqual(Core.INGREDIENT_IDS, ["shrimp", "sausage", "kalbi", "corn"]);
  for (const [id, spec] of Object.entries(SPEC)) {
    const item = Core.ingredientById(id);
    assert.equal(item.idealMs, spec.ideal);
    assert.equal(item.base, spec.base);
  }
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
      [spec.perfectEnd, "PERFECT"], // T + 0.8s inclusive
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
});

test("non-numeric ages are treated as RAW, never as a score", () => {
  assert.equal(Core.judge("corn", NaN), "RAW");
  assert.equal(Core.judge("corn", -5), "RAW");
});

// ---- scoring -----------------------------------------------------------------

test("GOOD is 60% of base and PERFECT is 100% of base", () => {
  for (const [id, spec] of Object.entries(SPEC)) {
    assert.equal(Core.scoreCollection(id, "PERFECT", 0, false).points, spec.base);
    assert.equal(Core.scoreCollection(id, "GOOD", 0, false).points, spec.base * 0.6);
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
  for (let seed = 0; seed < 200; seed += 1) {
    distinct.add(Core.buildSchedule(seed).join(","));
  }
  assert.ok(distinct.size > 50, "different seeds should give varied schedules");
  for (const id of Core.INGREDIENT_IDS) {
    assert.ok([...distinct].some((key) => key.startsWith(id)), id + " can open a challenge");
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

test("best score round-trips through storage and only improves", () => {
  const storage = memoryStorage();
  const store = Core.createRecordStore(() => storage);
  assert.deepEqual(store.load(), { bestScore: 0, nickname: "", muted: false });
  assert.deepEqual(store.saveBest(300), { bestScore: 300, isNewBest: true });
  assert.deepEqual(store.saveBest(120), { bestScore: 300, isNewBest: false });
  assert.deepEqual(store.saveBest(300), { bestScore: 300, isNewBest: false });
  store.saveNickname("  Ken  ");
  store.saveMuted(true);

  const reopened = Core.createRecordStore(() => storage);
  assert.deepEqual(reopened.load(), { bestScore: 300, nickname: "Ken", muted: true });
  assert.deepEqual(store.saveBest(0), { bestScore: 300, isNewBest: false });
  assert.deepEqual(store.saveBest(NaN), { bestScore: 300, isNewBest: false });
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
    assert.deepEqual(store.load(), { bestScore: 0, nickname: "", muted: false }, name);
    assert.deepEqual(store.saveBest(450), { bestScore: 450, isNewBest: true }, name);
    assert.doesNotThrow(() => store.saveNickname("Aki"), name);
    assert.doesNotThrow(() => store.saveMuted(true), name);
    assert.equal(store.load().bestScore, 450, name + ": best survives for this session");
  }
});

test("corrupt stored data is ignored field by field", () => {
  const corrupt = [
    "",
    "{",
    "null",
    "[]",
    "42",
    '"text"',
    '{"bestScore":"900"}',
    '{"bestScore":-5}',
    '{"bestScore":12.5}',
    '{"bestScore":1e99}',
    '{"bestScore":null,"nickname":{"a":1},"muted":"yes"}',
    '{"__proto__":{"bestScore":777}}',
  ];
  for (const raw of corrupt) {
    const storage = memoryStorage({ [Core.STORAGE_KEY]: raw });
    const store = Core.createRecordStore(() => storage);
    assert.deepEqual(store.load(), { bestScore: 0, nickname: "", muted: false }, raw);
    assert.equal(store.saveBest(10).isNewBest, true, raw);
  }

  const partly = memoryStorage({
    [Core.STORAGE_KEY]: JSON.stringify({ bestScore: 640, nickname: "x".repeat(200), muted: 1 }),
  });
  assert.deepEqual(Core.createRecordStore(() => partly).load(), { bestScore: 640, nickname: "", muted: false });
});

// ---- challenge link -------------------------------------------------------------------

test("valid challenge fragments parse and round-trip", () => {
  assert.deepEqual(Core.parseChallengeHash("#v=1&seed=0"), { ok: true, version: 1, seed: 0 });
  assert.deepEqual(Core.parseChallengeHash("#v=1&seed=4294967295"), { ok: true, version: 1, seed: 4294967295 });
  for (const seed of [0, 1, 99, 20261008, Core.MAX_SEED]) {
    assert.deepEqual(Core.parseChallengeHash(Core.buildChallengeHash(seed)), { ok: true, version: 1, seed });
  }
});

test("malformed, out-of-range or extended fragments are rejected", () => {
  assert.equal(Core.parseChallengeHash("").reason, "empty");
  assert.equal(Core.parseChallengeHash("#").reason, "empty");
  assert.equal(Core.parseChallengeHash(undefined).reason, "empty");
  assert.equal(Core.parseChallengeHash("#v=2&seed=5").reason, "version");
  assert.equal(Core.parseChallengeHash("#v=0&seed=5").reason, "version");
  assert.equal(Core.parseChallengeHash("#v=1&seed=4294967296").reason, "seed");
  assert.equal(Core.parseChallengeHash("#v=1&seed=9999999999").reason, "seed");
  const malformed = [
    "v=1&seed=5",
    "#seed=5&v=1",
    "#v=1",
    "#seed=5",
    "#v=1&seed=",
    "#v=1&seed=-5",
    "#v=1&seed=5.5",
    "#v=1&seed=1e3",
    "#v=1&seed=0x10",
    "#v=1&seed=05",
    "#v=01&seed=5",
    "#v=1&seed=12345678901",
    "#v=1&seed=5&name=Ken",
    "#v=1&seed=5&seed=6",
    "#v=1&seed=5 ",
    " #v=1&seed=5",
    "#v=1&seed=5\n",
    "#v=1&seed=５",
    "#V=1&SEED=5",
    "#v=1&seed=5#v=1&seed=6",
    "#v=1&seed=<script>",
    "#v=1%26seed=5",
  ];
  for (const hash of malformed) {
    assert.deepEqual(Core.parseChallengeHash(hash), { ok: false, reason: "format" }, JSON.stringify(hash));
  }
});

test("the challenge URL carries only version and seed", () => {
  const url = Core.buildChallengeUrl("https://example.test/BBQ-Game/index.html?name=Ken&x=1#v=1&seed=3&name=Ken", 77);
  assert.equal(url, "https://example.test/BBQ-Game/index.html#v=1&seed=77");
  assert.equal(Core.buildChallengeUrl("file:///C:/games/index.html", 5), "file:///C:/games/index.html#v=1&seed=5");
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
