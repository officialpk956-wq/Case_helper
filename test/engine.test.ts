import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOTS } from "../src/bots.ts";
import { DecisionError, ask, chooseEndgame, newRun, playCycle, returnWithoutWork } from "../src/engine.ts";
import { believedEndgameWorld, scalarEstimate } from "../src/beliefs.ts";
import { baselineOptOut, baselineReturn, blocked, experimentSlots, instrLevel, lever as leverOf, maxBets, spendOf } from "../src/model.ts";
import { loadScenario, playRun, replay } from "../src/play.ts";
import { fillDerived } from "../src/variation.ts";
import { IMPLEMENTED, deliveredShare, endgameValue } from "../src/rules.ts";
import { runScore, scoreCycle } from "../src/score.ts";
import type { Decision } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sc = loadScenario(join(here, "..", "scenarios", "retention-after-the-search.scenario.json"));
const playIn = (world: typeof sc, seed: number, ...ds: Decision[]) => { const r = newRun(world, seed, { vary: false }); for (const d of ds) playCycle(r, d); return r; };
const play = (seed: number, ...ds: Decision[]) => playIn(sc, seed, ...ds);
/** The case with room for any combination, for rules that are about what was chosen and not what fits. */
const wide = structuredClone(sc);
wide.capacity.eng_sprints_per_cycle = 30;
const rejects = (seed: number, ds: Decision[], msg: RegExp) => assert.throws(() => play(seed, ...ds), (e) => e instanceof DecisionError && msg.test(e.message));

test("every rule the scenario names is implemented, and every implemented rule is used", () => {
  const used = new Set<string>([
    ...sc.rubric.traits.flatMap((t) => t.subcriteria.map((s) => s.rule.fn)),
    ...sc.rubric.modifiers.map((m) => m.rule.fn),
    ...sc.events.pool.flatMap((e) => e.mitigations.map((m) => m.when.fn)),
    ...sc.endgame.options.map((o) => o.value_model.fn),
  ]);
  for (const f of used) assert.ok(IMPLEMENTED.has(f), `missing implementation: ${f}`);
  for (const f of IMPLEMENTED) assert.ok(used.has(f), `implemented but unused: ${f}`);
});

test("the same seed and the same decisions reproduce exactly", () => {
  const a = playRun(sc, 7, BOTS.insight_first!), b = playRun(sc, 7, BOTS.insight_first!);
  assert.deepEqual(a.scores, b.scores);
  assert.deepEqual(a.reports, b.reports);
});

test("a different seed changes what the player observes, not the world they act on", () => {
  const d: Decision = { start: ["application_tracker"] };
  const a = play(1, d), b = play(2, d);
  assert.equal(a.reports[0]!.true.return_30d, b.reports[0]!.true.return_30d);
  assert.notEqual(a.reports[0]!.observed.return_30d, b.reports[0]!.observed.return_30d);
});

test("decisions a player could not make are rejected", () => {
  rejects(1, [{ start: ["article_feed"] }], /needs instrumentation level 1/);
  rejects(1, [{ start: ["in_session_interactions"] }], /not available until cycle 2/);
  rejects(1, [{ start: ["instrumentation_v1", "instrumentation_v1"] }], /already started/);
  rejects(1, [{ start: ["application_tracker", "peer_groups", "course_partnerships", "instrumentation_v1", "user_interviews"] }], /over capacity/);
  rejects(1, [{ start: ["session_analytics"] }], /needs instrumentation level 1/);
  rejects(1, [{ clarify: ["why_retention", "why_retention"] }], /asked twice/);
  rejects(1, [{ clarify: ["why_retention", "focus_users", "define_retained", "current_data", "notif_constraints", "monetisation_plans", "time_horizon"] }], /out of clarifying questions/);
  rejects(1, [{ notifications: { active_applicants: { volume: 11 } } }], /volume/);
  rejects(1, [{ notifications: { active_applicants: { volume: 3, targeting: "preference_model" } } }], /not live/);
  rejects(1, [{ endgame: { option: "stay_free_invest" } }], /last cycle/);
  rejects(1, [{ experiments: [{ lever: "peer_groups", segment: "recently_placed", samplePct: 50, weeks: 6 }, { lever: "article_feed", segment: "recently_placed", samplePct: 50, weeks: 6 }, { lever: "application_tracker", segment: "active_applicants", samplePct: 50, weeks: 6 }] }], /too many experiments/);
  rejects(1, [{ experiments: [{ lever: "peer_groups", segment: "recently_placed", samplePct: 2, weeks: 6 }] }], /sample must be/);
  rejects(1, [{ drop: ["peer_groups"] }], /not running/);
});

test("a lever is not live until its lead time has passed, and ramps in", () => {
  const r = play(1, { start: ["application_tracker"] }, {}, {});
  const ret = (c: number) => r.reports[c - 1]!.true.segments.active_applicants!.return_30d;
  const base = sc.segments.find((s) => s.id === "active_applicants")!.baseline.return_30d;
  assert.equal(ret(1), base);
  assert.ok(ret(2) > base && ret(3) > ret(2), "half effect in its first live cycle, full effect after");
});

test("metrics that need session events stay hidden until they are tracked", () => {
  const without = play(1, {}, {});
  assert.equal("session_seconds" in without.reports[0]!.observed, false);
  assert.equal("session_seconds" in without.reports[1]!.observed, false);
  const tracked = play(1, {}, { start: ["instrumentation_v1"] });
  assert.equal("session_seconds" in tracked.reports[0]!.observed, false);
  assert.equal("session_seconds" in tracked.reports[1]!.observed, true);
  assert.equal("mau" in tracked.reports[0]!.observed, true);
});

test("research reveals what it says it reveals, at the stated fidelity", () => {
  const r = play(1, { start: ["instrumentation_v1", "session_analytics", "user_interviews"] });
  assert.equal(r.revealed.segment_response?.fidelity, "directional");
  assert.equal(r.revealed.skim_behaviour?.fidelity, "exact");
  assert.equal(r.revealed.skim_behaviour?.cycle, 1);
  assert.equal(r.revealed.attribution_gap, undefined);
});

