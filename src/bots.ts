// Calibration bots. Each is a policy, not a player: scripted behaviour that stands for a kind of play,
// used to check that the rubric separates good play from bad. A bot only ever sees what a player could
// (the run state before the cycle), and the engine rejects any decision a player could not make.
//
// A bot knows no case. Everything about one (which lever is session analytics, what the textbook plan builds, what
// the answer key says) is in the scenario's `calibration.playbook`, so a new case brings its own bots' scripts.
import type { Decision, Experiment, InsightTest, Playbook, Run, StatusNote } from "./types.ts";
import { dialLever, lever as leverOf, spendOf, testable, whyNot } from "./model.ts";
import { endgameValue } from "./rules.ts";
import { believedBets, believedEndgameWorld, believedStages, overallRanking, responseOrder, safeVolumes } from "./beliefs.ts";
import { stream, uniform } from "./rng.ts";

/**
 * A bot that reads answers also has `ask`: called before the first cycle until it returns nothing. One that wants
 * the final report before it chooses how to monetise has `review`, called after the last cycle; it then leaves the
 * choice out of its last decision, which has to be made before those results exist.
 */
export type Bot = ((run: Run) => Decision) & {
  ask?: (run: Run) => string[];
  review?: (run: Run) => { option: string; reasoning: string; status: StatusNote };
};

const playbook = (run: Run): Playbook => {
  const pb = run.sc.calibration.playbook;
  if (!pb) throw new Error(`${run.sc.id} has no calibration.playbook, so the scripted bots cannot play it`);
  return pb;
};

const STOCK = { hypothesis: "People need a reason to come back.", bet: "Ship the highest-impact lever for the focus segment.", expected_movement: "A small rise in the return rate.", risk: "The effect is smaller than hoped." };
/** What a player would write as their bet: a plain description of what this decision actually does. */
function bet(run: Run, d: Decision): string {
  const nm = (id: string): string => leverOf(run, id).name;
  const parts: string[] = [];
  if (d.start?.length) parts.push(`start ${d.start.map(nm).join(", ")}`);
  if (d.experiments?.length) parts.push(`test ${d.experiments.map((e) => nm(e.lever)).join(", ")}`);
  if (d.notifications && Object.keys(d.notifications).length) parts.push(`set the ${dialLever(run).name.toLowerCase()}`);
  if (d.drop?.length) parts.push(`drop ${d.drop.map(nm).join(", ")}`);
  if (d.endgame) parts.push(`choose ${run.sc.endgame.options.find((o) => o.id === d.endgame!.option)!.name}`);
  return parts.length ? `This cycle we ${parts.join("; ")}.` : STOCK.bet;
}
/** What a player who has seen the evidence would name as the cause: they learn it the cycle they run the analysis that shows it. */
function diagnosis(run: Run, d: Decision): string {
  const g = playbook(run).diagnosis;
  return run.revealed[g.variable] || d.start?.includes(g.lever) ? g.cause : g.unknown;
}
const finish = (run: Run, d: Decision): Decision => { if (d.status) d.status = { ...d.status, bet: bet(run, d) }; return d; };

/** A briefing that reads as it goes: the first answer says where this quarter's worry lies, so the sixth question follows it. */
const briefAsk = (run: Run): string[] => {
  const b = playbook(run).brief;
  return !run.asked.length ? [b.first] : run.asked.length === 1 ? [...b.then, run.known.watch ?? b.fallback] : [];
};

/** A segment a script names, or a token for the one the brief points to: \`$post_first\` or \`$during_first\`. */
function segmentOf(run: Run, name: string): string {
  const f = playbook(run).focus, stages = believedStages(run);
  if (name === "$post_first") return stages.includes(f.post_stage) ? f.post : f.during;
  if (name === "$during_first") return stages.includes(f.during_stage) ? f.during : f.post;
  return name;
}

