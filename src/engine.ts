// Run lifecycle: create a run, validate and apply one cycle's decision, produce the report and the score.
import type { AnswerCase, Decision, EndgameResult, Experiment, HiddenVariable, NotifState, Reading, Run, Scenario, StatusNote, TestRecord } from "./types.ts";
import { baselineNotif, dialLever, instrLevel, lever as leverOf, leverScale, liveLever, notifLift, ceiling, observe, experimentSlots, spendOf, testable, trueMetrics, whyNot } from "./model.ts";
import { absorbed, endgameValue } from "./rules.ts";
import { scoreCycle } from "./score.ts";
import { normal, uniform } from "./rng.ts";
import { fillDerived, vary } from "./variation.ts";

export class DecisionError extends Error {}

const FIDELITY_RANK: Record<string, number> = { none: 0, noisy: 1, directional: 2, exact: 3 };

function pickEvent(sc: Scenario, seed: number): string {
  const pool = sc.events.pool;
  if (sc.events.selection === "fixed") return pool[0]!.id;
  const total = pool.reduce((t, e) => t + e.weight, 0);
  let r = uniform(seed, "event") * total;
  for (const e of pool) { r -= e.weight; if (r <= 0) return e.id; }
  return pool[pool.length - 1]!.id;
}

/** One of a case fact's options, by weight. `vary: false` takes the first, as written. */
function drawFact<T extends { id: string; weight: number }>(options: T[], seed: number, name: string, varied: boolean): T {
  if (!varied) return options[0]!;
  let r = uniform(seed, "fact", name) * options.reduce((t, o) => t + o.weight, 0);
  for (const o of options) { r -= o.weight; if (r <= 0) return o; }
  return options[options.length - 1]!;
}

/** A run in the world this seed draws. `vary: false` plays the scenario exactly as written. */
export function newRun(sc: Scenario, seed: number, opts: { vary?: boolean } = {}): Run {
  const varied = opts.vary !== false;
  const world = fillDerived(varied ? vary(sc, seed) : structuredClone(sc));
  const eventId = pickEvent(world, seed);
  return {
    sc: world, nominal: sc, seed, eventId, cycle: 1, done: false,
    started: {}, notif: [], asked: [], askedAt: {}, answers: {}, revealed: {}, tests: [], decisions: [], reports: [], scores: [],
    facts: { tracking: drawFact(world.case_facts.tracking, seed, "tracking", varied).id, scope: drawFact(world.case_facts.scope, seed, "scope", varied).id, backing: drawFact(world.case_facts.backing, seed, "backing", varied).id, threat: eventId },
    known: {}, mitigation: null, endgame: null, ranking: [],
  };
}

/** The player reads one answer: keep its text, and what it taught them about this case and the hidden variables it reveals. */
function hear(run: Run, qid: string, c: number): void {
  const q = run.sc.clarify.questions.find((x) => x.id === qid)!;
  const a: AnswerCase = typeof q.answer === "string" ? { text: q.answer } : q.answer.cases[run.facts[q.answer.by]!]!;
  run.answers[qid] = a.text;
  run.askedAt[qid] = c;
  Object.assign(run.known, a.learns);
  for (const h of q.reveals ?? []) reveal(run, h, { kind: "clarify", ref: qid }, c);
}

/** Ask clarifying questions before the first cycle, so the answers can shape the first decision. Later ones go in a cycle's decision. */
export function ask(run: Run, ids: string[]): void {
  const sc = run.sc;
  const fail = (m: string): never => { throw new DecisionError(`briefing: ${m}`); };
  if (run.decisions.length) fail("only before the first cycle");
  ids.forEach((q, i) => {
    if (!sc.clarify.questions.some((x) => x.id === q)) fail(`unknown question ${q}`);
    if (run.asked.includes(q) || ids.indexOf(q) !== i) fail(`question ${q} asked twice`);
  });
  if (run.asked.length + ids.length > sc.capacity.clarify_tokens) fail("out of clarifying questions");
  run.asked.push(...ids);
  for (const q of ids) hear(run, q, 0);
}