test("notifications above the fatigue ceiling raise opt-outs; below it they do not", () => {
  const over = play(1, { notifications: { active_applicants: { volume: 9 } } });
  const under = play(1, { notifications: { active_applicants: { volume: 3 } } });
  const base = sc.segments.find((s) => s.id === "active_applicants")!.baseline.notif_opt_out;
  assert.ok(over.reports[0]!.true.segments.active_applicants!.notif_opt_out > base);
  assert.equal(under.reports[0]!.true.segments.active_applicants!.notif_opt_out, base);
  assert.ok(under.reports[0]!.true.segments.active_applicants!.weekly_sessions > sc.segments[0]!.baseline.weekly_sessions);
});

test("opt-out damage persists after the volume comes back down", () => {
  const r = play(1, { notifications: { active_applicants: { volume: 9 } } }, { notifications: { active_applicants: { volume: 2 } } });
  const base = sc.segments.find((s) => s.id === "active_applicants")!.baseline.notif_opt_out;
  assert.ok(r.reports[1]!.true.segments.active_applicants!.notif_opt_out > base);
});

test("bigger and longer tests are less noisy, and stopping early adds noise", () => {
  const sd = (samplePct: number, weeks: number, stoppedEarly = false) =>
    play(1, { experiments: [{ lever: "article_feed", segment: "recently_placed", samplePct, weeks, stoppedEarly }] }).tests[0]!.sd;
  assert.ok(sd(50, 6) < sd(10, 2));
  assert.ok(sd(50, 6, true) > sd(50, 6));
});

test("the market event is absorbed by what the player put in place", () => {
  const withCourse = newRun(sc, 1, { vary: false });
  withCourse.eventId = "competitor_free_courses";
  playCycle(withCourse, { start: ["course_partnerships"], clarify: [] });
  playCycle(withCourse, {});
  playCycle(withCourse, {});
  const without = newRun(sc, 1, { vary: false });
  without.eventId = "competitor_free_courses";
  playCycle(without, {});
  playCycle(without, {});
  playCycle(without, {});
  assert.ok(withCourse.mitigation! >= 0.6);
  assert.equal(without.mitigation, 0);
  assert.ok(withCourse.reports[2]!.true.segments.recently_placed!.return_30d > without.reports[2]!.true.segments.recently_placed!.return_30d);
});

test("inaction and form-filling do not score", () => {
  for (let seed = 1; seed <= 20; seed++) {
    assert.equal(runScore(playRun(sc, seed, BOTS.do_nothing!)), 0);
    assert.ok(runScore(playRun(sc, seed, BOTS.lazy_filler!)) < 25);
  }
});

test("a question that cannot be asked yet drops out of both sides of the score", () => {
  const r = playRun(sc, 1, BOTS.insight_first!);
  const c1 = r.scores[0]!;
  const na = c1.traits.flatMap((t) => t.subs).filter((s) => s.level === "na");
  assert.ok(na.length >= 2 && na.every((s) => s.maxPoints === 0 && s.points === 0));
  const got = c1.traits.reduce((a, t) => a + t.points, 0), can = c1.traits.reduce((a, t) => a + t.applicableWeight, 0);
  assert.ok(Math.abs(c1.traitTotal - (100 * got) / can) < 1e-9);
  assert.ok(can < 100);
});

test("a modifier fires in the cycle it happens, once", () => {
  const fired = (r: ReturnType<typeof play>, id: string) => r.scores.map((s) => s.modifiers.some((m) => m.id === id));
  const measured = play(1, { start: ["instrumentation_v1", "session_analytics"] }, { start: ["article_feed"] }, {});
  assert.equal(fired(measured, "found_it_first").filter(Boolean).length, 1);
  assert.equal(fired(measured, "built_the_favourite").filter(Boolean).length, 0);
  assert.deepEqual(fired(play(1, { start: ["peer_groups"] }, {}, {}), "built_the_favourite"), [true, false, false]);
});

test("the endgame is graded against the best option, and 'stay free' pays only if retention actually rose", () => {
  const r = newRun(sc, 1, { vary: false });
  for (let i = 0; i < 3; i++) playCycle(r, {});
  playCycle(r, { endgame: { option: "stay_free_invest" } });
  assert.equal(r.endgame!.values.stay_free_invest, 0);
  assert.ok(r.endgame!.values.premium_subscription! > 0);
  assert.equal(r.endgame!.ratio, 0);
});

test("scoring arithmetic: weights sum to 100 and final = traits + modifiers, clamped", () => {
  assert.equal(sc.rubric.traits.reduce((a, t) => a + t.weight, 0), 100);
  for (const name of Object.keys(BOTS)) {
    for (const s of playRun(sc, 3, BOTS[name]!).scores) {
      assert.ok(Math.abs(s.final - Math.min(100, Math.max(0, s.traitTotal + s.modifierTotal))) < 1e-9);
    }
  }
});


test("rules the bots never exercise still reach the levels they claim to", () => {
  const level = (r: ReturnType<typeof play>, cycle: number, id: string) => r.scores[cycle - 1]!.traits.flatMap((t) => t.subs).find((s) => s.id === id)!.level;

  // Success defined only after building -> part. Focus declared late -> part.
  const late = play(1, { clarify: ["define_retained"], start: ["application_tracker"] }, { reflection: { primary_metric: "return_30d" }, focusSegment: "recently_placed" });
  assert.equal(level(late, 2, "metric_before_build"), "part");
  assert.equal(level(late, 2, "scope_declared"), "part");
  assert.equal(level(play(1, { clarify: ["define_retained"], reflection: { primary_metric: "return_30d" }, focusSegment: "recently_placed", start: ["application_tracker"] }), 1, "metric_before_build"), "full");

  // Four new bets in one cycle is sprinkled; three is not.
  const four = playIn(wide, 1, { start: ["instrumentation_v1", "application_tracker", "course_partnerships", "user_interviews"] });
  assert.equal(four.scores[0]!.modifiers.some((m) => m.id === "sprinkled"), false, "research does not count as a bet");
  const sprinkled = playIn(wide, 1, { start: ["instrumentation_v1", "instrumentation_v2", "application_tracker", "course_partnerships"] });
  assert.equal(sprinkled.scores[0]!.modifiers.some((m) => m.id === "sprinkled"), true);
  assert.equal(playIn(wide, 1, { start: ["application_tracker", "course_partnerships", "instrumentation_v1"] }).scores[0]!.modifiers.some((m) => m.id === "sprinkled"), false);

  // Drop a lever a test showed does nothing -> the kill is credited. Find a seed where the test comes back a clear loss.
  const test1 = { lever: "application_tracker", segment: "recently_placed", samplePct: 50, weeks: 6 };
  const seed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((s) => play(s, { start: ["application_tracker"], experiments: [test1] }).tests[0]!.verdict === "loss")!;
  assert.ok(seed, "some seed must produce a losing test for a lever with no effect on this segment");
  const killed = play(seed, { start: ["application_tracker"], experiments: [test1] }, { drop: ["application_tracker"] });
  assert.equal(killed.scores[1]!.modifiers.some((m) => m.id === "killed_a_loser"), true);
  assert.equal(level(killed, 2, "acted_on_result"), "full");
  const kept = play(seed, { start: ["application_tracker"], experiments: [test1] }, {});
  assert.equal(kept.scores[1]!.modifiers.some((m) => m.id === "killed_a_loser"), false);
  assert.equal(level(kept, 2, "acted_on_result"), "none");
});