/** Start these levers, in order, skipping any that are blocked, would overflow capacity, or would be more builds than `bets` allows in all. */
function starts(run: Run, wanted: string[], reserved = 0, bets = Infinity): string[] {
  const cap = run.sc.capacity.eng_sprints_per_cycle;
  const out: string[] = [];
  let used = reserved;
  let builds = Object.keys(run.started).filter((id) => leverOf(run, id).kind === "build").length;
  for (const id of wanted) {
    if (whyNot(run, id, run.cycle, out)) continue;
    const l = leverOf(run, id);
    if (l.kind === "build" && builds >= bets) continue;
    const cost = l.cost_sprints;
    if (used + cost > cap + 1e-9) continue;
    out.push(id);
    used += cost;
    if (l.kind === "build") builds++;
  }
  return out;
}

/** The sample and duration a test may have, as the experiment platform allows them in this case. */
const testRanges = (run: Run): { sample: [number, number]; weeks: [number, number] } => {
  const p = run.sc.levers.find((l) => l.kind === "experiment")!.params!;
  return { sample: p.sample_pct_range as [number, number], weeks: p.weeks_range as [number, number] };
};
/** A test at the largest sample and the longest run the platform allows, unless the script says otherwise. */
const testOf = (run: Run, t: InsightTest): Experiment => {
  const { lever, segment, ...rest } = t;
  const r = testRanges(run);
  return { lever, segment: segmentOf(run, segment), samplePct: r.sample[1], weeks: r.weeks[1], ...rest };
};

/**
 * A fixed plan for a bot with no judgement: the same fields every cycle (\`base\`) and what to do in each cycle. The levers it
 * wants are started in order, skipping any that would not fit what the rest of the decision already spends.
 */
function scripted(run: Run, s: { base: Decision; cycles: Decision[] }, adjust?: (d: Decision) => void): Decision {
  const d: Decision = { ...structuredClone(s.base), ...structuredClone(s.cycles[run.cycle - 1] ?? {}), status: STOCK };
  if (d.focusSegment) d.focusSegment = segmentOf(run, d.focusSegment);
  adjust?.(d);
  if (d.start) { const wanted = d.start; delete d.start; d.start = starts(run, wanted, spendOf(run.sc, d)); }
  return d;
}

// ---------- the bots ----------

/** Submits nothing, ever. */
export const do_nothing: Bot = () => ({});

/** Fills every form field with an arbitrary answer and a stock sentence, but commits nothing. */
export const lazy_filler: Bot = (run) => {
  const pick = (id: string): string => {
    const o = run.sc.reflection.prompts.find((p) => p.id === id)!.options!;
    return o[Math.floor(uniform(run.seed, "lazy", run.cycle, id) * o.length)]!.id;
  };
  return {
    reflection: { root_cause: pick("root_cause"), primary_metric: pick("primary_metric"), guardrail_metric: pick("guardrail_metric"), expected_movement: pick("expected_movement") },
    status: STOCK,
  };
};

