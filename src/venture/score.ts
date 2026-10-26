// Scoring for the product-manager seat: seven dimensions, twenty-eight sub-criteria, a few modifiers.
// A sub-criterion is full, part, none or na (it did not apply). Its worth is its dimension's weight divided by the dimension's
// sub count, times 2 for the sub-criteria the scenario's rubric lists as doubled (the ones that ask whether the manager found and built the right thing). The total is 100 x earned / earnable over the subs that applied, plus modifiers, clamped to 0..100.
// Outcomes are judged against two other runs in the same world: doing nothing, and a manager who was simply told every hidden fact.
// Luck that all three share (the event, the incident draws) cancels out.
import { approval, capacity, EVENT_QUARTER, HORIZON, idleDecision, isLive, itemOf, outlook, overrun, planValue, playQuarter, rootTruth, valueOf } from "./model.ts";
import type { World } from "./model.ts";
import { referencePolicy } from "./planner.ts";
import type { Run } from "./run.ts";
import { lc, termsOf } from "./types.ts";
import type { Item, VentureScenario } from "./types.ts";

export type Level = "full" | "part" | "none" | "na";
export interface Sub { id: string; label: string; level: Level; note: string }
export interface DimScore { id: string; name: string; weight: number; score: number | null; earned: number; earnable: number; subs: Sub[] }
export interface Modifier { id: string; pts: number; why: string }
export interface Score { total: number; base: number; dims: DimScore[]; modifiers: Modifier[]; idle: boolean }

/**
 * Every sub-criterion the product-manager rubric judges, in the order a review lists them. A scenario's rubric sets the weight of each
 * dimension and which sub-criteria count double (spec 5.2); the judging itself is in scoreRun.
 */
export const SUBS: { id: string; dim: string; label: string }[] = [
  { dim: "strategy", id: "priority_alignment", label: "Chose the right theme" },
  { dim: "strategy", id: "roadmap_follows_priority", label: "Built what the theme called for" },
  { dim: "strategy", id: "stranded_work", label: "Finished what was started" },
  { dim: "evidence", id: "measurement_built", label: "Built the measurement others depended on" },
  { dim: "evidence", id: "learned_before_bets", label: "Learned before the big bets" },
  { dim: "evidence", id: "experiments_acted_on", label: "Acted on experiment results" },
  { dim: "evidence", id: "diagnosis", label: "Found the root cause" },
  { dim: "delivery", id: "delivered_vs_best", label: "Shipped what was worth most" },
  { dim: "delivery", id: "capacity_used", label: "Used the team's weeks" },
  { dim: "delivery", id: "roadmap_fits_capacity", label: "Asked for no more than the team could do" },
  { dim: "delivery", id: "pace_fits_state", label: "Set a pace the team could hold" },
  { dim: "stewardship", id: "debt_managed", label: "Kept technical debt in check" },
  { dim: "stewardship", id: "reserves_matched", label: "Matched reserves to need" },
  { dim: "stewardship", id: "incident_exposure", label: "Kept the product from breaking" },
  { dim: "stewardship", id: "usability_kept", label: "Kept the product usable" },
  { dim: "leadership", id: "commitments_kept", label: "Kept promises to the teams" },
  { dim: "leadership", id: "trust_built", label: "Built trust across the teams" },
  { dim: "leadership", id: "morale_kept", label: "Kept the team's morale" },
  { dim: "leadership", id: "asks_sized_to_trust", label: "Asked for what the trust could bear" },
  { dim: "leadership", id: "gates_anticipated", label: "Saw the prerequisites coming" },
  { dim: "adapt", id: "event_response", label: "Read and answered the market event" },
  { dim: "adapt", id: "event_absorbed", label: "Absorbed the market event" },
  { dim: "adapt", id: "expectations_calibrated", label: "Forecast honestly" },
  { dim: "value", id: "value_created", label: "Created value against what was possible" },
  { dim: "value", id: "paid_its_way", label: "Paid its way within the year" },
  { dim: "value", id: "unit_economics", label: "Shipped nothing that loses money" },
  { dim: "value", id: "cash_safe", label: "Kept the company safe on cash" },
  { dim: "value", id: "plan_choice", label: "Chose the right plan for next year" },
];
const LABEL = Object.fromEntries(SUBS.map((s) => [s.id, s.label]));
/** A sub-criterion's label as this case reads it: the two that name the dials use the case's own words. */
export function subLabel(id: string, cs: VentureScenario): string {
  const t = termsOf(cs);
  if (id === "debt_managed") return `Kept ${lc(t.debt)} in check`;
  if (id === "usability_kept" && t.usability !== termsOf({}).usability) return `Kept ${lc(t.usability)} up`;
  return LABEL[id]!;
}
export const DIMENSION_IDS = [...new Set(SUBS.map((s) => s.dim))];

