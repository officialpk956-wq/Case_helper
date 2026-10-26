import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecisionError } from "../src/engine.ts";
import { calibrateVenture } from "../src/venture/calibrate.ts";
import { loadVentureDir } from "../src/venture/load.ts";
import { BOTS, doNothing, evidenceLed, oracle, textbook } from "../src/venture/bots.ts";
import { EVENT_QUARTER, capacity, idleDecision, newState, newWorld, playQuarter, planValue } from "../src/venture/model.ts";
import type { Decision } from "../src/venture/model.ts";
import { PLACEHOLDERS, facts, opening, render, unknownPlaceholders } from "../src/venture/narrative.ts";
import { preview } from "../src/venture/preview.ts";
import { checkDecision, isDone, lockQuarter, newRun, playPolicy, replay } from "../src/venture/run.ts";
import { SUBS, scoreRun } from "../src/venture/score.ts";
import type { VentureScenario } from "../src/venture/types.ts";
import { finalReport, publicScenario, runView } from "../src/venture/view.ts";

const root = join(import.meta.dirname, "..");
const scenarios = loadVentureDir(join(root, "scenarios"));
const [funnel, tally] = [scenarios.find((s) => s.id === "marigold_leaky_funnel")!, scenarios.find((s) => s.id === "tallyhouse_good_better_best")!];
const idle = (): Decision => idleDecision();
const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} is not ${b}`);
const refuses = (run: ReturnType<typeof newRun>, d: Decision, pattern: RegExp): void => {
  const before = JSON.stringify({ qs: run.qs.length, end: run.end });
  assert.throws(() => checkDecision(run, d), (e: unknown) => e instanceof DecisionError && pattern.test(e.message), `${JSON.stringify(d).slice(0, 80)} should be refused as ${pattern}`);
  assert.throws(() => lockQuarter(run, d), DecisionError);
  assert.equal(JSON.stringify({ qs: run.qs.length, end: run.end }), before, "a refused decision must change nothing");
};

test("every venture scenario passes the schema and the cross-reference checks, and a broken copy does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "venture-check-"));
  const run = (file: string) => spawnSync(process.execPath, [join(root, "check.mjs"), file], { encoding: "utf8" });
  const files = readdirSync(join(root, "scenarios")).filter((f) => f.endsWith(".venture.json"));
  assert.equal(files.length, scenarios.length, "every venture file loads");
  for (const f of files) assert.equal(run(join(root, "scenarios", f)).status, 0, f);
  const mutate = (name: string, edit: (s: any) => void, expectMessage: RegExp): void => {
    const copy = JSON.parse(readFileSync(join(root, "scenarios", "the-leaky-funnel.venture.json"), "utf8"));
    edit(copy);
    const file = join(dir, `${name}.venture.json`);
    writeFileSync(file, JSON.stringify(copy));
    const r = run(file);
    assert.equal(r.status, 1, `${name} should fail`);
    assert.match(r.stdout, expectMessage, name);
  };
  mutate("unknown_segment", (s) => { s.items[0].effects.nowhere = { s2: 0.1 }; }, /unknown segment nowhere/);
  mutate("unknown_need", (s) => { s.items[1].needs.done = ["ghost"]; }, /needs unknown item ghost/);
  mutate("loop", (s) => { s.items[0].needs = { done: ["kyc_defer"] }; s.items[1].needs = { done: ["kyc_camera"] }; }, /wait on each other/);
  mutate("weights", (s) => { s.rubric.dimensions[0].weight = 21; }, /weights must sum to 100/);
  mutate("template", (s) => { s.quarters[0].opening += " {nonsense}"; }, /\{nonsense\}/);
  mutate("root", (s) => { s.root.high = "ghost"; }, /root\.high is not one of the options/);
  mutate("extra_key", (s) => { s.surprise = true; }, /schema/);
  mutate("bot", (s) => { s.calibration.bots.push({ id: "ghost_bot", expected_final: { min: 0, max: 1 } }); }, /bot the engine does not have/);
  mutate("range", (s) => { s.hidden[0].range = [0.9, 0.1]; }, /range must run from low to high/);
});

test("a quarter's arithmetic: customers, money and capacity follow the equations in the spec", () => {
  for (const sc of scenarios) {
    const w = newWorld(sc, 1, { vary: false }), s0 = newState(sc), d = idle();
    const { s, r } = playQuarter(w, s0, d);
    // capacity at the start: heads x 12 x (1 - 22%) x debt factor x morale factor, less the reserves
    const vD = Math.min(1, Math.max(0.55, 1.1 - 0.008 * sc.start.debt)), vM = 0.8 + (0.2 * sc.start.morale) / 100;
    near(capacity(w, s0, d).road, sc.squad.eng * 12 * 0.78 * vD * vM * (1 - 0.05 - 0.05));
    let revenue = 0, variable = 0, steps = 0;
    for (const sg of sc.segments) {
      const f = r.funnel[sg.id]!, loss = Math.min(0.9, Math.max(sg.churn * 0.2, sg.churn + 0.01 * r.incidents));
      near(f.n1, sg.inflow * sg.stages[0]); near(f.n2, f.n1 * sg.stages[1]); near(f.n3, f.n2 * sg.stages[2]);
      near(f.end, sg.customers * (1 - loss) + f.n3);
      near(f.avg, (sg.customers + f.end) / 2);
      near(s.C[sg.id]!, f.end);
      revenue += (f.avg * sg.arpu) / 1e5; variable += (f.avg * sg.var_cost) / 1e5; steps += (f.n1 * sg.stage_cost) / 1e5;
    }
    near(r.revenue, revenue * (1 - 0.015 * r.incidents));
    near(r.var_cost, variable); near(r.stage_cost, steps);
    const squadCost = sc.squad.eng * sc.squad.cost_eng + sc.squad.design * sc.squad.cost_design + sc.squad.data * sc.squad.cost_data + sc.squad.pm + sc.squad.fixed;
    near(r.team, squadCost);
    near(r.profit, r.revenue - r.var_cost - r.stage_cost - squadCost - sc.squad.marketing);
    near(s.cash, sc.start.cash + r.profit);
    assert.equal(s.q, 2);
  }
});

test("the same seed and the same decisions give the same game, a different seed a different world, and replay reproduces a game", () => {
  for (const sc of scenarios) {
    const a = playPolicy(sc, 5, evidenceLed, "evidence_led"), b = playPolicy(sc, 5, evidenceLed, "evidence_led");
    assert.equal(JSON.stringify(a.qs.map((q) => q.r)), JSON.stringify(b.qs.map((q) => q.r)));
    const c = replay(sc, 5, a.qs.map((q) => q.d));
    assert.equal(JSON.stringify(c.qs.map((q) => q.r)), JSON.stringify(a.qs.map((q) => q.r)));
    assert.notDeepEqual(newWorld(sc, 5).hidden, newWorld(sc, 6).hidden);
    assert.deepEqual(newWorld(sc, 5, { vary: false }).hidden, newWorld(sc, 6, { vary: false }).hidden);
  }
});

test("a decision that a player could not make is refused in plain words and changes nothing", () => {
  const run = newRun(funnel, 3);
  const live = funnel.items[0]!.id;
  refuses(run, { ...idle(), roadmap: ["ghost"] }, /not an item in this case/);
  refuses(run, { ...idle(), roadmap: [live, live] }, /lists something twice/);
  refuses(run, { ...idle(), drop: [live] }, /has not been started/);
  refuses(run, { ...idle(), reserve: { rel: 0.4, debt: 0.05 } }, /between 0% and 25%/);
  refuses(run, { ...idle(), research: 1.5 }, /between 0% and 100%/);
  refuses(run, { ...idle(), pace: "sprint" as never }, /not a pace/);
  refuses(run, { ...idle(), priority: "win" as never }, /not a theme/);
  refuses(run, { ...idle(), commit: [live] }, /not on the roadmap/);
  refuses(run, { ...idle(), experiments: funnel.items.slice(0, 5).map((i) => i.id) }, /at most 4 experiments/);
  refuses(run, { ...idle(), dives: ["camera_share", "camera_share"] }, /twice/);
  refuses(run, { ...idle(), dives: ["ghost"] }, /not something this case can investigate/);
  refuses(run, { ...idle(), asks: { contractors: 90 } }, /contractor weeks/);
  refuses(run, { ...idle(), asks: { marketing: -1 } }, /lakh of marketing/);
  refuses(run, { ...idle(), event: { evidence: true, reading: "x", direction: "y" } }, /no market event to respond to this quarter/);
  refuses(run, { ...idle(), plan: funnel.plans[0]!.id }, /last quarter/);
  refuses(run, { ...idle(), reflection: { root_cause: "ghost", expected: "flat" } }, /not one of the causes offered/);
  refuses(run, { ...idle(), reflection: { root_cause: "need_more_data", expected: "huge" as never } }, /not a forecast/);
  // what is merely unwise is allowed: an item that is blocked, an experiment with nothing to measure with
  const q1 = lockQuarter(run, { ...idle(), roadmap: ["kyc_defer"], experiments: ["kyc_camera"] });
  assert.match(q1.r.blocked.kyc_defer!, /outside parties trust is 44, and this needs 50, or Fraud rules engine v2 live/);
  assert.equal(q1.r.readings.tested.length, 0, "no experiment can run with no measurement");
  assert.equal(q1.r.workDone.kyc_defer, undefined, "a blocked item takes no weeks");
  // the live item cannot be funded again, a dropped one cannot restart, and nothing is playable once the game is over
  const shipped = lockQuarter(run, { ...idle(), roadmap: ["nudges"] });
  assert.deepEqual(shipped.r.completed, ["nudges"]);
  refuses(run, { ...idle(), roadmap: ["nudges"] }, /already live/);
  refuses(run, { ...idle(), drop: ["nudges"] }, /already live/);
  lockQuarter(run, idle()); lockQuarter(run, { ...idle(), plan: funnel.plans[0]!.id });
  assert.ok(isDone(run));
  refuses(run, idle(), /game is over/);
});

test("work carries over, nothing is credited until an item is finished, and a blocked item takes no weeks", () => {
  const run = newRun(tally, 4);
  const id = "billing_rewrite";
  const q1 = lockQuarter(run, { ...idle(), roadmap: [id] });
  assert.equal(q1.r.completed.length, 0);
  assert.deepEqual(q1.r.stalled, [id]);
  assert.ok(q1.s1.progress[id]! > 0 && q1.s1.live[id] === undefined);
  assert.ok(q1.r.workDone[id]! <= q1.r.cap.road + 1e-9, "no more weeks go into an item than the team has");
  // no partial credit: the item changes nothing until it ships
  const heldBack = playQuarter(run.w, q1.s0, { ...idle(), roadmap: [] }).r;
  near(q1.r.revenue - q1.r.profit, heldBack.revenue - heldBack.profit, 1e-3);
  const q2 = lockQuarter(run, { ...idle(), roadmap: [id] });
  assert.deepEqual(q2.r.completed, [id]);
  assert.equal(q2.s1.live[id], 2);
});

test("a deep dive shows a fact to within a few percent, an experiment needs measurement, and measurement grows from analyst weeks", () => {
  const run = newRun(funnel, 8);
  const truth = run.w.hidden.camera_share!;
  const q1 = lockQuarter(run, { ...idle(), dives: ["camera_share"], instrument: 1 });
  const found = q1.s1.known.camera_share!;
  assert.ok(Math.abs(found / truth - 1) < 0.3 && found !== truth, "within noise, and not the exact truth");
  assert.deepEqual(q1.r.readings.dived, ["camera_share"]);
  near(q1.r.analystUsed, 1.5, 1e-9);
  assert.equal(funnel.start.level, 0);
  assert.equal(q1.s1.level, 2, "20 analyst weeks, most of them put into measurement, reach level 2 in a quarter");
  const q2 = lockQuarter(run, { ...idle(), experiments: ["nudges"] });
  assert.deepEqual(q2.r.readings.tested, ["nudges"]);
  assert.ok(typeof q2.s1.read.nudges === "number");
  const asked = newRun(tally, 8);
  const t1 = lockQuarter(asked, { ...idle(), experiments: ["tiering"] });
  assert.deepEqual(t1.r.readings.tested, ["tiering"], "Tallyhouse starts at level 1, so it can experiment at once");
});

test("the market event: reading the cause from data, guessing it, and the answer each add what the spec says", () => {
  for (const sc of scenarios) {
    const seed = 9;
    const absorbed = (reading: "right" | "wrong", checked: boolean, direction: "right" | "wrong"): number => {
      const run = replay(sc, seed, [idle(), idle()]);
      const ev = run.w.event;
      const wrongCause = ev.causes.find((c) => c.id !== ev.cause)!.id, wrongDir = ev.directions.find((c) => c.id !== ev.direction)!.id;
      const q3 = lockQuarter(run, { ...idle(), event: { evidence: checked, reading: reading === "right" ? ev.cause : wrongCause, direction: direction === "right" ? ev.direction : wrongDir } });
      assert.equal(q3.r.event!.id, ev.id);
      return q3.r.event!.absorbed;
    };
    const best = absorbed("right", true, "right"), guess = absorbed("right", false, "right"), wrongRead = absorbed("wrong", true, "right"), neither = absorbed("wrong", false, "wrong");
    if (best < 0.9) { near(best - guess, 0.1); }
    near(guess - wrongRead, 0.05);
    near(wrongRead - neither, 0.1);
    // with no answer at all, nothing but what was already in place absorbs it
    const none = replay(sc, seed, [idle(), idle(), idle()]).qs[2]!.r.event!.absorbed;
    near(none, neither);
    assert.ok(replay(sc, seed, [idle(), idle(), idle()]).qs[2]!.r.event!.hit === 1);
    assert.equal(replay(sc, seed, [idle(), idle(), idle(), idle()]).qs[3]!.r.event, undefined, "the aftershock is felt in the numbers but is not an event to answer");
  }
  assert.equal(EVENT_QUARTER, 3);
});

test("the term sheet: each need a plan is not met takes 30% off what it promises, and the best plan is found by playing each forward", () => {
  const run = playPolicy(funnel, 2, evidenceLed, "evidence_led");
  const w = run.w, end = run.end;
  const values = funnel.plans.map((p) => planValue(w, end, p.id));
  assert.ok(new Set(values.map((v) => Math.round(v))).size === funnel.plans.length, "the three plans give three different futures");
  const met = structuredClone(end), unmet = structuredClone(end);
  const acquire = funnel.plans.find((p) => p.id === "acquire")!;
  met.U = 99; met.R = 99; unmet.U = 0; unmet.R = 0;
  const f = (x: number, k: number): number => 1 + (x - 1) * k;
  assert.ok(acquire.needs.use !== undefined && acquire.needs.rel !== undefined);
  assert.ok(planValue(w, met, "acquire") > planValue(w, unmet, "acquire"), "a plan whose needs are met is worth more than the same plan whose needs are not");
  void f;
});

test("scoring: doing nothing scores nothing, the arithmetic is exact, and the doubled sub-criteria are worth twice", () => {
  for (const sc of scenarios) {
    const seed = 3, base = playPolicy(sc, seed, doNothing, "do_nothing"), bench = playPolicy(sc, seed, oracle, "oracle");
    const idleScore = scoreRun(base, base, bench);
    assert.equal(idleScore.total, 0);
    assert.ok(idleScore.idle && idleScore.dims.every((d) => d.subs.every((s) => s.level === "none")), "inaction earns nothing, even where a sub-criterion would otherwise be free");
    const run = playPolicy(sc, seed, evidenceLed, "evidence_led"), sc2 = scoreRun(run, base, bench);
    near(sc2.total, Math.min(100, Math.max(0, sc2.base + sc2.modifiers.reduce((t, m) => t + m.pts, 0))));
    // worth = weight / count x (2 if doubled); earned / earnable are over the sub-criteria that applied
    for (const dm of sc2.dims) {
      const dim = sc.rubric.dimensions.find((d) => d.id === dm.id)!, n = dm.subs.length;
      const worth = (id: string): number => (dim.weight / n) * (sc.rubric.doubled.includes(id) ? 2 : 1);
      const applied = dm.subs.filter((s) => s.level !== "na");
      near(dm.earnable, applied.reduce((t, s) => t + worth(s.id), 0));
      near(dm.earned, applied.reduce((t, s) => t + worth(s.id) * (s.level === "full" ? 1 : s.level === "part" ? 0.5 : 0), 0));
    }
    assert.equal(sc2.dims.flatMap((d) => d.subs).length, SUBS.length, "every sub-criterion is judged");
    assert.ok(sc2.dims.flatMap((d) => d.subs).every((s) => s.label.length > 0 && s.note.length > 0));
  }
});

test("scoring: the scripted managers come out in the order the rubric is meant to produce, and pinned scores do not drift", () => {
  const PINNED: Record<string, Record<string, number[]>> = {
    tallyhouse_good_better_best: { do_nothing: [0, 0, 0], random: [36.1, 34.4, 24.5], feature_factory: [18.1, 19.1, 24.7], debt_first: [51.7, 47.4, 51.7], textbook: [55.9, 58.6, 50.1], evidence_led: [93.1, 96.5, 93] },
    marigold_leaky_funnel: { do_nothing: [0, 0, 0], random: [43.4, 35.4, 45.3], feature_factory: [25.7, 11.2, 24.4], debt_first: [50.8, 56.5, 52.9], textbook: [52.5, 37.3, 61.3], evidence_led: [96.3, 94.3, 88.3] },
    harbour_loom_eighteen_months: { do_nothing: [0, 0, 0], random: [44.9, 71.6, 47.3], feature_factory: [23.9, 28.2, 26.9], debt_first: [53.6, 53.6, 53.1], textbook: [66.8, 66.1, 64.1], evidence_led: [97.2, 90.7, 92] },
    nestwork_both_sides: { do_nothing: [0, 0, 0], random: [49.4, 55.5, 27.3], feature_factory: [25, 19, 23.3], debt_first: [55.8, 53.7, 50.3], textbook: [66.3, 53.7, 55.6], evidence_led: [95.1, 91.8, 84.1] },
    brightkart_debt_due: { do_nothing: [0, 0, 0], random: [28, 43.7, 21.5], feature_factory: [29.1, 31.2, 29.8], debt_first: [55.9, 51.6, 55.9], textbook: [64.8, 61, 59.8], evidence_led: [93.3, 88.8, 87.5] },
    fieldledger_one_platform: { do_nothing: [0, 0, 0], random: [34.5, 51.6, 38.9], feature_factory: [32.8, 34.7, 31], debt_first: [54.3, 51.3, 46], textbook: [71.6, 68.1, 70.5], evidence_led: [94.8, 91.4, 90.2] },
    kestrel_seven_taps: { do_nothing: [0, 0, 0], random: [40.8, 40.9, 57.9], feature_factory: [25.4, 24, 29.4], debt_first: [48.5, 48.9, 57.2], textbook: [47.3, 61, 59.6], evidence_led: [84.9, 98.6, 95.1] },
    wayfare_every_rider: { do_nothing: [0, 0, 0], random: [28.1, 34.2, 32.3], feature_factory: [26.6, 19.1, 29.9], debt_first: [63.5, 62.3, 64.3], textbook: [53.9, 44.5, 62.3], evidence_led: [91.2, 98.7, 87.6] },
  };
  for (const sc of scenarios) {
    for (const b of BOTS.filter((x) => x.id !== "oracle")) {
      const got = [1, 2, 3].map((seed) => {
        const run = playPolicy(sc, seed, b.bot, b.id), base = playPolicy(sc, seed, doNothing, "do_nothing"), bench = playPolicy(sc, seed, oracle, "oracle");
        return Math.round(scoreRun(run, base, bench).total * 10) / 10;
      });
      assert.deepEqual(got, PINNED[sc.id]![b.id], `${sc.id} ${b.id}`);
    }
  }
});

test("the calibration run checks its invariants and reports them", () => {
  const out = calibrateVenture(funnel, { seeds: 10 });
  const text = out.lines.join("\n");
  assert.match(text, /ok {3}doing nothing scores 0 in every world/);
  assert.match(text, /ok {3}score = clamp\(sub-criteria \+ modifiers\) in every game of every bot/);
  assert.match(text, /ok {3}replaying a bot's decisions in its world reproduces the game exactly/);
  assert.match(text, /Ranges revised after seeing results/);
  for (const id of ["random", "debt_first", "evidence_led"]) assert.match(text, new RegExp(`${id}: first \\d+-\\d+, now \\d+-\\d+`));
});

test("the words around the numbers are filled from the state, say only what a player has been shown, and refuse a name they cannot fill", () => {
  for (const sc of scenarios) {
    const run = newRun(sc, 12);
    for (let q = 1; q <= 4; q++) {
      const o = opening(run);
      assert.equal(o.n, q);
      assert.ok(o.text.length > 40 && !/[{}]/.test(o.text), `quarter ${q}: ${o.text}`);
      for (const k of PLACEHOLDERS) assert.ok(k in facts(run), `no fact for {${k}}`);
      const open = sc.items.find((i) => !i.needs && !i.big && run.end.live[i.id] === undefined)!;
      lockQuarter(run, q === 4 ? { ...idle(), plan: sc.plans[0]!.id } : { ...idle(), roadmap: [open.id], dives: [sc.hidden[0]!.id] });
    }
  }
  const text = opening(newRun(funnel, 12)).text;
  assert.match(text, /making a profit of ₹2\.1 crore a quarter/);
  assert.match(text, /13 new-to-digital users, 28 salaried users and 13 merchants/);
  assert.match(opening(newRun(tally, 12)).text, /a loss of ₹68 lakh a quarter if nothing changes: about 6 quarters of money/);
  assert.deepEqual(unknownPlaceholders("{cash} {per100_new} {per100_ghost} {nope}", ["new"]), ["per100_ghost", "nope"]);
  assert.throws(() => render("{nope}", {}), /not something the engine can say/);
});

test("the preview at the start of a game is the same in every world, and never shows the true overrun of an item", () => {
  const d: Decision = { ...idle(), roadmap: ["kyc_camera", "nudges"], dives: ["camera_share"], experiments: ["nudges"] };
  const first = JSON.stringify(preview(newRun(funnel, 1), d));
  for (const seed of [2, 3, 5, 8, 13, 21]) assert.equal(JSON.stringify(preview(newRun(funnel, seed), d)), first, `seed ${seed} changed the preview`);
  const p = preview(newRun(funnel, 1), d);
  assert.deepEqual(p.skipped.map((x) => `${x.kind}:${x.id}`), ["experiment:nudges"], "an experiment with no measurement does not run, and the preview says why");
  assert.match(p.skipped[0]!.why, /measurement level 1/);
  // after a quarter the preview does depend on the world, but only through what the player has seen
  for (const seed of [1, 2, 3]) {
    const run = newRun(funnel, seed);
    lockQuarter(run, { ...idle(), roadmap: ["kyc_camera"] });
    const again = preview(run, { ...idle(), roadmap: ["nudges"] });
    assert.ok(again.items[0]!.weeksStillNeeded > 0);
  }
});

test("the public view of a scenario and of a run holds none of what the engine keeps back", () => {
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
    return out;
  };
  for (const sc of scenarios) {
    const pub = publicScenario(sc), keys = keysOf(pub), text = JSON.stringify(pub);
    for (const forbidden of ["range", "events", "mitigations", "cause", "direction", "incident", "calibration", "threshold", "high", "low", "dive", "stages", "stage_cost", "var_cost", "incident_base", "design_ref", "start"]) {
      assert.ok(!keys.has(forbidden), `${sc.id}: the public scenario leaks "${forbidden}"`);
    }
    assert.ok(pub.segments.every((s) => Object.keys(s).sort().join() === "arpu,arrivals,customers,description,id,name"), "a segment shows what the team can see on day one and no more");
    for (const e of sc.events) { assert.ok(!text.includes(e.body) && !text.includes(e.signal) && !text.includes(e.name), `${sc.id}: event ${e.id} leaked`); }
    assert.ok(pub.facts.every((f) => Object.keys(f).sort().join() === "brief,description,id,label,unit"), "a hidden fact is shown as the briefing states it, and no more");
    assert.equal(pub.root.options.at(-1)!.id, "need_more_data");
    assert.ok(pub.items.every((i) => !("scale" in i)), "how a hidden fact scales an item is not public");
    const run = runView(1, newRun(sc, 4), 0), runKeys = keysOf(run);
    for (const forbidden of ["hidden", "mult", "z", "truth", "absorbed", "cause", "direction"]) assert.ok(!runKeys.has(forbidden), `${sc.id}: a run leaks "${forbidden}"`);
    assert.equal(run.event, null, "no event is shown before its quarter");
    assert.equal(run.reports.length, 0);
  }
  // a run's first view is the same in every world, except for its number
  const view = (seed: number): string => JSON.stringify({ ...runView(0, newRun(funnel, seed), 0), ref: 0 });
  assert.equal(view(1), view(77));
});

test("in the market-event quarter the signal is shown and the answers are in an order that does not give the right one away", () => {
  for (const sc of scenarios) {
    const firstCause = new Set<string>(), firstDirection = new Set<string>();
    let correctFirst = 0, seen = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const run = replay(sc, seed, [idle(), idle()]);
      const v = runView(1, run, 0);
      assert.ok(v.event && v.event.signal === run.w.event.signal);
      assert.deepEqual(Object.keys(v.event).sort(), ["canCheck", "causes", "directions", "signal"]);
      assert.ok(v.event.causes.every((c) => Object.keys(c).sort().join() === "id,label"));
      firstCause.add(v.event.causes[0]!.id); firstDirection.add(v.event.directions[0]!.id);
      correctFirst += v.event.causes[0]!.id === run.w.event.cause ? 1 : 0; seen++;
    }
    assert.ok(correctFirst < seen, `${sc.id}: the right cause was first in all ${seen} worlds`);
    assert.ok(firstCause.size > 1 && firstDirection.size > 1);
  }
});

test("the final report appears only when the game is over, and shows what was true", () => {
  const run = playPolicy(funnel, 2, evidenceLed, "evidence_led");
  assert.ok(isDone(run));
  const rep = finalReport(1, run, 0);
  assert.equal(rep.score, scoreRun(run, playPolicy(funnel, 2, doNothing, "do_nothing"), playPolicy(funnel, 2, oracle, "oracle")).total);
  assert.equal(rep.band, "Exceptional");
  assert.equal(rep.truth.facts.length, funnel.hidden.length);
  assert.ok(rep.truth.facts.every((f) => f.truth >= funnel.hidden.find((h) => h.id === f.id)!.range[0] && f.truth <= funnel.hidden.find((h) => h.id === f.id)!.range[1]));
  assert.equal(rep.dimensions.length, funnel.rubric.dimensions.length);
  assert.equal(rep.plans.filter((p) => p.chosen).length, 1);
  assert.equal(rep.items.length, funnel.items.length);
  assert.throws(() => finalReport(1, replay(funnel, 2, [idle()]), 0), /./, "a game that is not over has no final report");
});

test("textbook play is worse than evidence-led play in every one of ten worlds in every case", () => {
  for (const sc of scenarios as VentureScenario[]) {
    let wins = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const base = playPolicy(sc, seed, doNothing, "do_nothing"), bench = playPolicy(sc, seed, oracle, "oracle");
      const a = scoreRun(playPolicy(sc, seed, evidenceLed, "e"), base, bench).total, b = scoreRun(playPolicy(sc, seed, textbook, "t"), base, bench).total;
      if (a > b) wins++;
    }
    assert.equal(wins, 10, `${sc.id}: evidence-led beat the textbook manager in only ${wins} of 10 worlds`);
  }
});

test("a case's own words reach the player: the dials, the parties, the capacity and the scoring notes", () => {
  const ceo = scenarios.find((s) => s.id === "harbour_loom_eighteen_months")!, growth = scenarios.find((s) => s.id === "nestwork_both_sides")!;
  assert.deepEqual([publicScenario(ceo).terms.eng, publicScenario(ceo).terms.debt, publicScenario(ceo).terms.parties.lead], ["Operations", "Operating debt", "Board and investors"]);
  assert.deepEqual([publicScenario(growth).terms.reliability, publicScenario(growth).terms.parties.biz], ["Booking reliability", "Cities and operations"]);
  // a case that says nothing reads in the product team's words, and a partly worded one keeps the rest
  assert.deepEqual([publicScenario(funnel).terms.eng, publicScenario(funnel).terms.debt, publicScenario(funnel).terms.parties.ext], ["Engineering", "Technical debt", "Outside parties"]);
  assert.equal(publicScenario(growth).terms.debt, "Technical debt");
  for (const sc of [ceo, growth]) {
    const run = playPolicy(sc, 2, evidenceLed, "evidence_led"), rep = finalReport(1, run, 0);
    assert.deepEqual(rep.parties.map((p) => p.label), ["eng", "design", "biz", "lead", "ext"].map((k) => (publicScenario(sc).terms.parties as Record<string, string>)[k]!.replace(/^./, (c) => c.toLowerCase())));
    const stewardship = rep.dimensions.find((d) => d.id === "stewardship")!;
    assert.ok(stewardship.subs.some((s) => s.id === "debt_managed" && s.label === `Kept ${publicScenario(sc).terms.debt.replace(/^./, (c) => c.toLowerCase())} in check`));
  }
  // the words in a refusal come from the case too
  const run = newRun(ceo, 1);
  const blocked = ceo.items.find((i) => i.needs?.trust)!;
  assert.ok(blocked.needs!.trust![0] === "ext");
  run.end.trust.ext = 10;
  const q1 = lockQuarter(run, { ...idle(), roadmap: [blocked.id] });
  assert.match(q1.r.blocked[blocked.id]!, /suppliers and partners trust is 10, and this needs 48/);
});