function validate(run: Run, d: Decision): void {
  const sc = run.sc, c = run.cycle;
  const fail = (m: string): never => { throw new DecisionError(`cycle ${c}: ${m}`); };
  if (run.done) fail("the run is finished");

  for (const q of d.clarify ?? []) {
    if (!sc.clarify.questions.some((x) => x.id === q)) fail(`unknown question ${q}`);
    if (run.asked.includes(q) || (d.clarify ?? []).indexOf(q) !== (d.clarify ?? []).lastIndexOf(q)) fail(`question ${q} asked twice`);
  }
  if (run.asked.length + (d.clarify ?? []).length > sc.capacity.clarify_tokens) fail("out of clarifying questions");

  if (d.focusSegment && !sc.segments.some((s) => s.id === d.focusSegment)) fail(`unknown segment ${d.focusSegment}`);

  const planned: string[] = [];
  for (const id of d.start ?? []) {
    const why = whyNot(run, id, c, planned);
    if (why) fail(why);
    planned.push(id);
  }
  // `started` is a plain object keyed by lever id, so an id like "__proto__" must not find the object's own prototype.
  for (const id of d.drop ?? []) if (!Object.hasOwn(run.started, id) || run.started[id]!.dropped !== undefined) fail(`cannot drop ${id}: it is not running`);

  const dial = dialLever(run);
  for (const [seg, n] of Object.entries(d.notifications ?? {})) {
    if (!sc.segments.some((s) => s.id === seg)) fail(`unknown segment ${seg}`);
    const [lo, hi] = dial.params!.volume_per_week_range as [number, number];
    if (!(n.volume >= lo && n.volume <= hi)) fail(`notification volume for ${seg} must be ${lo}-${hi}`);
    const tg = n.targeting ?? sc.engine.notification_baseline.targeting;
    if (!(dial.params!.targeting_options as string[]).includes(tg)) fail(`unknown targeting ${tg}`);
    if (tg === "preference_model" && !liveLever(run, "preference_targeting", c)) fail("preference targeting is not live");
  }

  const ab = sc.levers.find((l) => l.kind === "experiment")!;
  if ((d.experiments?.length ?? 0) > experimentSlots(sc, c)) fail("too many experiments");
  const [sLo, sHi] = ab.params!.sample_pct_range as [number, number];
  const [wLo, wHi] = ab.params!.weeks_range as [number, number];
  for (const e of d.experiments ?? []) {
    const l = sc.levers.find((x) => x.id === e.lever);
    if (!l) return fail(`unknown lever ${e.lever}`);
    if (!testable(l)) fail(`${e.lever} cannot be A/B tested`);
    if (!sc.segments.some((s) => s.id === e.segment)) fail(`unknown segment ${e.segment}`);
    if (!(e.samplePct >= sLo && e.samplePct <= sHi)) fail(`sample must be ${sLo}-${sHi}%`);
    if (!(e.weeks >= wLo && e.weeks <= wHi)) fail(`duration must be ${wLo}-${wHi} weeks`);
    if (l.kind === "dial") {
      const [lo, hi] = l.params!.volume_per_week_range as [number, number];
      if (e.volume === undefined || !Number.isFinite(e.volume) || e.volume < lo || e.volume > hi) fail(`notification test volume must be ${lo}-${hi}`);
      const targeting = e.targeting ?? sc.engine.notification_baseline.targeting;
      if (!(l.params!.targeting_options as string[]).includes(targeting)) fail(`unknown targeting ${targeting}`);
    }
  }

  for (const id of d.impactRanking ?? []) if (!sc.levers.some((l) => l.id === id)) fail(`unknown lever ${id} in ranking`);

  if (spendOf(sc, d) > sc.capacity.eng_sprints_per_cycle + 1e-9) fail(`over capacity: ${spendOf(sc, d)} of ${sc.capacity.eng_sprints_per_cycle} sprints`);

  if (d.endgame) {
    if (c !== sc.endgame.cycle) fail("the endgame decision belongs in the last cycle");
    if (!sc.endgame.options.some((o) => o.id === d.endgame!.option)) fail(`unknown endgame option ${d.endgame.option}`);
  }
}

