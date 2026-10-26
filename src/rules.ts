// The rule catalogue: every `fn` a scenario file can name. Each is a pure function of the run so far.
// `c` is the cycle being scored (1-based); a rule may only look at cycles <= c.
//
// Two policies run through all of them:
//  * A sub-criterion is `none` unless the player did something that earns it. Doing nothing never scores.
//  * `na` means the question cannot be asked yet (no builds to judge, event not reached). It is excluded
//    from the denominator, never rewarded.
import type { Backing, Decision, Level, Lever, Params, Run, TestRecord } from "./types.ts";
import { baseInstrLevel, baselineOptOut, baselineReturn, blocked, ceiling, combine, hiddenTruth, instrLevel, leverScale, liveLever, maxBets, outOfScope, scopeStages, whyNot } from "./model.ts";
import { lever as leverOf, spendOf } from "./model.ts";

export interface Ctx { run: Run; c: number }
export interface SubResult { level: Level; f: Record<string, string | number>; text?: string }
type SubFn = (x: Ctx, p: Params) => SubResult;
type BoolFn = (x: Ctx, p: Params) => boolean;

const R = (level: Level, f: Record<string, string | number> = {}, text?: string): SubResult => ({ level, f, text });
const pct = (v: number): string => `${Math.round(v * 100)}%`;

// ---------- shared facts ----------

const decisionsTo = (x: Ctx): Decision[] => x.run.decisions.slice(0, x.c);
const decisionAt = (x: Ctx, cycle: number): Decision | undefined => x.run.decisions[cycle - 1];

/** Whether, by cycle c, the player had learned from any of these sources. */
export function learnedFrom(x: Ctx, sources: Backing[]): boolean {
  return sources.some((s) =>
    "clarify" in s ? (x.run.askedAt[s.clarify] ?? Infinity) <= x.c : (x.run.revealed[s.reading]?.readings ?? []).some((r) => r.cycle <= x.c),
  );
}

function lastDefined<T>(vals: (T | undefined)[]): { v: T; cycle: number } | undefined {
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== undefined && vals[i] !== "") return { v: vals[i] as T, cycle: i + 1 };
  return undefined;
}
function firstDefined<T>(vals: (T | undefined)[]): { v: T; cycle: number } | undefined {
  for (let i = 0; i < vals.length; i++) if (vals[i] !== undefined && vals[i] !== "") return { v: vals[i] as T, cycle: i + 1 };
  return undefined;
}

interface Started { id: string; l: Lever; cycle: number; dropped?: number }
const started = (x: Ctx, kinds?: Lever["kind"][]): Started[] =>
  Object.entries(x.run.started)
    .map(([id, s]) => ({ id, l: leverOf(x.run, id), cycle: s.cycle, dropped: s.dropped }))
    .filter((s) => s.cycle <= x.c && (!kinds || kinds.includes(s.l.kind)));

const nominalImpact = (run: Run, l: Lever): number => outOfScope(run, l) ? 0 : run.sc.segments.reduce((t, s) => t + s.share * (l.effects?.[s.id]?.return_30d_rel ?? 0), 0);
const primarySegment = (l: Lever): string => Object.entries(l.effects ?? {}).sort((a, b) => (b[1].return_30d_rel ?? 0) - (a[1].return_30d_rel ?? 0))[0]?.[0] ?? "";