/** Thresholds, in one place: the share (or amount) at which a sub-criterion is full, and at which it is part. */
export const CUT = {
  roadmapOnPriority: [0.55, 0.35], capacityUsed: [0.85, 0.6], fitsCapacity: [0.75, 0.5], deliveredVsBest: [0.5, 0.25],
  debtChange: [-6, 2], incidentRatio: [0.85, 1.15], usabilityChange: [4, -2], keptShare: [0.85, 0.6], keptCount: 6, trustChange: [4, 0], moraleChange: [-2, -10],
  asksGranted: [0.75, 0.5], learnedShare: [0.99, 0.5], actedShare: [0.8, 0.5], absorbed: [0.5, 0.3], calibrated: [0.7, 0.4],
  valueCreated: [0.75, 0.4], paidItsWay: [-0.005, -0.03], cash: [0.5, 0.2], planShare: [0.8, 0.4],
} as const;

const hi = (x: number, [full, part]: readonly [number, number] | readonly number[]): Level => (x >= full! ? "full" : x >= part! ? "part" : "none");
const lo = (x: number, [full, part]: readonly [number, number] | readonly number[]): Level => (x <= full! ? "full" : x <= part! ? "part" : "none");
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const f1 = (x: number): string => (Math.round(x * 10) / 10).toString();
const sum = (xs: number[]): number => xs.reduce((t, x) => t + x, 0);
const hiddenVars = (i: Item): string[] => [...(i.scale ?? []).map((x) => x.v), ...(i.side_cost?.v ? [i.side_cost.v] : [])];

const isIdle = (run: Run): boolean => run.qs.every(({ d }) => d.roadmap.length === 0 && !(d.experiments?.length) && !(d.dives?.length) && !d.asks && !(d.commit?.length) && !d.event && !d.plan && !d.reflection
  && !(d.drop?.length) && d.pace === "steady" && d.reserve.rel === 0.05 && d.reserve.debt === 0.05);

/** What a run created: profit over the year plus what the position left behind is worth to a reference builder. */
const created = (run: Run): number => sum(run.qs.map((x) => x.r.profit)) + outlook(run.w, run.end, referencePolicy);