test("per-seed variation is deterministic, differs across worlds, and keeps the structure of the story", () => {
  const a = newRun(sc, 5), b = newRun(sc, 5), c = newRun(sc, 6);
  assert.deepEqual(a.sc, b.sc);
  assert.notDeepEqual(a.sc.levers, c.sc.levers);
  assert.deepEqual(newRun(sc, 5, { vary: false }).sc, fillDerived(structuredClone(sc)));

  // Zero effects stay zero, signs never flip, only magnitudes move.
  for (const l of sc.levers) {
    for (const [seg, ef] of Object.entries(l.effects ?? {})) {
      for (const k of ["weekly_sessions_rel", "session_seconds_rel", "return_30d_rel"] as const) {
        const was = ef[k], now = c.sc.levers.find((x) => x.id === l.id)!.effects![seg]![k];
        if (was === undefined) assert.equal(now, undefined);
        else assert.ok(Math.sign(now!) === Math.sign(was) && now !== was, l.id + "/" + seg + "/" + k);
      }
    }
  }
  assert.equal(c.sc.levers.find((l) => l.id === "application_tracker")!.effects!.recently_placed, undefined, "a lever that does nothing for a segment still does nothing");
  assert.deepEqual(c.sc.segments, sc.segments, "what the player can observe never moves");

  for (let seed = 1; seed <= 200; seed++) {
    const w = newRun(sc, seed).sc;
    const ceil = w.hidden_variables.find((h) => h.id === "notif_fatigue_ceiling")!.truth as Record<string, number>;
    for (const s of sc.segments) assert.ok(ceil[s.id]! >= 1.25 * sc.engine.notification_baseline.volume[s.id]! - 1e-9, "ceilings stay above current practice");
    const gap = w.hidden_variables.find((h) => h.id === "attribution_gap")!.truth as number;
    assert.ok(gap >= 0.12 && gap <= 0.85);
  }
});

test("which lever and which segment respond most really does change from world to world", () => {
  const impact = (l: { effects?: Record<string, { return_30d_rel?: number }> }, w: typeof sc) => w.segments.reduce((t, s) => t + s.share * (l.effects?.[s.id]?.return_30d_rel ?? 0), 0);
  const topSegment = new Set<string>(), orders = new Set<string>();
  for (let seed = 1; seed <= 100; seed++) {
    const w = newRun(sc, seed).sc;
    topSegment.add(Object.entries(w.levers.find((l) => l.id === "article_feed")!.effects!).sort((x, y) => y[1].return_30d_rel! - x[1].return_30d_rel!)[0]![0]);
    orders.add(w.levers.filter((l) => l.kind === "build" && l.effects).sort((x, y) => impact(y, w) - impact(x, w)).map((l) => l.id).join(">"));
  }
  assert.ok(topSegment.size >= 2, "the feed does not always suit the same segment");
  assert.ok(orders.size >= 3, "the best lever and the order of the rest differ between worlds");
});

test("a revealed hidden variable returns a value at its stated fidelity", () => {
  // exact: session analytics returns the truth as it is
  const exact = play(1, { start: ["instrumentation_v1", "session_analytics"] }).revealed.skim_behaviour!.readings[0]!;
  assert.equal(exact.fidelity, "exact");
  assert.deepEqual(exact.value, { median_session_seconds: 22, share_status_check_only: 0.8 });

  // directional: interviews return an order per segment and never a magnitude
  const iv = play(1, { start: ["user_interviews"] }).revealed.segment_response!.readings[0]!;
  assert.equal(iv.fidelity, "directional");
  for (const s of sc.segments) {
    const v = (iv.value as Record<string, { order: string[] }>)[s.id]!;
    assert.equal(v.order.length, 5);
    assert.ok(!("article_feed" in v), "no per-lever numbers in a directional reading");
  }

  // noisy and partial: the exit survey reads only the placed segment, as numbers that are not the truth
  const survey = play(1, { start: ["placed_exit_survey"] }).revealed.price_sensitivity!.readings[0]!;
  assert.equal(survey.fidelity, "noisy");
  assert.deepEqual(Object.keys(survey.value as object), ["recently_placed"]);
  const est = (survey.value as Record<string, number>).recently_placed!;
  assert.ok(typeof est === "number" && est !== 0.01);

  // a scalar read directionally comes back as a bucket, never a number
  const gap = play(1, { clarify: ["monetisation_plans"] }).revealed.attribution_gap!.readings[0]!;
  assert.ok(["below", "typical", "above"].includes((gap.value as { bucket: string }).bucket));

  // the same source in the same cycle gives the same reading; a different seed gives a different one
  const again = play(1, { start: ["placed_exit_survey"] }).revealed.price_sensitivity!.readings[0]!;
  assert.deepEqual(again.value, survey.value);
  assert.notDeepEqual(play(2, { start: ["placed_exit_survey"] }).revealed.price_sensitivity!.readings[0]!.value, survey.value);
});

test("a bigger, longer test reads the hidden ceiling more closely, and only for the segment tested", () => {
  const error = (samplePct: number, weeks: number): number => {
    let total = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = play(seed, { experiments: [{ lever: "notification_policy", segment: "active_applicants", samplePct, weeks, volume: 6 }] });
      const v = r.revealed.notif_fatigue_ceiling!.readings[0]!.value as Record<string, number>;
      assert.deepEqual(Object.keys(v), ["active_applicants"]);
      total += Math.abs(v.active_applicants! - 5) / 5;
    }
    return total / 60;
  };
  assert.ok(error(50, 6) < error(10, 2) / 2, "a test with 15x the exposure should be several times closer");
});