function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(v.length).fill(0);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a), rb = ranks(b), n = a.length;
  const ma = ra.reduce((t, v) => t + v, 0) / n, mb = rb.reduce((t, v) => t + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i]! - ma) * (rb[i]! - mb); da += (ra[i]! - ma) ** 2; db += (rb[i]! - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function movementClass(delta: number, th: { flat_below: number; small_below: number }, tol: number): string {
  const flat = th.flat_below * (1 + tol), small = th.small_below * (1 + tol);
  if (delta < -flat) return "down";
  if (delta < flat) return "flat";
  if (delta < small) return "up_small";
  return "up_large";
}

/** Actual change in the 30-day return rate over cycle t, as a relative change. */
function returnDelta(run: Run, t: number): number {
  const prev = t === 1 ? baselineReturn(run) : run.reports[t - 2]!.true.return_30d;
  return (run.reports[t - 1]!.true.return_30d - prev) / prev;
}
const expectationMatched = (x: Ctx, t: number, tol: number): boolean => {
  const exp = decisionAt(x, t)?.reflection?.expected_movement;
  return !!exp && exp === movementClass(returnDelta(x.run, t), x.run.sc.engine.movement_thresholds, tol);
};

/** When each named risky lever was first rolled out (built, or the dial deliberately moved off baseline). */
function rollouts(x: Ctx, ids: string[]): { id: string; cycle: number }[] {
  const out: { id: string; cycle: number }[] = [];
  const base = x.run.sc.engine.notification_baseline;
  for (const id of ids) {
    const l = leverOf(x.run, id);
    if (l.kind === "dial") {
      const dec = decisionsTo(x);
      const i = dec.findIndex((d) => Object.entries(d.notifications ?? {}).some(([s, n]) => n.volume !== base.volume[s] || (n.targeting ?? base.targeting) !== base.targeting));
      if (i >= 0) out.push({ id, cycle: i + 1 });
    } else if (x.run.started[id] && x.run.started[id]!.cycle <= x.c) out.push({ id, cycle: x.run.started[id]!.cycle });
  }
  return out;
}
/** Lowercase names and ids of everything a decision acts on: levers started, tested, dropped, the dial, the endgame choice. */
export function actionNames(run: Run, d: Decision): string[] {
  const ids = [...(d.start ?? []), ...(d.drop ?? []), ...(d.experiments ?? []).map((e) => e.lever)];
  if (d.notifications && Object.keys(d.notifications).length) ids.push(run.sc.levers.find((l) => l.kind === "dial")!.id);
  const out = ids.flatMap((id) => { const l = leverOf(run, id); return [l.name.toLowerCase(), id.replace(/_/g, " ")]; });
  if (d.endgame) { const o = run.sc.endgame.options.find((x) => x.id === d.endgame!.option); if (o) out.push(o.name.toLowerCase(), o.id.replace(/_/g, " ")); }
  return out;
}
const testedBefore = (run: Run, id: string, cycle: number): boolean => run.tests.some((t) => t.lever === id && t.cycle < cycle);

function actedOn(x: Ctx, t: TestRecord): boolean {
  const l = leverOf(x.run, t.lever);
  if (l.kind === "dial") {
    const later = x.run.decisions.slice(t.cycle, x.c).flatMap((d) => (d.notifications?.[t.segment] ? [d.notifications[t.segment]!.volume] : []));
    return t.verdict === "win" ? later.length > 0 : later.every((v) => v < (t.volume ?? Infinity));
  }
  const s = x.run.started[t.lever];
  return t.verdict === "win" ? !!s && s.dropped === undefined : !s || s.dropped !== undefined;
}

// ---------- what the builds deliver over the run, in this world ----------

const buildsOf = (run: Run): Lever[] => run.sc.levers.filter((l) => l.kind === "build" && l.effects);

/** Reach-weighted relative lift in 30-day return that the builds live in cycle t deliver in this world. */
function buildLift(run: Run, t: number): number {
  let total = 0;
  for (const s of run.sc.segments) {
    const parts: number[] = [];
    for (const l of buildsOf(run)) {
      const eff = l.effects![s.id]?.return_30d_rel;
      const k = eff ? leverScale(run, l, t) : 0;
      if (k) parts.push(eff! * k);
    }
    total += s.share * combine(parts);
  }
  return total;
}

/** Lift summed over every cycle of the run, so a lever that starts earlier delivers more of it. */
const runLift = (run: Run): number => { let sum = 0; for (let t = 1; t <= run.sc.timeline.cycles; t++) sum += buildLift(run, t); return sum; };

export interface Placement { id: string; cycle: number }
export interface Delivered { share: number; best: Placement[]; budget: number }

/**
 * The lift the builds started so far deliver over the run, as a share of the best that could have been
 * delivered: the best choice of builds and of the cycle each one starts in, given the capacity the player
 * left for building in every cycle (what they spent on research, tracking, the dial and tests stays fixed).
 * Builds that never go live, or were dropped, cost capacity and deliver less.
 */
export function deliveredShare(run: Run, c: number): Delivered | null {
  const sc = run.sc, N = sc.timeline.cycles, cap = sc.capacity.eng_sprints_per_cycle;
  const options = buildsOf(run);
  const isBuild = (id: string): boolean => options.some((l) => l.id === id);
  const kept = Object.fromEntries(Object.entries(run.started).filter(([, s]) => s.cycle <= c));
  if (!Object.keys(kept).some(isBuild)) return null;
  const other = Object.fromEntries(Object.entries(kept).filter(([id]) => !isBuild(id)));

  const last = Math.min(c, N - 1); // nothing started in the last cycle can go live
  const room: number[] = [];
  for (let t = 1; t <= last; t++) {
    const d = run.decisions[t - 1]!;
    const onBuilds = (d.start ?? []).filter(isBuild).reduce((a, id) => a + leverOf(run, id).cost_sprints, 0);
    room.push(cap - spendOf(sc, d) + onBuilds);
  }

  const lift = (plan: Placement[]): number | null => {
    const started = { ...other };
    const probe: Run = { ...run, started };
    for (let t = 1; t <= last; t++) {
      const now = plan.filter((p) => p.cycle === t);
      const planned: string[] = [];
      for (const p of now) { if (whyNot(probe, p.id, t, planned)) return null; planned.push(p.id); }
      for (const p of now) started[p.id] = { cycle: t, liveFrom: t + leverOf(run, p.id).lead_cycles };
    }
    return runLift(probe);
  };

  let best: Placement[] = [], bestLift = 0, bestCost = Infinity;
  const used = room.map(() => 0);
  const walk = (i: number, plan: Placement[]): void => {
    if (i === options.length) {
      const v = lift(plan);
      if (v === null) return;
      const cost = plan.reduce((a, p) => a + leverOf(run, p.id).cost_sprints, 0);
      if (v > bestLift + 1e-12 || (Math.abs(v - bestLift) <= 1e-12 && cost < bestCost)) { best = plan; bestLift = v; bestCost = cost; }
      return;
    }
    walk(i + 1, plan);
    if (plan.length >= maxBets(run)) return; // leadership backs only so many bets
    const l = options[i]!;
    for (let t = 1; t <= last; t++) {
      if (used[t - 1]! + l.cost_sprints > room[t - 1]! + 1e-9) continue;
      used[t - 1] = used[t - 1]! + l.cost_sprints;
      walk(i + 1, [...plan, { id: l.id, cycle: t }]);
      used[t - 1] = used[t - 1]! - l.cost_sprints;
    }
  };
  walk(0, []);

  const mine = runLift({ ...run, started: kept });
  return { share: bestLift > 0 ? Math.min(1, mine / bestLift) : 1, best: [...best].sort((a, b) => a.cycle - b.cycle), budget: room.reduce((a, v) => a + v, 0) };
}

// ---------- sub-criteria ----------

export const SUB: Record<string, SubFn> = {
  clarify_quality(x, p) {
    const qs = x.run.sc.clarify.questions, asked = new Set(Object.entries(x.run.askedAt).filter(([, cy]) => cy <= x.c).map(([q]) => q));
    const high = qs.filter((q) => q.relevance === "high");
    const highAsked = high.filter((q) => asked.has(q.id)).length;
    const lowAsked = qs.filter((q) => q.relevance === "low" && asked.has(q.id)).length;
    const f = { high_asked: highAsked, high_total: high.length, low_asked: lowAsked };
    // Which other question carries the signal depends on the quarter's worry, which an early answer points to.
    const missed = qs.filter((q) => q.signal_for?.includes(x.run.eventId) && !asked.has(q.id));
    if (highAsked >= p.full.high_min && lowAsked <= p.full.low_max) {
      return missed.length ? R("part", f, `You asked the core questions but not the one this quarter's worry pointed to: "${missed[0]!.text}"`) : R("full", f);
    }
    return R(highAsked >= p.part.high_min ? "part" : "none", f);
  },

  metric_defined_before_build(x) {
    const m = firstDefined(decisionsTo(x).map((d) => d.reflection?.primary_metric));
    if (!m) return R("none", { cycle: 0 });
    const builds = started(x, ["build"]);
    const firstBuild = builds.length ? Math.min(...builds.map((b) => b.cycle)) : Infinity;
    return R(m.cycle <= firstBuild ? "full" : "part", { cycle: m.cycle });
  },

  scope_declared(x, p) {
    const s = firstDefined(decisionsTo(x).map((d) => d.focusSegment));
    if (!s) return R("none", { segment: "none", cycle: 0 });
    const stage = x.run.sc.stages[s.v === x.run.sc.engine.post_placement_segment ? 1 : 0]!.id;
    if (!scopeStages(x.run).includes(stage)) return R("part", { segment: s.v, cycle: s.cycle }, `Declared ${s.v} as the focus, but this quarter's brief rules that stage out.`);
    return R(s.cycle <= p.by_cycle ? "full" : "part", { segment: s.v, cycle: s.cycle });
  },

  root_cause_diagnosis(x) {
    const a = lastDefined(decisionsTo(x).map((d) => d.reflection?.root_cause));
    if (!a) return R("none", { choice: "(unanswered)", why: "unanswered" });
    const t = x.run.sc.reflection.prompts.find((q) => q.id === "root_cause")?.truth ?? {};
    if ((t.correct as string[]).includes(a.v)) {
      const rev = x.run.revealed[t.hidden_variable];
      return rev && rev.fidelity === "exact" ? R("full", { choice: a.v }) : R("part", { choice: a.v, why: "right, but nothing you had found yet supported it" });
    }
    const until = t.acceptable_until_cycle?.[a.v];
    if (until !== undefined && a.cycle <= until) return R("part", { choice: a.v, why: "a fair answer this early" });
    return R("none", { choice: a.v });
  },

  research_before_segment_build(x) {
    const builds = started(x, ["build"]).filter((b) => b.l.effects);
    if (!builds.length) return R("none", { segment: "none", builds: 0, researched: 0 });
    const research = started(x, ["research"]);
    const covers = (seg: string, before: number): boolean =>
      research.some((r) => r.cycle < before && (r.l.params?.covers_segments === "all" || (r.l.params?.covers_segments as string[] | undefined)?.includes(seg)));
    const missing = builds.filter((b) => !covers(primarySegment(b.l), b.cycle));
    const frac = 1 - missing.length / builds.length;
    const f = { segment: primarySegment((missing[0] ?? builds[0]!).l), builds: builds.length, researched: builds.length - missing.length };
    return R(frac === 1 ? "full" : frac >= 0.5 ? "part" : "none", f);
  },

  lever_segment_fit(x, p) {
    const builds = started(x, ["build"]).filter((b) => b.l.effects);
    if (!builds.length) return R("none", { share: "0%", segment: "none" });
    const focus = firstDefined(decisionsTo(x).map((d) => d.focusSegment))?.v;
    if (!focus) return R("none", { share: "0%", segment: "none" });
    const top = new Set(
      x.run.sc.levers.filter((l) => l.kind === "build" && l.effects).map((l) => ({ id: l.id, v: l.effects![focus]?.return_30d_rel ?? 0 })).sort((a, b) => b.v - a.v).slice(0, p.top_k).map((r) => r.id),
    );
    const total = builds.reduce((t, b) => t + b.l.cost_sprints, 0);
    const onTop = builds.filter((b) => top.has(b.id));
    const share = onTop.reduce((t, b) => t + b.l.cost_sprints, 0) / total;
    // Knowing which lever suits a segment comes from research or a test. Without either it is a guess: credit in part.
    const firstTop = onTop.length ? Math.min(...onTop.map((b) => b.cycle)) : Infinity;
    const researched = started(x, ["research"]).some((r) => r.cycle < firstTop && (r.l.params?.covers_segments === "all" || (r.l.params?.covers_segments as string[] | undefined)?.includes(focus)));
    const tested = x.run.tests.some((t) => t.cycle < firstTop && top.has(t.lever) && t.segment === focus);
    const f = { share: pct(share), segment: focus };
    if (share >= p.full_share) return researched || tested ? R("full", f) : R("part", f, f.share + " of capacity went to levers that suit " + focus + ", but nothing you had learned yet pointed you there.");
    return R(share >= p.part_share ? "part" : "none", f);
  },

  journey_coverage(x, p) {
    // The stages that count are the ones this quarter's brief puts in scope; a build for a stage it rules out delivers nothing.
    const want = (p.stages as string[]).filter((s) => scopeStages(x.run).includes(s));
    const builds = started(x, ["build"]).filter((b) => b.dropped === undefined);
    const wasted = builds.filter((b) => outOfScope(x.run, b.l));
    const stages = new Set<string>();
    for (const b of builds) if (!blocked(x.run, b.l)) b.l.stages.forEach((s) => stages.add(s));
    if (decisionsTo(x).some((d) => d.notifications && Object.keys(d.notifications).length)) leverOf(x.run, x.run.sc.levers.find((l) => l.kind === "dial")!.id).stages.forEach((s) => stages.add(s));
    const got = want.filter((s) => stages.has(s));
    const f = { stage: (got[0] ?? "any").replace("_", " ") };
    if (got.length === want.length && !wasted.length) return R("full", f);
    if (!got.length) return R("none", f);
    return R("part", f, wasted.length ? `You covered what was in scope, but ${wasted.map((b) => b.l.name).join(" and ")} is outside this quarter's brief and delivered nothing.` : undefined);
  },

  rice_calibration(x, p) {
    const levers = x.run.ranking.map((id) => leverOf(x.run, id)).filter((l) => l.effects);
    if (levers.length < 4) return R("none", { corr: "n/a" }, "No impact ranking of at least four levers was submitted.");
    const rho = spearman(levers.map((_, i) => levers.length - i), levers.map((l) => nominalImpact(x.run, l)));
    // A right ranking with nothing learned behind it is a guess. Credit it in part, as with the diagnosis.
    const current = x.run.ranking.join(",");
    const rankedIn = decisionsTo(x).findIndex((d) => d.impactRanking?.join(",") === current) + 1;
    const backed = started(x, ["research"]).some((s) => s.cycle < rankedIn) || x.run.tests.some((t) => t.cycle < rankedIn);
    const f = { corr: rho.toFixed(2) };
    if (rho >= p.full_rank_corr) return backed ? R("full", f) : R("part", f, "Your ranking matched the real one (rank correlation " + f.corr + "), but nothing you had learned yet supported it.");
    return R(rho >= p.part_rank_corr ? "part" : "none", f);
  },

  capacity_concentration(x, p) {
    // Capacity spent on a build that is stopped at launch (outside the brief, or beyond the bets leadership will back) is spent on no bet at all.
    const builds = started(x, ["build"]);
    const spends = builds.map((b) => b.l.cost_sprints).sort((a, b) => b - a);
    if (!spends.length) return R("none", { share: "0%", n: 0 });
    const live = builds.filter((b) => !blocked(x.run, b.l)).map((b) => b.l.cost_sprints).sort((a, b) => b - a);
    const share = ((live[0] ?? 0) + (live[1] ?? 0)) / spends.reduce((t, v) => t + v, 0);
    const limit = maxBets(x.run), over = Math.max(0, builds.length - limit);
    const f = { share: pct(share), n: spends.length, limit, over };
    if (spends.length <= p.max_levers_full && !over && share >= p.full_share_top2) return R("full", f);
    return R(spends.length <= p.max_levers_part ? "part" : "none", f, over ? `Leadership would back ${limit} bets this quarter and you started ${builds.length}; the last ${over} were stopped at launch.` : undefined);
  },

  delivered_vs_best(x, p) {
    const r = deliveredShare(x.run, x.c);
    if (!r) return R("none", { share: "0%", best: "none", budget: 0 }, "No build has been started, so nothing delivers lift yet.");
    const f = { share: pct(r.share), best: r.best.map((p) => leverOf(x.run, p.id).name + " in cycle " + p.cycle).join(", ") || "nothing", budget: Math.round(r.budget) };
    return R(r.share >= p.full ? "full" : r.share >= p.part ? "part" : "none", f);
  },

  capacity_used(x, p) {
    // Nothing started in the last cycle can go live before the run ends, so idleness there costs nothing.
    if (x.c === x.run.sc.timeline.cycles) return R("na");
    // Capacity put into a build that is stopped at launch is used on nothing, as for concentration.
    const d = decisionAt(x, x.c) ?? {};
    const wasted = (d.start ?? []).reduce((t, id) => (blocked(x.run, leverOf(x.run, id)) ? t + leverOf(x.run, id).cost_sprints : t), 0);
    // Once every bet leadership will back is started, no further build can go live, so idle build capacity costs nothing
    // (but starting more builds than are backed is still spent on nothing, above).
    if (!wasted && started(x, ["build"]).filter((s) => s.cycle < x.c).length >= maxBets(x.run)) return R("na");
    const share = (spendOf(x.run.sc, d) - wasted) / x.run.sc.capacity.eng_sprints_per_cycle;
    const inside = (r: number[]) => share >= r[0]! - 1e-9 && share <= r[1]! + 1e-9;
    return R(inside(p.full) ? "full" : share >= p.part[0] - 1e-9 && share < p.part[1] ? "part" : "none", { share: pct(share) });
  },

  primary_plus_guardrail(x) {
    const dec = decisionsTo(x);
    const primary = lastDefined(dec.map((d) => d.reflection?.primary_metric))?.v;
    const guardrail = lastDefined(dec.map((d) => d.reflection?.guardrail_metric))?.v;
    const f = { primary: primary ?? "none", guardrail: guardrail ?? "none" };
    const right = (x.run.sc.reflection.prompts.find((q) => q.id === "guardrail_metric")?.truth?.correct ?? []) as string[];
    if (primary && guardrail && right.includes(guardrail)) return R("full", f);
    return R(primary ? "part" : "none", f);
  },

  instrumentation_before_dependent(x) {
    const base = baseInstrLevel(x.run);
    const level = (s: Started): number => (s.l.params?.sets_instrumentation_level as number | undefined) ?? 0;
    const bought = started(x).filter((s) => level(s) > 0);
    const blind = started(x, ["build"]).filter((b) => instrLevel(x.run, b.cycle) === 0).length;
    if (base > 0) {
      // The company can already see sessions, so tracking first means not paying for it again.
      const depends = started(x).some((s) => s.l.kind === "build" || (s.l.requires?.instrumentation_level ?? 0) > 0 || level(s) > base);
      if (!depends) return R("none");
      return bought.some((s) => level(s) <= base) ? R("part", {}, "You paid for session tracking the company already had.") : R("full");
    }
    if (!bought.length) return R("none");
    const first = Math.min(...bought.map((s) => s.cycle));
    return R(first <= 1 && blind === 0 ? "full" : "part");
  },

  vanity_trap(x, p) {
    const m = lastDefined(decisionsTo(x).map((d) => d.reflection?.primary_metric))?.v;
    if (!m) return R("none", { primary: "none" });
    if ((p.vanity as string[]).includes(m)) return R("none", { primary: m });
    const truth = x.run.sc.reflection.prompts.find((q) => q.id === "primary_metric")?.truth ?? {};
    return R((truth.correct as string[] | undefined)?.includes(m) ? "full" : "part", { primary: m });
  },

  ab_before_rollout(x, p) {
    const r = rollouts(x, p.levers);
    if (!r.length) return R("none", { lever: "nothing" }, "Nothing risky was rolled out, so nothing was tested first and nothing is credited.");
    const untested = r.filter((o) => !testedBefore(x.run, o.id, o.cycle));
    const frac = 1 - untested.length / r.length;
    return R(frac === 1 ? "full" : frac >= 0.5 ? "part" : "none", { lever: (untested[0] ?? r[0]!).id });
  },

  test_hygiene(x) {
    const T = x.run.tests;
    if (!T.length) return R("none");
    const m = x.run.sc.measurement.experiment;
    const good = T.filter((t) => t.samplePct >= m.min_sample_pct && t.weeks >= m.min_weeks && !t.stoppedEarly).length / T.length;
    return R(good === 1 ? "full" : good >= 0.5 ? "part" : "none");
  },

  acted_on_result(x) {
    if (!x.run.tests.length) return R("none");
    const judged = x.run.tests.filter((t) => t.cycle < x.c && t.verdict !== "inconclusive");
    if (!judged.length) return R("na");
    const frac = judged.filter((t) => actedOn(x, t)).length / judged.length;
    return R(frac >= 0.75 ? "full" : frac >= 0.4 ? "part" : "none");
  },

  notif_below_ceiling(x, p) {
    const first = decisionsTo(x).findIndex((d) => d.notifications && Object.keys(d.notifications).length) + 1;
    if (!first) return R("none", { segment: "none" }, "You never set a notification policy deliberately, so there is nothing to credit.");
    let worst = 0, seg = "";
    for (let t = first; t <= x.c; t++) {
      for (const [s, st] of Object.entries(x.run.notif[t - 1]!)) {
        const r = st.volume / ceiling(x.run, s);
        if (r > worst) { worst = r; seg = s; }
      }
    }
    return R(worst <= p.full_share ? "full" : worst <= p.part_share ? "part" : "none", { segment: seg });
  },

  shock_prepared(x) {
    const e0 = x.run.sc.events.cycle;
    if (x.c < e0) return R("na");
    // Preparation has to be deliberate: a default that happens to absorb the hit earns nothing.
    const acted = decisionsTo(x).some((d) => d.start?.length || d.experiments?.length || (d.notifications && Object.keys(d.notifications).length));
    const m = acted ? (x.run.mitigation ?? 0) : 0;
    return R(m >= 0.5 ? "full" : m >= 0.2 ? "part" : "none", { cycle: e0, absorbed: pct(m) });
  },

  monetisation_fit(x) {
    if (x.c < x.run.sc.endgame.cycle) return R("na");
    const e = x.run.endgame;
    if (!e) return R("none", { choice: "no choice", gap: "-", share: "0%" }, "No monetisation choice was made.");
    const g = x.run.sc.endgame.grading;
    return R(e.ratio >= g.within_best_full ? "full" : e.ratio >= g.within_best_part ? "part" : "none", { choice: e.option, gap: pct(1 - e.ratio), share: pct(e.ratio) });
  },

  status_update_complete(x, p) {
    const fields = p.fields as string[];
    const complete = (d: Decision): boolean => {
      const s = (d.status ?? {}) as Record<string, string | undefined>;
      if (!fields.every((k) => (s[k] ?? "").trim() !== "")) return false;
      const acts = actionNames(x.run, d);
      return acts.some((a) => (s.bet ?? "").toLowerCase().includes(a));
    };
    const n = decisionsTo(x).filter(complete).length;
    return R(n === x.c ? "full" : n >= x.c / 2 ? "part" : "none", { n, total: x.c });
  },

  expectation_calibrated(x, p) {
    let n = 0;
    for (let t = 1; t <= x.c; t++) if (expectationMatched(x, t, p.tolerance)) n++;
    return R(n / x.c >= 0.75 ? "full" : n / x.c >= 0.4 ? "part" : "none", { n, total: x.c });
  },
};

// ---------- modifiers: true only in the cycle the thing happens ----------

export const MOD: Record<string, BoolFn> = {
  lever_live_before(x, p) {
    const a = x.run.started[p.lever];
    const bs = (p.before as string[]).map((id) => x.run.started[id]).filter((s): s is NonNullable<typeof s> => !!s);
    if (!a || !bs.length) return false;
    const firstB = Math.min(...bs.map((b) => b.cycle));
    return x.c === firstB && a.cycle < firstB;
  },

  notif_over_ceiling_consecutive(x, p) {
    const over = (t: number): boolean => Object.entries(x.run.notif[t - 1]!).some(([s, st]) => st.volume > ceiling(x.run, s));
    let streak = 0;
    for (let t = x.c; t >= 1 && over(t); t--) streak++;
    return streak === p.cycles;
  },

  risky_lever_without_test(x, p) {
    return rollouts(x, p.levers).some((o) => o.cycle === x.c && !testedBefore(x.run, o.id, o.cycle));
  },

  levers_started_in_cycle_gt(x, p) {
    const n = (decisionAt(x, x.c)?.start ?? []).filter((id) => ["build", "foundation"].includes(leverOf(x.run, id).kind)).length;
    return n > p.n;
  },

  built_before_evidence(x, p) {
    const s = x.run.started[p.lever];
    if (!s || s.cycle !== x.c) return false;
    const evidence = (p.evidence_levers as string[]).some((id) => {
      if (leverOf(x.run, id).kind === "experiment") return x.run.tests.some((t) => t.cycle < x.c);
      return !!x.run.started[id] && x.run.started[id]!.cycle < x.c;
    });
    return !evidence;
  },

  killed_losing_test(x) {
    return (decisionAt(x, x.c)?.drop ?? []).some((id) => x.run.tests.some((t) => t.lever === id && t.cycle < x.c && t.verdict === "loss"));
  },

  guardrail_breach_responded(x) {
    if (x.c < 2) return false;
    const opt = (t: number): number => x.run.reports[t - 1]!.true.notif_opt_out;
    const prev = x.c - 2 >= 1 ? opt(x.c - 2) : baselineOptOut(x.run);
    if (opt(x.c - 1) - prev < x.run.sc.engine.guardrail_breach_abs) return false;
    return Object.entries(x.run.notif[x.c - 1]!).some(([s, st]) => st.volume < x.run.notif[x.c - 2]![s]!.volume);
  },

  expectation_within(x, p) {
    return expectationMatched(x, x.c, p.tolerance);
  },

  endgame_choice_within_best(x, p) {
    return x.c === x.run.sc.endgame.cycle && !!x.run.endgame && x.run.endgame.ratio >= p.within;
  },

  endgame_choice_below(x, p) {
    return x.c === x.run.sc.endgame.cycle && !!x.run.endgame && x.run.endgame.ratio < p.below;
  },
};

// ---------- event mitigations: evaluated once, in the event cycle ----------

/** How much of the market event the run's state absorbs when it hits: the mitigations whose condition holds, capped. */
export function absorbed(run: Run, c: number): number {
  const ev = run.sc.events.pool.find((e) => e.id === run.eventId)!;
  const total = ev.mitigations.reduce((t, m) => (PRED[m.when.fn]!({ run, c }, m.when.params) ? t + m.factor : t), 0);
  return Math.min(run.sc.engine.event_max_mitigation, total);
}

export const PRED: Record<string, BoolFn> = {
  lever_live: (x, p) => liveLever(x.run, p.lever, x.c),
  research_done: (x, p) => !!x.run.started[p.lever] && x.run.started[p.lever]!.cycle <= x.c,
  notif_volume_at_most_share_of_ceiling: (x, p) => Object.entries(x.run.notif[x.c - 1]!).every(([s, st]) => st.volume <= p.share * ceiling(x.run, s)),
};

// ---------- endgame ----------

/** The facts an endgame option's value depends on. The engine uses the real ones; a player builds the same from what they learned. */
export interface EndgameWorld { attributionGap: number; priceSensitivity: Record<string, number>; engagement: number; returnRate: number }

export const trueEndgameWorld = (run: Run, c: number): EndgameWorld => ({
  attributionGap: hiddenTruth(run, "attribution_gap") as number,
  priceSensitivity: hiddenTruth(run, "price_sensitivity") as Record<string, number>,
  engagement: run.reports[c - 1]!.true.post_placement_engagement,
  returnRate: run.reports[c - 1]!.true.return_30d,
});

/** Value in rupees of one endgame option. */
export function endgameValue(run: Run, p: Params, c: number, w: EndgameWorld = trueEndgameWorld(run, c)): number {
  const e = run.sc.engine;
  const people = (id: string): number => e.population * run.sc.segments.find((s) => s.id === id)!.share;
  if ("fee_inr" in p) return p.fee_inr * p.placements_per_active_per_cycle * people(p.segment) * (1 - w.attributionGap) * (1 - p.dispute_cost_share);
  if ("price_inr_month" in p) return run.sc.segments.reduce((sum, s) => sum + people(s.id) * (w.priceSensitivity[s.id] ?? 0), 0) * p.price_inr_month * p.months;
  if ("commission_share" in p) {
    if (!liveLever(run, p.requires_lever, c)) return 0;
    return p.commission_share * p.avg_course_inr * p.attach_rate_per_engaged_placed * people(e.post_placement_segment) * w.engagement;
  }
  if ("value_per_return_point_inr" in p) return Math.max(0, (w.returnRate - baselineReturn(run)) * 100) * p.value_per_return_point_inr;
  throw new Error("unknown endgame value model");
}

/** Every fn name the engine implements, for the catalogue check. */
export const IMPLEMENTED = new Set([...Object.keys(SUB), ...Object.keys(MOD), ...Object.keys(PRED), "endgame_value"]);