export function scoreRun(run: Run, base: Run, oracle: Run): Score {
  const { w, qs, start, end } = run, cs = w.cs, T = termsOf(cs);
  const tw: World = { ...w, expected: { effect: "true", overrun: 1 } };
  const work: Record<string, number> = {}, doneQ: Record<string, number> = {}, firstQ: Record<string, number> = {};
  qs.forEach((x, k) => {
    for (const [id, v] of Object.entries(x.r.workDone)) if (v > 0) { work[id] = (work[id] ?? 0) + v; firstQ[id] ??= k + 1; }
    for (const id of x.r.completed) doneQ[id] = k + 1;
  });
  const cache: Record<string, number> = {};
  const valueIfDoneIn = (id: string, q: number): number => (cache[`${id}|${q}`] ??= valueOf(tw, start, id, HORIZON - q + 1));
  const tv = (id: string): number => valueIfDoneIn(id, 1);
  const subs: Record<string, Sub[]> = Object.fromEntries(cs.rubric.dimensions.map((d) => [d.id, [] as Sub[]])), doubled = new Set(cs.rubric.doubled);
  const add = (dim: string, id: string, level: Level, note: string): void => { subs[dim]!.push({ id, label: subLabel(id, cs), level, note }); };
  const startedIds = Object.keys(work), workAll = sum(Object.values(work));
  const learnedBefore = (id: string, q: number): boolean => {
    const i = itemOf(cs, id);
    return qs.slice(0, q - 1).some((x) => x.r.readings.tested.includes(id) || x.r.readings.dived.some((v) => hiddenVars(i).includes(v)));
  };

  // ---------- strategy and focus
  {
    const q2 = qs[1]!, open = cs.items.filter((i) => !isLive(q2.s0, i.id));
    const worth = (p: string): number => sum(open.filter((i) => i.serves.includes(p as never)).map((i) => Math.max(0, valueOf(tw, q2.s0, i.id))));
    const order = (["grow", "activate", "retain", "monetise", "quality", "debt", "learn"] as const).map((p) => ({ p, v: worth(p) })).sort((a, b) => b.v - a.v);
    const chosen = q2.d.priority;
    const backed = qs.slice(0, 2).some((x) => x.r.readings.tested.length > 0 || x.r.readings.dived.length > 0);
    let lvl: Level = "none";
    if (chosen === order[0]!.p) lvl = backed ? "full" : "part";
    else if (chosen === order[1]!.p && backed) lvl = "part";
    add("strategy", "priority_alignment", lvl, `named ${chosen ?? "no priority"} for the second quarter; the open work paid most under ${order[0]!.p}${backed ? ", after learning" : ", with nothing learned first"}`);
    if (workAll <= 0) add("strategy", "roadmap_follows_priority", "none", "nothing was built");
    else {
      const on = sum(qs.map((x) => sum(Object.entries(x.r.workDone).filter(([id]) => x.d.priority && itemOf(cs, id).serves.includes(x.d.priority)).map(([, v]) => v))));
      add("strategy", "roadmap_follows_priority", hi(on / workAll, CUT.roadmapOnPriority), `${pct(on / workAll)} of the ${lc(T.eng)} weeks went to the priority named that quarter`);
    }
    const stranded = Object.entries(end.progress).filter(([id, v]) => v > 0 && !isLive(end, id) && !end.killed.includes(id)).map(([id]) => id);
    add("strategy", "stranded_work", workAll <= 0 ? "na" : stranded.length === 0 ? "full" : stranded.length === 1 ? "part" : "none", stranded.length ? `${stranded.length} started and not finished: ${stranded.join(", ")}` : "everything started was finished");
  }

  // ---------- customer and evidence
  {
    const lv2 = qs[1]!.s1.level, lv3 = qs[2]!.s1.level;
    // Measurement only counts for much when something depended on it: an experiment, a gated item, or an event read from data.
    const used = qs.some((x) => x.r.readings.tested.length > 0 || x.r.event?.evidenced) || Object.keys(doneQ).some((id) => itemOf(cs, id).needs?.level !== undefined);
    add("evidence", "measurement_built", lv2 >= 2 && used ? "full" : lv2 >= 2 || lv3 >= 2 || (start.level === 0 && lv2 >= 1) ? "part" : "none", `measurement level ${start.level} at the start, ${lv2} after the second quarter, ${lv3} after the third; ${used ? "something depended on it" : "nothing depended on it"}`);
    const bets = startedIds.map((id) => itemOf(cs, id)).filter((i) => i.risky || i.big);
    if (!bets.length) add("evidence", "learned_before_bets", "na", "no big or risky item was started");
    else {
      const ok = bets.filter((i) => learnedBefore(i.id, firstQ[i.id]!)).length;
      add("evidence", "learned_before_bets", hi(ok / bets.length, CUT.learnedShare), `${ok} of ${bets.length} big or risky items were tested, or had their hidden facts read, before work began`);
    }
    const tests = qs.flatMap((x, k) => x.r.readings.tested.map((id) => ({ id, q: k + 1 })));
    if (!tests.length) add("evidence", "experiments_acted_on", "na", "no experiments were run");
    else {
      const acted = tests.filter(({ id, q }) => {
        const later = qs.slice(q - 1).some((x) => (x.r.workDone[id] ?? 0) > 0) || isLive(end, id);
        return (end.read[id] ?? 0) > 0 ? later : !later || end.killed.includes(id);
      }).length;
      add("evidence", "experiments_acted_on", hi(acted / tests.length, CUT.actedShare), `${acted} of ${tests.length} experiment readings were followed (built if positive, left alone or dropped if not)`);
    }
    const root = [...qs].reverse().map((x) => x.d.reflection?.root_cause).find((x) => x !== undefined), truth = rootTruth(cs, w.hidden);
    const dived = qs.some((x) => x.r.readings.dived.includes(cs.root.dive));
    add("evidence", "diagnosis", root === truth ? (dived ? "full" : "part") : "none", `named ${root ?? "no cause"}; the cause in this world was ${truth}${dived ? ", and the deep dive had been run" : ", with no deep dive behind the answer"}`);
  }

  // ---------- delivery and execution
  {
    const done = Object.entries(doneQ);
    // The best a manager could have done with the same capacity: items taken in order of true value per engineering week, scheduled into the quarters they would finish in.
    const road0 = capacity(tw, start, { roadmap: [], reserve: { rel: 0.1, debt: 0.1 }, pace: "steady", research: 0.4, instrument: 0.5 }).road;
    let cum = 0, best = 0;
    const ranked = cs.items.filter((i) => tv(i.id) > 0).sort((a, b) => tv(b.id) / b.eng - tv(a.id) / a.eng);
    for (const i of ranked) {
      const need = i.eng * (1 + overrun(tw, i, start, idleDecision()).mu), q = Math.ceil((cum + need) / road0);
      if (q > 4) continue;
      cum += need; best += valueIfDoneIn(i.id, q);
    }
    const realised = sum(done.map(([id, q]) => valueIfDoneIn(id, q)));
    add("delivery", "delivered_vs_best", best <= 0 ? "na" : hi(Math.max(0, realised) / best, CUT.deliveredVsBest), `shipped items worth ${f1(realised)} lakh against ${f1(best)} for the best feasible set`);
    const road = sum(qs.map((x) => x.r.cap.road)), used = sum(qs.map((x) => x.r.engUsed));
    add("delivery", "capacity_used", road <= 0 ? "na" : hi(used / road, CUT.capacityUsed), `${pct(used / road)} of the roadmap ${lc(T.eng)} weeks were used`);
    const fits = qs.map((x) => {
      const funded = x.d.roadmap.filter((id) => !x.s0.killed.includes(id) && !isLive(x.s0, id) && !x.r.blocked[id]);
      if (!funded.length) return null;
      const need = sum(funded.map((id) => { const i = itemOf(cs, id); return i.eng * (1 + overrun(w, i, x.s0, x.d).mu) - (x.s0.progress[id] ?? 0); }));
      return need / Math.max(1, x.r.cap.road) <= 1.15;
    }).filter((x): x is boolean => x !== null);
    add("delivery", "roadmap_fits_capacity", fits.length ? hi(fits.filter(Boolean).length / fits.length, CUT.fitsCapacity) : "na", `${fits.filter(Boolean).length} of ${fits.length} quarters asked for no more than the team could do`);
    const bad = qs.filter((x, k) => {
      const prevInc = k > 0 ? qs[k - 1]!.r.incidents : 0, needRelax = x.s0.M < 50 || prevInc >= 2, healthy = x.s0.M >= 65 && x.s0.D <= 55;
      return x.d.pace === "push" ? !healthy : needRelax ? x.d.pace === "steady" && x.s0.M < 42 : false;
    }).length;
    add("delivery", "pace_fits_state", bad === 0 ? "full" : bad === 1 ? "part" : "none", `${bad} quarter(s) where the pace did not suit morale, debt or incidents`);
  }

  // ---------- quality and technical stewardship
  {
    add("stewardship", "debt_managed", lo(end.D - start.D, CUT.debtChange), `${lc(T.debt)} went from ${f1(start.D)} to ${f1(end.D)}`);
    let off = 0, checks = 0;
    qs.forEach((x, k) => {
      const prevInc = k > 0 ? qs[k - 1]!.r.incidents : 0, needRel = x.s0.R < 60 || prevInc >= 1, needDebt = x.s0.D > 60;
      checks += 2;
      if ((needRel && x.d.reserve.rel < 0.08) || (!needRel && x.d.reserve.rel > 0.18)) off++;
      if ((needDebt && x.d.reserve.debt < 0.08) || (!needDebt && x.d.reserve.debt > 0.18)) off++;
    });
    add("stewardship", "reserves_matched", off <= 1 ? "full" : off <= 3 ? "part" : "none", `${off} of ${checks} reserve settings were too thin for the need, or more than the need justified`);
    const lam = sum(qs.map((x) => x.r.lambdaBase)) / qs.length;
    add("stewardship", "incident_exposure", lo(lam / cs.incident_base, CUT.incidentRatio), `expected incidents ${f1(lam * 100)} per hundred quarters against ${f1(cs.incident_base * 100)} for a middling product (what actually happened is luck and is not counted)`);
    add("stewardship", "usability_kept", hi(end.U - start.U, CUT.usabilityChange), `${lc(T.usability)} went from ${f1(start.U)} to ${f1(end.U)}`);
  }

  // ---------- cross-team leadership
  {
    const kept = sum(qs.map((x) => x.r.commitKept)), broke = sum(qs.map((x) => x.r.commitBroken));
    const share = kept / Math.max(1, kept + broke);
    add("leadership", "commitments_kept", kept + broke === 0 ? "na" : share >= CUT.keptShare[0] && kept >= CUT.keptCount ? "full" : share >= CUT.keptShare[1] ? "part" : "none", `${kept} promises kept, ${broke} broken (full needs at least ${CUT.keptCount} kept: promising nothing is not leadership)`);
    const teams = ["eng", "design", "biz", "lead", "ext"] as const;
    const dt = sum(teams.map((t) => end.trust[t] - start.trust[t])) / teams.length, worst = Math.min(...teams.map((t) => end.trust[t] - start.trust[t]));
    const risen = teams.filter((t) => end.trust[t] - start.trust[t] >= 3).length;
    add("leadership", "trust_built", dt >= CUT.trustChange[0] && worst >= -3 && risen >= 3 ? "full" : dt >= CUT.trustChange[1] ? "part" : "none", `average trust moved ${dt >= 0 ? "+" : ""}${f1(dt)}; ${risen} of 5 teams trust the manager at least 3 more, the worst moved ${worst >= 0 ? "+" : ""}${f1(worst)}`);
    const attr = qs.filter((x) => x.r.attrition).length, m = hi(end.M - start.M, CUT.moraleChange);
    add("leadership", "morale_kept", attr > 0 && m === "full" ? "part" : m, `morale went from ${f1(start.M)} to ${f1(end.M)}${attr ? `, ${attr} left the ${lc(T.eng)} team` : ""}`);
    const asks = qs.flatMap((x) => [...(x.d.asks?.marketing ? [approval(x.s0.trust.biz)] : []), ...(x.d.asks?.contractors ? [approval(x.s0.trust.lead)] : [])]);
    add("leadership", "asks_sized_to_trust", asks.length ? hi(asks.filter((a) => a >= 0.5).length / asks.length, CUT.asksGranted) : "na", `${asks.filter((a) => a >= 0.5).length} of ${asks.length} requests were made when the team trusted the manager enough to grant them`);
    const gated = [...new Set(qs.flatMap((x) => x.d.roadmap))].filter((id) => itemOf(cs, id).needs);
    if (!gated.length) add("leadership", "gates_anticipated", "na", "no gated item was funded");
    else {
      const blockedQ = sum(qs.map((x) => gated.filter((id) => x.r.blocked[id]).length)), never = gated.filter((id) => qs.some((x) => x.r.blocked[id]) && !doneQ[id]);
      add("leadership", "gates_anticipated", blockedQ === 0 ? "full" : never.length === 0 ? "part" : "none", `${blockedQ} funded item-quarter(s) were stopped by a missing prerequisite${never.length ? `; ${never.join(", ")} never got through` : ""}`);
    }
  }

  // ---------- adaptability
  {
    const e = qs[EVENT_QUARTER - 1]!.r.event;
    if (!e) { add("adapt", "event_response", "na", "no event reached the run"); add("adapt", "event_absorbed", "na", "no event reached the run"); }
    else {
      add("adapt", "event_response", e.readingOk && e.dirOk ? "full" : e.readingRight || e.dirOk ? "part" : "none",
        `read the cause ${e.readingRight ? (e.evidenced ? "correctly, from data" : "correctly, without data") : "wrongly"}; chose the ${e.dirOk ? "right" : "wrong"} response`);
      add("adapt", "event_absorbed", hi(e.absorbed, CUT.absorbed), `${pct(e.absorbed)} of the hit was absorbed (live fixes, trust, measurement, ${lc(T.reliability)} and the response all count)`);
    }
    const marks = qs.map((x): number | null => {
      if (!x.d.reflection) return null;
      const hold = playQuarter(w, x.s0, idleDecision(), { evQ: EVENT_QUARTER }).r, rel = (x.r.profit - hold.profit) / Math.max(1, x.r.revenue);
      const actual = rel < -0.01 ? 0 : rel < 0.01 ? 1 : rel < 0.04 ? 2 : 3, said = ["down", "flat", "up_small", "up_large"].indexOf(x.d.reflection.expected), gap = Math.abs(actual - said);
      return gap === 0 ? 1 : gap === 1 ? 0.5 : 0;
    }).filter((x): x is number => x !== null);
    add("adapt", "expectations_calibrated", marks.length ? hi(sum(marks) / marks.length, CUT.calibrated) : "na", `${f1(sum(marks))} of ${marks.length} quarters' profit-against-holding forecasts matched what happened`);
  }

  // ---------- business value
  {
    const baseRevenue = sum(base.qs.map((x) => x.r.revenue));
    const made = created(run) - created(base), could = created(oracle) - created(base);
    add("value", "value_created", could <= 0 ? "na" : hi(Math.max(0, made) / could, CUT.valueCreated), made >= could ? `created ${f1(made)} lakh over the year and the position left behind, more than the ${f1(could)} for the benchmark manager who was told every hidden fact` : `created ${f1(made)} lakh over the year and the position left behind, against ${f1(could)} for the benchmark manager who was told every hidden fact`);
    const inYear = sum(qs.map((x) => x.r.profit)) - sum(base.qs.map((x) => x.r.profit));
    add("value", "paid_its_way", hi(inYear / Math.max(1, baseRevenue), CUT.paidItsWay), `profit over the year was ${inYear >= 0 ? "+" : ""}${f1(inYear)} lakh against doing nothing`);
    const done = Object.keys(doneQ), bad = done.filter((id) => tv(id) < 0);
    add("value", "unit_economics", done.length === 0 ? "na" : bad.length === 0 ? "full" : bad.length === 1 ? "part" : "none", bad.length ? `shipped item(s) that lose money in this world: ${bad.join(", ")}` : "everything shipped pays for itself");
    const minCash = Math.min(...qs.map((x) => x.s1.cash));
    add("value", "cash_safe", hi(minCash / Math.max(1, start.cash), CUT.cash), `cash never fell below ${f1(minCash)} lakh (started at ${f1(start.cash)})`);
    const chosen = qs[3]!.d.plan;
    if (!chosen) add("value", "plan_choice", "none", "no plan was chosen");
    else {
      const vals = cs.plans.map((p) => planValue(w, end, p.id)), c = vals[cs.plans.findIndex((p) => p.id === chosen)]!;
      const lo2 = Math.min(...vals), hi2 = Math.max(...vals), r = hi2 > lo2 ? (c - lo2) / (hi2 - lo2) : 1;
      const backed = qs.some((x) => x.r.readings.dived.length > 0 || x.r.readings.tested.length > 0), l = hi(r, CUT.planShare);
      add("value", "plan_choice", l === "full" && !backed ? "part" : l, `chose ${chosen}: ${pct(r)} of the way from the worst plan to the best${backed ? "" : ", with nothing learned first"}`);
    }
  }

  // ---------- total
  const idle = isIdle(run);
  const dims: DimScore[] = cs.rubric.dimensions.map((d) => {
    const ss = idle ? subs[d.id]!.map((s) => ({ ...s, level: "none" as Level })) : subs[d.id]!;
    const worth = (s: Sub): number => (d.weight / ss.length) * (doubled.has(s.id) ? 2 : 1), ok = ss.filter((s) => s.level !== "na");
    const earned = sum(ok.map((s) => worth(s) * (s.level === "full" ? 1 : s.level === "part" ? 0.5 : 0))), earnable = sum(ok.map(worth));
    return { ...d, score: earnable > 0 ? earned / earnable : null, earned, earnable, subs: ss };
  });
  const earned = sum(dims.map((d) => d.earned)), earnable = sum(dims.map((d) => d.earnable)), baseTotal = earnable > 0 ? (100 * earned) / earnable : 0;

  // ---------- modifiers
  const modifiers: Modifier[] = [];
  if (!idle) {
    const root = [...qs].reverse().map((x) => x.d.reflection?.root_cause).find((x) => x !== undefined);
    if (qs[0]!.r.readings.dived.includes(cs.root.dive) && root === rootTruth(cs, w.hidden) && !qs[0]!.r.completed.some((id) => itemOf(cs, id).big || itemOf(cs, id).risky)) modifiers.push({ id: "found_it_first", pts: 3, why: "the cause was found by a deep dive in the first quarter, before any big or risky item shipped" });
    const blind = cs.items.filter((i) => i.fav && doneQ[i.id] && !learnedBefore(i.id, firstQ[i.id]!));
    if (blind.length) modifiers.push({ id: "favourite_built_blind", pts: -2, why: `${blind.map((i) => i.name).join(", ")} was built because a sponsor wanted it, with no test or deep dive first` });
    if (qs.some((x) => x.r.commitBroken >= 2 && sum(x.d.roadmap.map((id) => itemOf(cs, id).eng)) > 1.3 * x.r.cap.road)) modifiers.push({ id: "overcommitted_and_broke_promises", pts: -3, why: "promised more than the team could build, and broke at least two promises in one quarter" });
    if (qs.some((x) => x.d.pace === "push" && x.r.incidents >= 1 && x.r.M < 55)) modifiers.push({ id: "pushed_into_incident", pts: -2, why: "pushed a tired team and an incident followed" });
    if (qs.flatMap((x) => x.d.drop ?? []).some((id) => (end.read[id] ?? 1) < 0 || tv(id) < 0)) modifiers.push({ id: "killed_a_loser", pts: 2, why: "dropped an item that was losing money or had read negative" });
  }
  const total = Math.max(0, Math.min(100, baseTotal + sum(modifiers.map((m) => m.pts))));
  return { total, base: baseTotal, dims, modifiers, idle };
}
