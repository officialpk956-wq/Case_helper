// PROTOTYPE. Runs every scripted manager through both product-manager cases and reports the scores.
// Usage: node proto/venture/run.ts [seeds] [--from firstSeed] [--example]
import { CASES } from "./cases.ts";
import { BOTS, doNothing, oracle, referencePolicy } from "./bots.ts";
import { newWorld, projection, newState, idleDecision, outlook } from "./model.ts";
import { playRun } from "./play.ts";
import { scoreRun } from "./score.ts";

// Written down before the first run. A bot that lands outside its range is reported, not quietly fixed.
// REVISED AFTER SEEING RESULTS: debt_first was 25-45. The first run put it at 60-65. The weights were changed (spec 5.6, option D) and
// the range was then revised to 45-55 at the owner's instruction.
// ALSO REVISED AFTER SEEING RESULTS, at the owner's instruction: random was 15-35 (observed 31.2-36.7 as a mean over 40 games, so now 30-40)
// and evidence_led was 65-90 (observed 91.6-92.9, so now 90-95). Both were written to fit what was observed, so landing inside them
// shows nothing about whether the original expectation was right. The ranges apply to a mean over 40 games; single games vary far more.
// feature_factory (20-40; 19.6 once), textbook (40-60) and do_nothing (0-5) are as first written.
export const PRIORS: Record<string, [number, number]> = {
  do_nothing: [0, 5], random: [30, 40], feature_factory: [20, 40], debt_first: [45, 55], textbook: [40, 60], evidence_led: [90, 95],
};

const n = Number(process.argv[2] ?? 40) || 40;
const from = Number(process.argv[process.argv.indexOf("--from") + 1]) || 1;
const mean = (xs: number[]): number => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);
const f = (x: number, k = 1): string => x.toFixed(k);

for (const cs of CASES) {
  console.log(`\n=== ${cs.title} (${cs.company}), ${n} worlds, seeds ${from}-${from + n - 1} ===`);
  const rows: string[] = [];
  const dimMeans: Record<string, Record<string, number[]>> = {};
  for (const b of BOTS) {
    const totals: number[] = [], profit: number[] = [], cash: number[] = [], cust: number[] = [], bases: number[] = [], ahead: number[] = [];
    dimMeans[b.id] = {};
    for (let seed = from; seed < from + n; seed++) {
      const w = newWorld(cs, seed);
      const base = playRun(w, doNothing, "do_nothing");
      const run = playRun(w, b.bot, b.id);
      const sc = scoreRun(run, base, playRun(w, oracle, "oracle"));
      totals.push(sc.total); bases.push(sc.base);
      profit.push(run.qs.reduce((t, x) => t + x.r.profit, 0) - base.qs.reduce((t, x) => t + x.r.profit, 0));
      cash.push(run.end.cash);
      ahead.push(outlook(w, run.end, referencePolicy) - outlook(w, base.end, referencePolicy));
      cust.push(Object.values(run.end.C).reduce((t, x) => t + x, 0));
      for (const d of sc.dims) (dimMeans[b.id]![d.id] ??= []).push(d.score === null ? 0 : d.score * 100);
    }
    const pr = PRIORS[b.id], m = mean(totals), inside = pr ? m >= pr[0] && m <= pr[1] : true;
    rows.push(`${b.id.padEnd(16)} score ${f(m).padStart(5)}  [${f(Math.min(...totals), 0).padStart(3)}-${f(Math.max(...totals), 0).padStart(3)}]  prior ${pr ? pr.join("-").padEnd(6) : "bench "} ${inside ? "ok     " : "OUTSIDE"}   profit vs idle ${f(mean(profit), 0).padStart(6)} L   next year vs idle (builder) ${f(mean(ahead), 0).padStart(6)} L   end cash ${f(mean(cash), 0).padStart(6)} L   customers ${f(mean(cust) / 1000, 0)}k`);
  }
  console.log(rows.join("\n"));
  console.log("\ndimension means (0-100)");
  const ids = Object.keys(dimMeans[BOTS[0]!.id]!);
  console.log("".padEnd(16) + ids.map((i) => i.slice(0, 9).padStart(10)).join(""));
  for (const b of BOTS) console.log(b.id.padEnd(16) + ids.map((i) => f(mean(dimMeans[b.id]![i]!), 0).padStart(10)).join(""));
}

if (process.argv.includes("--example")) {
  const cs = CASES[0]!, w = newWorld(cs, 1), s0 = newState(cs);
  console.log(`\n--- preview, quarter 1, evidence_led on seed 1 ---`);
  const run = playRun(w, BOTS.find((b) => b.id === "evidence_led")!.bot, "evidence_led");
  const d = run.qs[0]!.d;
  const p = projection(w, s0, d);
  console.log("decision", JSON.stringify({ priority: d.priority, roadmap: d.roadmap, reserve: d.reserve, pace: d.pace, experiments: d.experiments, dives: d.dives }));
  console.log("preview status", p.status, "capacity", p.r.cap.road.toFixed(1), "preview profit", p.r.profit.toFixed(0), "idle profit", projection(w, s0, idleDecision()).r.profit.toFixed(0));
  console.log("actual    ", run.qs[0]!.r.completed, "profit", run.qs[0]!.r.profit.toFixed(0));
  const sc = scoreRun(run, playRun(w, doNothing, "do_nothing"), playRun(w, oracle, "oracle"));
  console.log(`\nscore ${sc.total.toFixed(1)} (before modifiers ${sc.base.toFixed(1)}) ${sc.modifiers.map((m) => `${m.id} ${m.pts}`).join(", ")}`);
  for (const dm of sc.dims) { console.log(`${dm.name} (${dm.weight}): ${dm.score === null ? "n/a" : Math.round(dm.score * 100)}`); for (const s of dm.subs) console.log(`   ${s.level.padEnd(5)} ${s.id}: ${s.note}`); }
}