/** Picks anything valid at random. A floor for what chance alone produces. */
export const random_valid: Bot = (run) => {
  const c = run.cycle, sc = run.sc;
  const rnd = stream(run.seed, "bot_random", c);
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
  const shuffle = <T,>(a: T[]): T[] => a.map((v) => [rnd(), v] as const).sort((x, y) => x[0] - y[0]).map((p) => p[1]);
  const d: Decision = {};

  if (c === 1) d.clarify = shuffle(sc.clarify.questions.map((q) => q.id)).slice(0, sc.capacity.clarify_tokens);
  if (c === 1 || rnd() < 0.3) d.focusSegment = pick(sc.segments).id;

  if (rnd() < 0.5) {
    d.notifications = Object.fromEntries(sc.segments.map((s) => [s.id, { volume: Math.round(rnd() * 100) / 10, targeting: pick(["broadcast", "rules"] as const) }]));
  }
  const options = sc.levers.filter(testable);
  const r = testRanges(run);
  const nTests = Math.floor(rnd() * 3);
  d.experiments = Array.from({ length: nTests }, () => {
    const l = pick(options);
    const seg = pick(sc.segments).id;
    return { lever: l.id, segment: seg, samplePct: r.sample[0] + Math.floor(rnd() * (r.sample[1] - r.sample[0] + 1)), weeks: r.weeks[0] + Math.floor(rnd() * (r.weeks[1] - r.weeks[0] + 1)), stoppedEarly: rnd() < 0.3, ...(l.kind === "dial" ? { volume: Math.round(rnd() * 100) / 10 } : {}) };
  });
  let reserved = spendOf(sc, d);
  if (reserved > sc.capacity.eng_sprints_per_cycle) { delete d.notifications; d.experiments = []; reserved = 0; }
  const startable = sc.levers.filter((l) => ["build", "foundation", "research"].includes(l.kind)).map((l) => l.id);
  d.start = starts(run, shuffle(startable).slice(0, 1 + Math.floor(rnd() * 5)), reserved);

  const rankable = sc.levers.filter((l) => l.kind === "build" && l.effects).map((l) => l.id);
  d.impactRanking = shuffle(rankable).slice(0, 3 + Math.floor(rnd() * 3));
  const opt = (id: string): string => pick(sc.reflection.prompts.find((p) => p.id === id)!.options!).id;
  d.reflection = { root_cause: opt("root_cause"), primary_metric: opt("primary_metric"), guardrail_metric: opt("guardrail_metric"), expected_movement: opt("expected_movement") };
  d.status = Object.fromEntries(Object.entries(STOCK).filter(() => rnd() < 0.6));
  if (c === sc.endgame.cycle) d.endgame = { option: pick(sc.endgame.options).id, reasoning: "gut feel" };
  if (d.status?.bet) d.status.bet = bet(run, d);
  return d;
};

/** Pushes notification volume to the maximum for everyone and builds nothing. */
export const notification_spammer: Bot = (run) =>
  finish(run, scripted(run, playbook(run).scripts.notification_spammer, (d) => {
    const top = dialLever(run).params!.volume_per_week_range[1] as number;
    d.notifications = Object.fromEntries(run.sc.segments.map((s) => [s.id, { volume: top, targeting: "broadcast" as const }]));
  }));

/** Follows a textbook structure (use case, frequency, intensity) without looking at the data. */
export const framework_first: Bot = (run) => finish(run, scripted(run, playbook(run).scripts.framework_first));

/** Measures and tests carefully, learns the answer, and never ships anything user-facing. */
export const cautious_researcher: Bot = Object.assign((run: Run): Decision => {
  const s = playbook(run).scripts.cautious_researcher;
  const tracked = run.known.tracking === "sessions"; // the briefing said the company already logs sessions
  const d = scripted(run, tracked ? s.tracked : s.untracked);
  d.reflection!.root_cause = diagnosis(run, d);
  return finish(run, d);
}, { ask: briefAsk });

/** The monetisation call, made on the final report: what each option is worth on what was measured and asked. */
function insightReview(run: Run): { option: string; reasoning: string; status: StatusNote } {
  const world = believedEndgameWorld(run, run.sc.endgame.cycle);
  const worth = run.sc.endgame.options.map((o) => ({ id: o.id, name: o.name, v: endgameValue(run, o.value_model.params, run.sc.endgame.cycle, world) })).sort((a, b) => b.v - a.v);
  const option = worth[0]!;
  return {
    option: option.id,
    reasoning: "On what I measured, " + option.name + " is worth the most: what each segment would pay, the attribution gap and the retention I saw in the final report.",
    status: { ...STOCK, bet: bet(run, { endgame: { option: option.id } }) },
  };
}

/**
 * Briefs first and reads the answers: whether the company already logs sessions, which stages this quarter's
 * brief covers, and which question the quarter's worry points to. Then instruments (or not), finds the real cause,
 * and acts on the values its research returned: notification volumes from its own fatigue estimates, builds from
 * what each segment responds to, the ranking from those same readings, preparation for the threat it was told of,
 * and the endgame from what it believes each option is worth.
 */