test("what each segment responds to is derived from the world's own lever effects", () => {
  for (const seed of [1, 9, 40]) {
    const w = newRun(sc, seed).sc;
    const truth = w.hidden_variables.find((h) => h.id === "segment_response")!.truth as Record<string, Record<string, number>>;
    for (const s of sc.segments) for (const l of w.levers.filter((x) => x.kind === "build" && x.effects)) assert.equal(truth[s.id]![l.id], l.effects![s.id]?.return_30d_rel ?? 0);
  }
});

test("a player who reads the interviews finds each segment's best lever far more often than chance, but not always", () => {
  let hits = 0, n = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const run = newRun(sc, seed); // a different world every seed
    playCycle(run, { start: ["user_interviews"] });
    const truth = run.sc.hidden_variables.find((h) => h.id === "segment_response")!.truth as Record<string, Record<string, number>>;
    const shown = run.revealed.segment_response!.readings[0]!.value as Record<string, { order: string[] }>;
    for (const s of sc.segments) {
      n++;
      const best = Object.entries(truth[s.id]!).sort((a, b) => b[1] - a[1])[0]![0];
      if (shown[s.id]!.order[0] === best) hits++;
    }
  }
  assert.ok(hits / n > 0.5, "the interview is informative; chance would be 0.2, got " + (hits / n).toFixed(2));
  assert.ok(hits / n < 1, "and it is not a leak of the truth");
});

test("baselines are what the file says they are", () => {
  assert.ok(Math.abs(baselineReturn(newRun(sc, 1, { vary: false })) - 0.183) < 1e-9);
  assert.ok(Math.abs(baselineOptOut(newRun(sc, 1, { vary: false })) - 0.2255) < 1e-9);
});

test("builds are scored by the lift they deliver over the run against the best the player could have started", () => {
  const sub = (r: ReturnType<typeof play>, cycle: number) => r.scores[cycle - 1]!.traits.find((x) => x.id === "prioritisation")!.subs.find((s) => s.id === "spent_where_it_pays")!;
  const none = play(1, {});
  assert.equal(deliveredShare(none, 1), null);
  assert.equal(sub(none, 1).level, "none");

  // The same lever starting a cycle later delivers less of its lift, whatever the world.
  const early = deliveredShare(play(1, { start: ["peer_groups"] }, {}, {}), 3)!;
  const late = deliveredShare(play(1, {}, { start: ["peer_groups"] }, {}), 3)!;
  assert.ok(early.share > late.share && early.share <= 1);

  // The best plan fits what the player left for building each cycle, and where it is best to put it depends on the world.
  const cost = (id: string): number => sc.levers.find((l) => l.id === id)!.cost_sprints;
  const plans = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const r = playRun(sc, seed, BOTS.answer_key_guesser!);
    const d = deliveredShare(r, 3)!;
    for (let c = 1; c <= 3; c++) {
      const dec = r.decisions[c - 1]!;
      const room = sc.capacity.eng_sprints_per_cycle - spendOf(sc, dec) + (dec.start ?? []).filter((id) => sc.levers.find((l) => l.id === id)!.kind === "build").reduce((x, id) => x + cost(id), 0);
      assert.ok(d.best.filter((p) => p.cycle === c).reduce((x, p) => x + cost(p.id), 0) <= room + 1e-9);
    }
    assert.ok(d.share > 0 && d.share <= 1);
    plans.add(d.best.map((p) => p.id + "@" + p.cycle).join(" "));
  }
  assert.ok(plans.size > 1, "the best plan should differ between worlds when capacity binds");

  // The best plan cannot use what the player could not have started: no feed without tracking, nothing before it is available.
  const blind = deliveredShare(play(1, { start: ["peer_groups"] }, { start: ["application_tracker"] }), 2)!;
  assert.ok(blind.best.every((p) => !["article_feed", "in_session_interactions"].includes(p.id)));
});

test("a claim about the world earns full credit only once something the player learned stands behind it", () => {
  const sub = (r: ReturnType<typeof play>, id: string) => r.scores[0]!.traits.flatMap((t) => t.subs).find((s) => s.id === id)!;
  const claims: Decision = { reflection: { primary_metric: "return_30d", guardrail_metric: "notif_opt_out" }, focusSegment: "recently_placed" };

  const guess = play(1, claims);
  for (const id of ["metric_before_build", "scope_declared", "primary_and_guardrail"]) assert.equal(sub(guess, id).level, "part", id);
  assert.match(sub(guess, "scope_declared").evidence, /no interview or survey/);

  const informed = play(1, { ...claims, clarify: ["define_retained", "notif_constraints"], start: ["user_interviews"] });
  for (const id of ["metric_before_build", "scope_declared", "primary_and_guardrail"]) assert.equal(sub(informed, id).level, "full", id);

  // A test on some other segment does not say who to focus on.
  const tested = play(1, { ...claims, clarify: ["define_retained"], experiments: [{ lever: "peer_groups", segment: "active_applicants", samplePct: 50, weeks: 6 }] });
  assert.equal(sub(tested, "scope_declared").level, "part");
});

test("case facts differ by seed, follow their weights, and are the file's first option when the world is not varied", () => {
  const draws = Array.from({ length: 400 }, (_, i) => newRun(sc, i + 1).facts);
  const share = (k: string, v: string) => draws.filter((f) => f[k] === v).length / draws.length;
  assert.ok(Math.abs(share("tracking", "sessions") - 0.4) < 0.08 && Math.abs(share("scope", "both") - 0.5) < 0.08 && Math.abs(share("backing", "two") - 0.4) < 0.08 && Math.abs(share("backing", "one") - 0.3) < 0.08);
  assert.ok(["competitor_free_courses", "job_supply_dip", "notification_bug"].every((e) => share("threat", e) > 0.15));
  assert.deepEqual(newRun(sc, 9).facts, newRun(sc, 9).facts);
  for (const s of [1, 2, 3]) { const f = newRun(sc, s, { vary: false }).facts; assert.deepEqual({ tracking: f.tracking, scope: f.scope, backing: f.backing }, { tracking: "none", scope: "both", backing: "any" }); }
});