type Source = { kind: "clarify" | "lever" | "event"; ref: string };

/** Keep only the parts of a per-segment map a source actually covers. */
const restrict = (truth: unknown, covers: string[] | "all"): unknown =>
  covers === "all" || !truth || typeof truth !== "object" || Array.isArray(truth) ? truth : Object.fromEntries(Object.entries(truth).filter(([k]) => covers.includes(k)));

/** Show a truth at a fidelity. Numbers get noise; a directional reading keeps only an order or a bucket. */
function fuzz(t: unknown, nominal: unknown, fidelity: string, sd: number, z: (path: string) => number, ratio: number, path: string): unknown {
  if (typeof t === "number") {
    const v = t * (1 + sd * z(path));
    if (fidelity === "noisy") return v;
    if (typeof nominal !== "number" || nominal <= 0) return { bucket: "typical" };
    return { bucket: v > nominal * ratio ? "above" : v < nominal / ratio ? "below" : "typical" };
  }
  if (t && typeof t === "object" && !Array.isArray(t)) {
    const entries = Object.entries(t as Record<string, unknown>);
    if (fidelity === "directional" && entries.length > 1 && entries.every(([, x]) => typeof x === "number")) {
      const seen = entries.map(([k, x]) => [k, (x as number) * (1 + sd * z(path + "/" + k))] as const);
      return { order: seen.sort((a, b) => b[1] - a[1]).map(([k]) => k) };
    }
    return Object.fromEntries(entries.map(([k, x]) => [k, fuzz(x, (nominal as Record<string, unknown> | undefined)?.[k], fidelity, sd, z, ratio, path + "/" + k)]));
  }
  return t;
}

function readingValue(run: Run, h: HiddenVariable, fidelity: string, sd: number, covers: string[] | "all", c: number, via: string): unknown {
  const truth = restrict(h.truth, covers);
  if (fidelity === "exact") return structuredClone(truth);
  const nominal = restrict(run.nominal.hidden_variables.find((x) => x.id === h.id)?.truth, covers);
  return fuzz(truth, nominal, fidelity, sd, (p) => normal(run.seed, "reveal", h.id, via, c, p), run.sc.engine.reveal.bucket_ratio, "");
}

/** Show the player a hidden variable, at the fidelity this source gives, and keep the reading. */
function reveal(run: Run, hiddenId: string, via: Source, c: number, opts: { covers?: string[] | "all"; sdScale?: number } = {}): Reading | undefined {
  const h = run.sc.hidden_variables.find((x) => x.id === hiddenId);
  if (!h) return undefined;
  const fidelity = h.reveal.via.find((v) => v.kind === via.kind && v.ref === via.ref)?.fidelity ?? h.reveal.fidelity;
  if (fidelity === "none") return undefined;
  const e = run.sc.engine.reveal;
  const sd = fidelity === "exact" ? 0 : (fidelity === "noisy" ? e.noisy_sd : e.directional_sd) * (opts.sdScale ?? 1);
  const covers = opts.covers ?? "all";
  const reading: Reading = { cycle: c, via: via.ref, fidelity, sd, covers, value: readingValue(run, h, fidelity, sd, covers, c, via.ref) };
  const cur = run.revealed[hiddenId];
  if (!cur) run.revealed[hiddenId] = { fidelity, cycle: c, via: via.ref, readings: [reading] };
  else {
    cur.readings.push(reading);
    if (FIDELITY_RANK[fidelity]! > FIDELITY_RANK[cur.fidelity]!) cur.fidelity = fidelity;
  }
  return reading;
}

/** The number a reading gives for one segment, or the number itself if the thing is one number for everyone. */
const measuredFor = (value: unknown, segment: string): number => {
  const v = typeof value === "number" ? value : (value as Record<string, unknown> | undefined)?.[segment];
  return typeof v === "number" ? v : 0;
};