const insight = (allocation: "focus" | "reach"): Bot => Object.assign((run: Run): Decision => {
  const c = run.cycle;
  const pb = playbook(run), p = pb.insight;
  const stages = believedStages(run);
  const tracked = run.known.tracking === "sessions";
  const FOCUS = segmentOf(run, "$post_first");
  const reachable = (id: string): boolean => leverOf(run, id).stages.some((s) => stages.includes(s));
  const allBuilds = run.sc.levers.filter((l) => l.kind === "build" && l.effects).map((l) => l.id);
  const buildable = allBuilds.filter(reachable);
  const margin = p.margins.by_threat[run.known.threat ?? ""] ?? p.margins.default; // told the provider is flaky: stay well under the limit
  const d: Decision = {
    reflection: { root_cause: "need_more_data", primary_metric: "return_30d", guardrail_metric: "notif_opt_out", expected_movement: c === 1 ? "flat" : "up_small" },
    status: STOCK,
  };
  if (c > 1) d.impactRanking = [...overallRanking(run, buildable), ...allBuilds.filter((id) => !buildable.includes(id))];
  // Where to put build capacity: on what the focus segment responds to, or on what pays across all users (each segment's order, weighted by its share).
  const bestBuilds = (): string[] => (allocation === "reach" ? overallRanking(run, buildable) : (responseOrder(run, FOCUS) ?? []).filter((l) => buildable.includes(l)));
  const prepare = (p.prepare[run.known.threat ?? ""] ?? []).filter(reachable);
  const bets = believedBets(run); // how many builds leadership will back, once the answer has said

  if (c === 1) {
    d.focusSegment = FOCUS;
    d.experiments = p.first_cycle_tests.map((t) => testOf(run, t));
    d.start = starts(run, [tracked ? p.pipeline : p.basic_tracking, p.analytics, ...p.research], spendOf(run.sc, d));
  } else if (c === 2) {
    d.notifications = safeVolumes(run, margin);
    d.experiments = p.second_cycle_tests.map((t) => testOf(run, t));
    const best = [...new Set([...prepare, ...bestBuilds()])].filter((l) => !whyNot(run, l, c)).slice(0, 2);
    if (run.revealed[p.finding_adds.variable] && !best.includes(p.finding_adds.build) && reachable(p.finding_adds.build)) best.push(p.finding_adds.build); // analytics found what the build fixes
    d.start = starts(run, best.filter((l) => l !== p.gated_build), spendOf(run.sc, d), bets); // the gated build waits for its own test
  } else if (c === 3) {
    d.notifications = safeVolumes(run, margin);
    // With only so many bets to back, the best-ranked come first; with no limit the cheap in-session bet leads, as before.
    const picks = bets < Infinity ? bestBuilds() : [p.cheap_leader, ...bestBuilds().slice(0, 3)];
    const wanted = [p.pipeline, ...picks].filter((id) => leverOf(run, id).kind !== "build" || reachable(id));
    if (run.tests.filter((t) => t.lever === p.gated_build && t.segment === FOCUS).at(-1)?.verdict === "win") wanted.push(p.gated_build);
    d.start = starts(run, wanted, spendOf(run.sc, d), bets);
  } else {
    // The last cycle has nothing left to start, so its capacity is free (a test in an earlier cycle can cost a bet).
    // Three slots, read at the review with the final report. The first goes to the number the staying-free call rests on,
    // the retention the whole base ends with: a holdout of 10% (the smallest sample that counts as a sound test) for the
    // longest run. The second prices the subscription where most of the payers are, the third the fee.
    d.experiments = p.last_cycle_tests.map((t) => testOf(run, t));
  }
  d.reflection!.root_cause = diagnosis(run, d);
  return finish(run, d);
}, { ask: briefAsk, review: insightReview });

export const insight_first = insight("focus");
/** The same, but builds are chosen for total reach across all segments, not for the focus segment alone. */
export const insight_by_reach = insight("reach");

/** Has read the answer key: every correct reflection answer from cycle 1, no research behind any of them. */
export const answer_key_guesser: Bot = (run) => finish(run, scripted(run, playbook(run).scripts.answer_key_guesser));

export const BOTS: Record<string, Bot> = { do_nothing, lazy_filler, random_valid, notification_spammer, framework_first, cautious_researcher, answer_key_guesser, insight_first, insight_by_reach };