const worldWhere = (want: Record<string, string>): number => {
  for (let s = 1; s <= 400; s++) if (Object.entries(want).every(([k, v]) => newRun(sc, s).facts[k] === v)) return s;
  throw new Error("no seed has " + JSON.stringify(want));
};

test("a briefing is read before the first cycle, costs the same tokens, and what it says depends on the case", () => {
  const sd = worldWhere({ tracking: "sessions", scope: "post_placement", threat: "job_supply_dip" });
  const r = newRun(sc, sd);
  ask(r, ["why_retention"]);
  assert.match(r.answers.why_retention!, /hiring market/);
  assert.equal(r.known.watch, "hiring_market");
  ask(r, ["current_data", "focus_users", r.known.watch!]);
  assert.equal(r.known.tracking, "sessions");
  assert.equal(r.known.scope, "post_placement");
  assert.equal(r.known.threat, "job_supply_dip");
  assert.equal(r.askedAt.hiring_market, 0);
  assert.throws(() => ask(r, ["why_retention"]), /asked twice/);
  assert.throws(() => ask(r, ["office_count", "eng_capacity", "time_horizon"]), /out of clarifying questions/);
  playCycle(r, {});
  assert.throws(() => ask(r, ["office_count"]), /only before the first cycle/);

  // The same questions in a different world say different things, and the pointer does not give the threat away.
  const other = newRun(sc, worldWhere({ tracking: "none", scope: "both", threat: "competitor_free_courses" }));
  ask(other, ["why_retention", "current_data", "focus_users"]);
  assert.equal(other.known.watch, "competitors");
  assert.equal(other.known.tracking, "none");
  assert.equal(other.known.threat, undefined);
});

test("a company that can already see sessions has level one from the start, and paying for it again is the waste the rubric names", () => {
  const sd = worldWhere({ tracking: "sessions" });
  assert.equal(instrLevel(newRun(sc, sd), 1), 1);
  const sub = (r: ReturnType<typeof play>) => r.scores[0]!.traits.flatMap((t) => t.subs).find((s) => s.id === "measure_before_depend")!;
  const informed = replay(sc, sd, [{ start: ["instrumentation_v2", "article_feed"] }]);
  assert.equal(sub(informed).level, "full");
  const redundant = replay(sc, sd, [{ start: ["instrumentation_v1", "article_feed"] }]);
  assert.equal(sub(redundant).level, "part");
  assert.match(sub(redundant).evidence, /already had/);

  // Where it cannot be seen, the feed cannot be built without tracking, and tracking first is right.
  const none = worldWhere({ tracking: "none" });
  assert.throws(() => replay(sc, none, [{ start: ["article_feed"] }]), /needs instrumentation level 1/);
  assert.equal(sub(replay(sc, none, [{ start: ["instrumentation_v1", "article_feed"] }])).level, "full");
});

test("a build for a stage the brief rules out costs capacity and delivers nothing", () => {
  const sd = worldWhere({ scope: "during_search" });
  const world = newRun(sc, sd);
  assert.ok(blocked(world, leverOf(world, "course_partnerships")) && !blocked(world, leverOf(world, "peer_groups")) && !blocked(world, leverOf(world, "application_tracker")));
  const ret = (ds: Decision[]) => replay(sc, sd, ds).reports[2]!.true.return_30d;
  const nothing = ret([{}, {}, {}]);
  assert.equal(ret([{ start: ["course_partnerships"] }, {}, {}]), nothing);
  assert.ok(ret([{ start: ["peer_groups"] }, {}, {}]) > nothing);

  const sub = (r: ReturnType<typeof play>, id: string) => r.scores[0]!.traits.flatMap((t) => t.subs).find((s) => s.id === id)!;
  const wasted = replay(sc, sd, [{ start: ["course_partnerships"] }]);
  assert.equal(sub(wasted, "whole_journey").level, "none");
  const mixed = replay(sc, sd, [{ start: ["application_tracker", "course_partnerships"] }]);
  assert.equal(sub(mixed, "whole_journey").level, "part");
  assert.match(sub(mixed, "whole_journey").evidence, /outside this quarter's brief/);
  assert.equal(sub(replay(sc, sd, [{ start: ["application_tracker"] }]), "whole_journey").level, "full");
  // A focus on the stage the brief rules out is not a focus.
  assert.equal(sub(replay(sc, sd, [{ focusSegment: "recently_placed", clarify: ["focus_users"] }]), "scope_declared").level, "part");
});

test("the question that carries the signal is the one the quarter's worry points to", () => {
  const core = ["why_retention", "focus_users", "define_retained", "current_data", "notif_constraints"];
  const sub = (r: ReturnType<typeof play>) => r.scores[0]!.traits.flatMap((t) => t.subs).find((s) => s.id === "asked_what_mattered")!;
  const rival = worldWhere({ threat: "competitor_free_courses" }), hiring = worldWhere({ threat: "job_supply_dip" });
  assert.equal(sub(replay(sc, rival, [{}], { briefing: [...core, "competitors"] })).level, "full");
  assert.equal(sub(replay(sc, rival, [{}], { briefing: [...core, "monetisation_plans"] })).level, "part");
  assert.equal(sub(replay(sc, hiring, [{}], { briefing: [...core, "competitors"] })).level, "part");
  assert.equal(sub(replay(sc, hiring, [{}], { briefing: [...core, "hiring_market"] })).level, "full");
  assert.match(sub(replay(sc, hiring, [{}], { briefing: [...core, "competitors"] })).evidence, /hiring market/);
});

test("the bots that read answers act on them, and the one that recites does not", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const name of ["insight_first", "insight_by_reach", "cautious_researcher"]) {
      const r = playRun(sc, seed, BOTS[name]!);
      assert.equal(r.known.threat, r.eventId, `${name} should have been told the threat in seed ${seed}`);
      assert.equal(r.started.instrumentation_v1 === undefined, r.facts.tracking === "sessions", `${name} tracking in seed ${seed}`);
    }
    const r = playRun(sc, seed, BOTS.insight_first!);
    assert.ok(Object.keys(r.started).every((id) => !blocked(r, leverOf(r, id))), `insight_first built something the brief rules out in seed ${seed}`);
  }
  const wasted = Array.from({ length: 80 }, (_, i) => playRun(sc, i + 1, BOTS.answer_key_guesser!)).filter((r) => Object.keys(r.started).some((id) => blocked(r, leverOf(r, id)))).length;
  assert.ok(wasted > 0, "a fixed script must sometimes build what the brief rules out");
});