function runTest(run: Run, c: number, idx: number, e: Experiment): TestRecord {
  const m = run.sc.measurement.experiment;
  const eng = run.sc.engine;
  let sd = m.base_noise_sd * Math.sqrt((m.min_sample_pct * m.min_weeks) / (e.samplePct * e.weeks));
  if (e.stoppedEarly) sd = Math.hypot(sd, m.peek_penalty_sd);
  const l = leverOf(run, e.lever);
  const rec: TestRecord = { cycle: c, lever: e.lever, segment: e.segment, samplePct: e.samplePct, weeks: e.weeks, stoppedEarly: !!e.stoppedEarly, sd, estimate: 0, verdict: "inconclusive" };

  if (l.kind === "dial") {
    const st = { volume: e.volume!, targeting: e.targeting ?? eng.notification_baseline.targeting };
    const lift = eng.notif_return_per_session_lift * notifLift(run, e.segment, st);
    const slope = dialLever(run).params!.model.opt_out_abs_per_notification_over_ceiling as number;
    rec.volume = e.volume;
    rec.estimate = lift + sd * normal(run.seed, "test", c, idx);
    rec.optOutEstimate = slope * Math.max(0, st.volume - ceiling(run, e.segment)) + 0.25 * sd * normal(run.seed, "test_opt", c, idx);
    rec.verdict = rec.optOutEstimate >= eng.guardrail_breach_abs ? "loss" : rec.estimate >= eng.test_ship_threshold ? "win" : rec.estimate < eng.test_kill_threshold ? "loss" : "inconclusive";
  } else if (l.kind === "offer" || l.kind === "holdout") {
    rec.estimate = 0; // a pricing test or a holdout judges nothing; what it measured is filled in once the cycle's state exists
  } else {
    rec.estimate = (l.effects?.[e.segment]?.return_30d_rel ?? 0) * leverScale(run, l, c, true) + sd * normal(run.seed, "test", c, idx);
    rec.verdict = rec.estimate >= eng.test_ship_threshold ? "win" : rec.estimate < eng.test_kill_threshold ? "loss" : "inconclusive";
  }
  return rec;
}

/** The 30-day return a user kept off all of the player's work has in cycle c: no lever live, today's notifications, the event as that state absorbs it. */
export function returnWithoutWork(run: Run, c: number): number {
  const bare: Run = { ...run, started: {}, notif: run.notif.map(() => baselineNotif(run.sc)), mitigation: null };
  if (c >= run.sc.events.cycle) bare.mitigation = absorbed(bare, run.sc.events.cycle);
  return trueMetrics(bare, c).return_30d;
}

/**
 * A cohort holdout reads the 30-day return of the sample kept off the quarter's work and of everyone else, as cohort
 * counts: the metric's own noise share, shrinking with the people and weeks behind each count (the larger arm reads closer).
 */
function readCohorts(run: Run, c: number, idx: number, t: TestRecord, rest: number): void {
  const m = run.sc.measurement.experiment;
  const share = run.sc.metrics.find((x) => x.id === "return_30d")?.noise_scale ?? 1;
  const armSd = (pct: number): number => {
    const sd = m.base_noise_sd * share * Math.sqrt((m.min_sample_pct * m.min_weeks) / (pct * t.weeks));
    return t.stoppedEarly ? Math.hypot(sd, m.peek_penalty_sd * share) : sd;
  };
  const restSd = armSd(100 - t.samplePct), withheldSd = armSd(t.samplePct);
  const seen = (truth: number, sd: number, arm: string): number => truth * (1 + sd * normal(run.seed, "holdout", c, idx, arm));
  t.cohorts = { rest: seen(rest, restSd, "rest"), restSd, withheld: seen(returnWithoutWork(run, c), withheldSd, "withheld"), withheldSd };
  t.estimate = t.cohorts.rest / t.cohorts.withheld - 1;
  t.sd = Math.hypot(restSd, withheldSd);
}

