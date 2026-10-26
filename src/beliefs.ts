// What a player can work out from what they have been shown. Nothing here reads the hidden truth: only the
// readings the engine returned (at their fidelity), the observed metrics, and the file's own "typical"
// values, which stand for a designer's benchmark the player is entitled to start from.
import type { Reading, Run } from "./types.ts";
import { baselineReturn, noiseSd } from "./model.ts";
import type { EndgameWorld } from "./rules.ts";

const readings = (run: Run, id: string): Reading[] => run.revealed[id]?.readings ?? [];
const nominalTruth = (run: Run, id: string): any => run.nominal.hidden_variables.find((h) => h.id === id)?.truth;

/** What the numeric readings of one key of a per-segment map add up to: more precise readings count for more. */
export function numericEstimate(run: Run, hiddenId: string, key: string): number | undefined {
  let exact: number | undefined;
  let sum = 0, weight = 0;
  for (const r of readings(run, hiddenId)) {
    if (r.fidelity === "directional") continue;
    const v = (r.value as Record<string, unknown> | undefined)?.[key];
    if (typeof v !== "number") continue;
    if (r.fidelity === "exact") exact = v;
    else { const w = 1 / Math.max(r.sd, 1e-6) ** 2; sum += w * v; weight += w; }
  }
  return exact ?? (weight ? sum / weight : undefined);
}

/** What every numeric reading of one number (the same for everyone) adds up to: more precise readings count for more. */
export function scalarEstimate(run: Run, hiddenId: string): number | undefined {
  let exact: number | undefined;
  let sum = 0, weight = 0;
  for (const r of readings(run, hiddenId)) {
    if (typeof r.value !== "number") continue;
    if (r.fidelity === "exact") exact = r.value;
    else { const w = 1 / Math.max(r.sd, 1e-6) ** 2; sum += w * r.value; weight += w; }
  }
  return exact ?? (weight ? sum / weight : undefined);
}

/** Levers best first for one segment: from an interview's order, or from survey numbers. */
export function responseOrder(run: Run, segment: string): string[] | undefined {
  for (const r of [...readings(run, "segment_response")].reverse()) {
    const v = (r.value as Record<string, any> | undefined)?.[segment];
    if (!v) continue;
    if (Array.isArray(v.order)) return v.order as string[];
    const nums = Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "number") as [string, number][];
    if (nums.length) return nums.sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }
  return undefined;
}

/** All levers ranked by expected impact across the user base: each segment's order, weighted by its share. */
export function overallRanking(run: Run, levers: string[]): string[] {
  const score = Object.fromEntries(levers.map((l) => [l, 0])) as Record<string, number>;
  let learned = false;
  for (const s of run.sc.segments) {
    const order = responseOrder(run, s.id);
    if (!order) continue;
    learned = true;
    for (const l of levers) { const i = order.indexOf(l); score[l]! += s.share * (i < 0 ? 0 : levers.length - i); }
  }
  return learned ? [...levers].sort((a, b) => score[b]! - score[a]!) : levers;
}

/** The stages of the journey this quarter's brief covers, as far as the answers have said. Until they have, all of them. */
export function believedStages(run: Run): string[] {
  const all = [...new Set(run.sc.levers.flatMap((l) => l.stages))];
  return run.known.scope && run.known.scope !== "both" ? [run.known.scope] : all;
}

/** How many bets leadership will back, as far as the answers have said. Until they have, no limit. */
export const believedBets = (run: Run): number => (run.known.bets ? Number(run.known.bets) : Infinity);

/** A fatigue ceiling for a segment: a test's estimate, else scaled from another segment's, else a cautious guess. */
export function ceilingBelief(run: Run, segment: string): number {
  const own = numericEstimate(run, "notif_fatigue_ceiling", segment);
  if (own !== undefined) return own;
  const typical = nominalTruth(run, "notif_fatigue_ceiling") as Record<string, number>;
  for (const s of run.sc.segments) {
    const other = numericEstimate(run, "notif_fatigue_ceiling", s.id);
    if (other !== undefined) return other * (typical[segment]! / typical[s.id]!);
  }
  return 0.6 * typical[segment]!;
}

/** Volumes a careful player sets: a margin under what they believe the ceiling is. */
export function safeVolumes(run: Run, margin = 0.7): Record<string, { volume: number; targeting: "rules" }> {
  return Object.fromEntries(run.sc.segments.map((s) => [s.id, { volume: Math.round(Math.max(0.3, margin * ceilingBelief(run, s.id)) * 10) / 10, targeting: "rules" as const }]));
}

/** What the player believes the endgame depends on: their readings where they have them, the benchmark where they do not. */
export function believedEndgameWorld(run: Run, c: number): EndgameWorld {
  let gap = nominalTruth(run, "attribution_gap") as number;
  const gapReadings = readings(run, "attribution_gap");
  const measured = scalarEstimate(run, "attribution_gap");
  if (measured !== undefined) gap = measured;
  else {
    const bucket = gapReadings.map((r) => (r.value as { bucket?: string } | undefined)?.bucket).filter(Boolean).at(-1);
    gap *= ({ below: 0.7, typical: 1, above: 1.35 } as Record<string, number>)[bucket ?? "typical"]!;
  }
  const price: Record<string, number> = { ...(nominalTruth(run, "price_sensitivity") as Record<string, number>) };
  for (const s of run.sc.segments) { const est = numericEstimate(run, "price_sensitivity", s.id); if (est !== undefined) price[s.id] = est; }

  // With the final report in hand the end state is read, not forecast. Before it, levers are still ramping up, so
  // last cycle's reading understates the end state: carry the trend forward once.
  const settled = run.reports.length >= c;
  const last = run.reports[(settled ? c : c - 1) - 1]?.observed;
  const before = settled ? undefined : run.reports[c - 3]?.observed;
  const ahead = (metric: string, fallback: number): number => {
    const now = last?.[metric];
    if (now === undefined) return fallback;
    const prev = before?.[metric] ?? now;
    return now + Math.max(0, now - prev);
  };
  const placed = run.sc.segments.find((s) => s.id === run.sc.engine.post_placement_segment)!;
  let returnRate = ahead("return_30d", baselineReturn(run));
  if (settled) returnRate = pooledReturn(run, c, returnRate);
  return {
    attributionGap: Math.min(0.95, Math.max(0, gap)),
    priceSensitivity: price,
    engagement: ahead("post_placement_engagement", run.sc.engine.post_placement_engagement_per_return * placed.baseline.return_30d),
    returnRate,
  };
}

/**
 * The last cycle's 30-day return from everything the player has: the dashboard's number and the rest-of-base read of
 * any cohort holdout run in that cycle, each weighted by its own precision. (The withheld cohort says what the work did;
 * the value of staying free rests on what the whole base retains, so the rest-of-base read is the one that counts here.)
 */
function pooledReturn(run: Run, c: number, dashboard: number): number {
  const share = run.sc.metrics.find((m) => m.id === "return_30d")?.noise_scale ?? 1;
  const cohorts = run.tests.flatMap((t) => (t.cycle === c && t.cohorts ? [{ v: t.cohorts.rest, sd: t.cohorts.restSd }] : []));
  if (!cohorts.length) return dashboard;
  const reads = [{ v: dashboard, sd: noiseSd(run, run.reports[c - 1]!.instrumentationLevel) * share }, ...cohorts];
  let sum = 0, weight = 0;
  for (const r of reads) { const w = 1 / Math.max(r.sd * r.v, 1e-4) ** 2; sum += w * r.v; weight += w; }
  return sum / weight;
}