test("the review: how to monetise can be chosen on the final report, once, and the last cycle is scored again with it", () => {
  const sub = (r: ReturnType<typeof play>) => r.scores[3]!.traits.flatMap((t) => t.subs).find((s) => s.id === "pricing_fit")!;
  const r = newRun(sc, 3);
  for (let i = 0; i < 3; i++) playCycle(r, {});
  assert.throws(() => chooseEndgame(r, { option: "stay_free_invest" }), /not been played/);
  playCycle(r, {});
  assert.equal(r.endgame, null);
  assert.equal(sub(r).level, "none");
  assert.throws(() => chooseEndgame(r, { option: "nonsense" }), /unknown option/);
  chooseEndgame(r, { option: "premium_subscription", reasoning: "on the report", status: { hypothesis: "h", bet: "This cycle we choose Premium subscription.", expected_movement: "m", risk: "r" } });
  assert.equal(r.endgame!.option, "premium_subscription");
  assert.deepEqual(r.decisions[3]!.endgame, { option: "premium_subscription", reasoning: "on the report" });
  assert.notEqual(sub(r).level, "none");
  assert.equal(r.scores.length, 4);
  assert.throws(() => chooseEndgame(r, { option: "stay_free_invest" }), /already made/);

  // Choosing in the last decision, as before, still works, and then there is nothing left to review.
  const blind = newRun(sc, 3);
  for (let i = 0; i < 3; i++) playCycle(blind, {});
  playCycle(blind, { endgame: { option: "premium_subscription" } });
  assert.throws(() => chooseEndgame(blind, { option: "stay_free_invest" }), /already made/);
});

test("the headline retention metric carries the share of measurement noise the case gives it", () => {
  const noiseless = structuredClone(sc);
  noiseless.metrics.find((m) => m.id === "return_30d")!.noise_scale = 0;
  const run = newRun(noiseless, 5);
  playCycle(run, {});
  assert.equal(run.reports[0]!.observed.return_30d, run.reports[0]!.true.return_30d);
  assert.notEqual(run.reports[0]!.observed.weekly_sessions, run.reports[0]!.true.weekly_sessions);

  // Without tracking the case sees return at level 0, and its error is a fraction of what other metrics carry.
  const spread = (key: string): number => {
    const rel = Array.from({ length: 200 }, (_, i) => { const r = newRun(sc, i + 1, { vary: false }); playCycle(r, {}); return r.reports[0]!.observed[key]! / r.reports[0]!.true[key as "return_30d"] - 1; });
    return Math.sqrt(rel.reduce((a, v) => a + v * v, 0) / rel.length);
  };
  assert.ok(spread("return_30d") < 0.5 * spread("weekly_sessions"));
});

test("an evidence-driven player settles the monetisation call far more often than any fixed answer does", () => {
  const seeds = Array.from({ length: 100 }, (_, i) => i + 1);
  const runs = seeds.map((s) => playRun(sc, s, BOTS.insight_first!));
  const within = (r: ReturnType<typeof playRun>, o: string): boolean => r.endgame!.values[o]! >= 0.85 * r.endgame!.best;
  const rate = (f: (r: ReturnType<typeof playRun>) => boolean) => runs.filter(f).length / runs.length;
  const chosen = rate((r) => r.endgame!.ratio >= 0.85);
  const best = Math.max(...sc.endgame.options.map((o) => rate((r) => within(r, o.id))));
  assert.ok(chosen >= 0.8, `chose within 85% of best only ${chosen}`);
  assert.ok(chosen - best >= 0.15, `no better than the best fixed answer (${best})`);
  // It read the final report, not a forecast: its belief about the return rate lies between that report's reading
  // and the holdout's, and with no holdout it is the report's reading.
  for (const r of runs.slice(0, 10)) {
    const dash = r.reports[3]!.observed.return_30d!, rest = r.tests.find((t) => t.lever === "cohort_holdout")!.cohorts!.rest;
    const got = believedEndgameWorld(r, 4).returnRate;
    assert.ok(got >= Math.min(dash, rest) && got <= Math.max(dash, rest));
  }
  for (let seed = 1; seed <= 5; seed++) {
    const g = playRun(sc, seed, BOTS.answer_key_guesser!);
    assert.equal(believedEndgameWorld(g, 4).returnRate, g.reports[3]!.observed.return_30d);
  }
});

test("leadership backs only so many bets: later builds are stopped at launch, and concentration is judged against that number", () => {
  const two = worldWhere({ backing: "two", scope: "both" }), any = worldWhere({ backing: "any", scope: "both" });
  const ret = (seed: number, ds: Decision[]) => replay(sc, seed, ds).reports[2]!.true.return_30d;
  const sub = (r: ReturnType<typeof play>) => r.scores[1]!.traits.flatMap((t) => t.subs).find((s) => s.id === "bets_concentrated")!;
  const third = [{ start: ["peer_groups", "application_tracker"] }, { start: ["course_partnerships"] }, {}];
  const two_only = [{ start: ["peer_groups", "application_tracker"] }, {}, {}];

  // Where two bets are backed, the third adds nothing; where there is no cap it does.
  assert.equal(ret(two, third), ret(two, two_only));
  assert.ok(ret(any, third) > ret(any, two_only));
  const w = newRun(sc, two);
  assert.equal(maxBets(w), 2);
  playCycle(w, { start: ["peer_groups", "application_tracker"] });
  playCycle(w, { start: ["course_partnerships"] });
  assert.ok(blocked(w, leverOf(w, "course_partnerships")) && !blocked(w, leverOf(w, "peer_groups")));

  // The same three bets are concentrated or not depending on the number leadership will back.
  assert.equal(sub(replay(sc, two, third.slice(0, 2))).level, "part");
  assert.match(sub(replay(sc, two, third.slice(0, 2))).evidence, /would back 2 bets this quarter and you started 3/);
  assert.equal(sub(replay(sc, any, third.slice(0, 2))).level, "full");
  assert.equal(sub(replay(sc, two, two_only.slice(0, 2))).level, "full");
});