export function playCycle(run: Run, d: Decision) {
  validate(run, d);
  const sc = run.sc, c = run.cycle;

  run.asked.push(...(d.clarify ?? []));
  for (const id of d.start ?? []) run.started[id] = { cycle: c, liveFrom: c + leverOf(run, id).lead_cycles };
  for (const id of d.drop ?? []) run.started[id]!.dropped = c;

  const state: NotifState = structuredClone(run.notif[c - 2] ?? baselineNotif(sc));
  for (const [seg, n] of Object.entries(d.notifications ?? {})) state[seg] = { volume: n.volume, targeting: n.targeting ?? state[seg]!.targeting };
  run.notif.push(state);
  if (d.impactRanking) run.ranking = [...d.impactRanking];
  run.decisions.push(d);

  for (const id of d.start ?? []) {
    const l = leverOf(run, id);
    if (l.kind === "research") for (const h of l.reveals_hidden ?? []) reveal(run, h, { kind: "lever", ref: id }, c, { covers: (l.params?.covers_segments as string[] | "all" | undefined) ?? "all" });
  }
  for (const q of d.clarify ?? []) hear(run, q, c);

  const tests = (d.experiments ?? []).map((e, i) => runTest(run, c, i, e));
  const abTest = sc.levers.find((l) => l.kind === "experiment")!.id;
  for (const t of tests) for (const h of sc.engine.test_reveals[t.lever] ?? []) {
    const r = reveal(run, h, { kind: "lever", ref: abTest }, c, { covers: [t.segment], sdScale: t.sd / sc.measurement.experiment.base_noise_sd });
    if (r && leverOf(run, t.lever).kind === "offer") t.estimate = measuredFor(r.value, t.segment);
  }
  run.tests.push(...tests);

  if (c === sc.events.cycle) run.mitigation = absorbed(run, c);

  const truth = trueMetrics(run, c);
  tests.forEach((t, i) => { if (leverOf(run, t.lever).kind === "holdout") readCohorts(run, c, i, t, truth.return_30d); });
  const report = {
    cycle: c,
    spent: spendOf(sc, d),
    instrumentationLevel: instrLevel(run, c),
    true: truth,
    observed: observe(run, c, truth),
    tests,
    eventActive: c >= sc.events.cycle ? run.eventId : null,
  };
  run.reports.push(report);

  if (c === sc.endgame.cycle && d.endgame) run.endgame = computeEndgame(run, c, d.endgame.option, d.endgame.reasoning ?? "");

  const score = scoreCycle(run, c);
  run.scores.push(score);
  run.cycle++;
  run.done = c === sc.timeline.cycles;
  return { report, score };
}

/**
 * The review after the last cycle: with the final report in hand, choose how to monetise. This is for a player
 * who did not choose in the last decision, which has to be made before that cycle's results exist. The last
 * cycle is scored again with the choice, and the status note may be written now, as it would be at a review.
 */
export function chooseEndgame(run: Run, choice: { option: string; reasoning?: string; status?: StatusNote }): void {
  const sc = run.sc, c = sc.endgame.cycle;
  const fail = (m: string): never => { throw new DecisionError(`review: ${m}`); };
  if (!run.done || run.cycle <= c) fail("the last cycle has not been played");
  if (run.endgame) fail("the monetisation choice was already made");
  if (!sc.endgame.options.some((o) => o.id === choice.option)) fail(`unknown option ${choice.option}`);
  run.endgame = computeEndgame(run, c, choice.option, choice.reasoning ?? "");
  const d = run.decisions[c - 1]!;
  run.decisions[c - 1] = { ...d, endgame: { option: choice.option, reasoning: choice.reasoning }, status: choice.status ?? d.status };
  run.scores[c - 1] = scoreCycle(run, c);
}

function computeEndgame(run: Run, c: number, option: string, reasoning: string): EndgameResult {
  const values: Record<string, number> = {};
  for (const o of run.sc.endgame.options) values[o.id] = endgameValue(run, o.value_model.params, c);
  const best = Math.max(...Object.values(values));
  return { option, reasoning, values, best, ratio: best > 0 ? values[option]! / best : 1 };
}