test("the engineering-capacity question tells the player how many bets will be backed, and the plan to beat respects it", () => {
  for (const [backing, n] of [["one", "1"], ["two", "2"], ["three", "3"], ["any", "5"]] as const) {
    const r = newRun(sc, worldWhere({ backing }));
    ask(r, ["eng_capacity"]);
    assert.equal(r.known.bets, n);
    assert.match(r.answers.eng_capacity!, backing === "any" ? /not capped/ : /will back/);
  }
  for (let seed = 1; seed <= 40; seed++) {
    const r = playRun(sc, seed, BOTS.answer_key_guesser!);
    assert.ok(deliveredShare(r, 3)!.best.length <= maxBets(r), `seed ${seed}`);
  }
});

test("the bots that read answers never start more bets than leadership will back, and the one that recites does", () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const name of ["insight_first", "insight_by_reach"]) {
      const r = playRun(sc, seed, BOTS[name]!);
      assert.equal(r.known.bets, String(maxBets(r)), `${name} was told the number in seed ${seed}`);
      assert.ok(Object.keys(r.started).filter((id) => leverOf(r, id).kind === "build").length <= maxBets(r), `${name} overspent its bets in seed ${seed}`);
    }
  }
  const over = Array.from({ length: 80 }, (_, i) => playRun(sc, i + 1, BOTS.answer_key_guesser!)).filter((r) => Object.keys(r.started).filter((id) => leverOf(r, id).kind === "build").length > maxBets(r)).length;
  assert.ok(over > 0, "a fixed script must sometimes start more bets than are backed");
});

test("a willingness-to-pay test reads what a segment would pay, only for the segment shown, and closer the more of them see it", () => {
  const error = (samplePct: number, weeks: number): number => {
    let total = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = replay(sc, seed, [{ experiments: [{ lever: "subscription_offer", segment: "active_applicants", samplePct, weeks }] }]);
      const reading = r.revealed.price_sensitivity!.readings.at(-1)!;
      const v = reading.value as Record<string, number>;
      assert.deepEqual(Object.keys(v), ["active_applicants"]);
      assert.equal(reading.via, "ab_test");
      const truth = (r.sc.hidden_variables.find((h) => h.id === "price_sensitivity")!.truth as Record<string, number>).active_applicants!;
      total += Math.abs(v.active_applicants! - truth) / truth;
      assert.equal(r.tests[0]!.estimate, v.active_applicants); // the report shows the number the test read
      assert.equal(r.tests[0]!.verdict, "inconclusive");
    }
    return total / 60;
  };
  assert.ok(error(50, 6) < error(10, 2) / 2, "a test with 15x the exposure should be several times closer");
  assert.ok(error(50, 6) < 0.12, "a good test reads within about a tenth");
});

test("a success-fee test reads the share of placements that cannot be traced, one number for everyone", () => {
  const r = replay(sc, 5, [{ experiments: [{ lever: "fee_offer", segment: "active_applicants", samplePct: 50, weeks: 6 }] }]);
  const truth = r.sc.hidden_variables.find((h) => h.id === "attribution_gap")!.truth as number;
  const reading = r.revealed.attribution_gap!.readings[0]!;
  assert.equal(typeof reading.value, "number");
  assert.ok(Math.abs((reading.value as number) - truth) / truth < 0.5);
  assert.equal(r.tests[0]!.estimate, reading.value);
  rejects(1, [{ experiments: [{ lever: "user_interviews", segment: "active_applicants", samplePct: 50, weeks: 6 }] }], /cannot be A\/B tested/);
});

test("pricing tests judge nothing: they are tests with good hygiene and never a result to act on", () => {
  const r = play(1, { experiments: [{ lever: "subscription_offer", segment: "recently_placed", samplePct: 50, weeks: 6 }] }, {});
  const level = (cycle: number, id: string) => r.scores[cycle - 1]!.traits.flatMap((t) => t.subs).find((s) => s.id === id)!.level;
  assert.equal(level(1, "test_hygiene"), "full");
  assert.equal(level(2, "acted_on_result"), "na");
});

test("beliefs pool every reading of one number, and a precise test outweighs a noisy survey", () => {
  const r = replay(sc, 3, [{ start: ["placed_exit_survey"], experiments: [{ lever: "fee_offer", segment: "active_applicants", samplePct: 50, weeks: 6 }] }]);
  const readings = r.revealed.attribution_gap!.readings;
  const test = readings.find((x) => x.via === "ab_test")!, survey = readings.find((x) => x.via === "placed_exit_survey")!;
  assert.ok(test.sd < survey.sd);
  const pooled = scalarEstimate(r, "attribution_gap")!;
  assert.ok(Math.abs(pooled - (test.value as number)) <= Math.abs(pooled - (survey.value as number)));
});

test("the insight bots hold a retention holdout and price the subscription and the fee in the last cycle, and end up close on all three", () => {
  const err = (id: string): number => {
    const o = sc.endgame.options.find((x) => x.id === id)!;
    const e = Array.from({ length: 80 }, (_, i) => {
      const r = playRun(sc, i + 1, BOTS.insight_first!);
      return Math.abs(endgameValue(r, o.value_model.params, 4, believedEndgameWorld(r, 4)) / r.endgame!.values[id]! - 1);
    }).sort((a, b) => a - b);
    return e[Math.floor(e.length / 2)]!;
  };
  const r = playRun(sc, 2, BOTS.insight_first!);
  assert.deepEqual(r.tests.filter((t) => t.lever === "subscription_offer").map((t) => [t.cycle, t.segment]), [[4, "active_applicants"]]);
  assert.deepEqual(r.tests.filter((t) => t.lever === "fee_offer").map((t) => [t.cycle, t.segment]), [[4, "active_applicants"]]);
  assert.deepEqual(r.tests.filter((t) => t.lever === "cohort_holdout").map((t) => [t.cycle, t.samplePct, t.weeks]), [[4, 10, 6]]);
  assert.ok(err("premium_subscription") < 0.12, "subscription value should be believed within about a tenth");
  assert.ok(err("pay_on_placement") < 0.08, "fee value should be believed within a few percent");
  assert.ok(err("stay_free_invest") < 0.15, "the value of staying free should be believed within about a tenth");
});

test("a cohort holdout reads the whole base and a cohort kept off the work, which retains less by what the work delivered", () => {
  const holdout = { lever: "cohort_holdout", segment: "active_applicants", samplePct: 10, weeks: 6 };
  const work: Decision[] = [{ start: ["peer_groups", "application_tracker"] }, {}, {}, { experiments: [holdout] }];
  for (let seed = 1; seed <= 40; seed++) {
    const r = replay(sc, seed, work);
    const t = r.tests[0]!, c = t.cohorts!;
    const rest = r.reports[3]!.true.return_30d, withheld = returnWithoutWork(r, 4);
    assert.ok(withheld < rest, "the work should have delivered something by the last cycle");
    assert.ok(Math.abs(c.rest / rest - 1) < 5 * c.restSd && Math.abs(c.withheld / withheld - 1) < 5 * c.withheldSd, "readings are the truth plus the stated noise");
    assert.equal(t.estimate, c.rest / c.withheld - 1);
    assert.equal(t.verdict, "inconclusive");
  }
  // With nothing shipped there is no work to withhold: the cohort kept off it is the base itself.
  const idle = replay(sc, 3, [{}, {}, {}, {}]);
  assert.equal(returnWithoutWork(idle, 4), idle.reports[3]!.true.return_30d);
  assert.equal(returnWithoutWork(idle, 2), idle.reports[1]!.true.return_30d);
});

test("a holdout reads closer the more people and weeks stand behind each cohort, and the larger cohort reads closer", () => {
  const error = (samplePct: number, weeks: number): { rest: number; withheld: number } => {
    let rest = 0, withheld = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = replay(sc, seed, [{ start: ["application_tracker"] }, {}, {}, { experiments: [{ lever: "cohort_holdout", segment: "active_applicants", samplePct, weeks }] }]);
      const c = r.tests[0]!.cohorts!;
      rest += Math.abs(c.rest / r.reports[3]!.true.return_30d - 1);
      withheld += Math.abs(c.withheld / returnWithoutWork(r, 4) - 1);
    }
    return { rest: rest / 60, withheld: withheld / 60 };
  };
  const long = error(10, 6), short = error(10, 1), wide = error(50, 6);
  assert.ok(long.rest < short.rest / 1.5 && long.withheld < short.withheld / 1.5, "six weeks should read closer than one");
  assert.ok(long.rest < long.withheld, "the 90% arm should read closer than the 10% arm");
  assert.ok(wide.withheld < long.withheld, "a bigger withheld cohort should read the withheld arm closer");
});

test("a holdout is a test with good hygiene that judges nothing, and it uses a slot", () => {
  const r = play(1, { experiments: [{ lever: "cohort_holdout", segment: "active_applicants", samplePct: 50, weeks: 6 }] }, {});
  const level = (cycle: number, id: string) => r.scores[cycle - 1]!.traits.flatMap((t) => t.subs).find((s) => s.id === id)!.level;
  assert.equal(level(1, "test_hygiene"), "full");
  assert.equal(level(2, "acted_on_result"), "na");
  const e = { lever: "cohort_holdout", segment: "active_applicants", samplePct: 50, weeks: 6 };
  rejects(1, [{ experiments: [e, e, e] }], /too many experiments/);
  rejects(1, [{ start: ["cohort_holdout"] }], /not something you start/);
});

test("a precise holdout outweighs the dashboard in what the player believes about the final return rate", () => {
  let pooled = 0, dashboard = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = playRun(sc, seed, BOTS.insight_first!);
    const truth = r.reports[3]!.true.return_30d;
    pooled += Math.abs(believedEndgameWorld(r, 4).returnRate - truth);
    dashboard += Math.abs(r.reports[3]!.observed.return_30d! - truth);
  }
  assert.ok(pooled < dashboard / 2, `pooled error ${pooled / 60} against the dashboard's ${dashboard / 60}`);
});

test("the last cycle has a third experiment slot, because nothing is built there; every earlier cycle has two", () => {
  const e = (lever: string) => ({ lever, segment: "active_applicants", samplePct: 50, weeks: 6 });
  const three = [e("cohort_holdout"), e("subscription_offer"), e("fee_offer")];
  const r = play(1, {}, {}, {}, { experiments: three });
  assert.equal(r.tests.length, 3);
  assert.equal(experimentSlots(sc, 3), 2);
  assert.equal(experimentSlots(sc, 4), 3);
  for (const c of [1, 2, 3]) rejects(1, [...Array.from({ length: c - 1 }, () => ({})), { experiments: three }], /too many experiments/);
  rejects(1, [{}, {}, {}, { experiments: [...three, e("notification_policy")] }], /too many experiments/);
});

test("capacity put into a build that is stopped is not used, and once every backed bet is running idle capacity is not held against you", () => {
  const level = (r: ReturnType<typeof replay>, cycle: number) => r.scores[cycle - 1]!.traits.flatMap((x) => x.subs).find((s) => s.id === "capacity_used")!.level;
  const one = worldWhere({ backing: "one", scope: "both" }), three = worldWhere({ backing: "three", scope: "both" });
  const twoBuilds: Decision[] = [{ start: ["application_tracker", "peer_groups"] }, {}];
  // 7 of 8 sprints went into two builds, but leadership backs one: only the 3 on the first are used.
  assert.equal(level(replay(sc, one, twoBuilds), 1), "none");
  assert.equal(level(replay(sc, three, twoBuilds), 1), "full");
  // With the one backed bet running, an idle second cycle is not idleness; with room for a third it still is.
  assert.equal(level(replay(sc, one, twoBuilds), 2), "na");
  assert.equal(level(replay(sc, three, twoBuilds), 2), "none");
  // Pouring more into stopped builds is still spending on nothing.
  assert.equal(level(replay(sc, one, [twoBuilds[0]!, { start: ["course_partnerships"] }]), 2), "none");
  // Doing nothing is still doing nothing.
  assert.equal(level(replay(sc, one, [{}, {}]), 2), "none");
});

test("with one bet backed, a second build is stopped and a single bet is concentrated", () => {
  const one = worldWhere({ backing: "one", scope: "both" });
  const r = newRun(sc, one);
  assert.equal(maxBets(r), 1);
  playCycle(r, { start: ["application_tracker", "peer_groups"] });
  assert.ok(!blocked(r, leverOf(r, "application_tracker")) && blocked(r, leverOf(r, "peer_groups")));
  const conc = (w: ReturnType<typeof replay>) => w.scores[0]!.traits.flatMap((x) => x.subs).find((s) => s.id === "bets_concentrated")!;
  assert.equal(conc(replay(sc, one, [{ start: ["application_tracker"] }])).level, "full");
  assert.equal(conc(replay(sc, one, [{ start: ["application_tracker", "peer_groups"] }])).level, "part");
});
