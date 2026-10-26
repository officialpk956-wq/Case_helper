// PROTOTYPE. How the scripted managers would score under other weightings of the same sub-criteria, without changing play.
// Usage: node proto/venture/whatif.ts [seeds] [--from firstSeed]
import { CASES } from "./cases.ts";
import { BOTS, doNothing, oracle } from "./bots.ts";
import { newWorld } from "./model.ts";
import { playRun } from "./play.ts";
import { scoreRun } from "./score.ts";
import type { Score } from "./score.ts";

const n = Number(process.argv[2] ?? 40) || 40, from = Number(process.argv[process.argv.indexOf("--from") + 1]) || 1;
const mean = (xs: number[]): number => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);

/** A rubric: a weight for each dimension, and an extra multiplier for named sub-criteria. */
interface Rubric { name: string; dims: Record<string, number>; subs: Record<string, number> }
// The weights the rubric had when this comparison was made. DIMS now holds option D, which this file recommended and the owner adopted.
const CURRENT = { strategy: 15, evidence: 15, delivery: 15, stewardship: 15, leadership: 15, adapt: 10, value: 15 };
const RUBRICS: Rubric[] = [
  { name: "A: as first written", dims: CURRENT, subs: {} },
  { name: "B: more weight on strategy and evidence (20,20,15,10,10,10,15)", dims: { strategy: 20, evidence: 20, delivery: 15, stewardship: 10, leadership: 10, adapt: 10, value: 15 }, subs: {} },
  { name: "C: outcome and judgement sub-criteria count double", dims: CURRENT, subs: { value_created: 2, delivered_vs_best: 2, priority_alignment: 2, diagnosis: 2, plan_choice: 2, learned_before_bets: 2 } },
  { name: "D: B and C together (adopted)", dims: { strategy: 20, evidence: 20, delivery: 15, stewardship: 10, leadership: 10, adapt: 10, value: 15 }, subs: { value_created: 2, delivered_vs_best: 2, priority_alignment: 2, diagnosis: 2, plan_choice: 2, learned_before_bets: 2 } },
];

function rescore(sc: Score, r: Rubric): number {
  let earned = 0, earnable = 0;
  for (const d of sc.dims) {
    const per = (r.dims[d.id] ?? 0) / d.subs.length;
    for (const s of d.subs) {
      if (s.level === "na") continue;
      const w = per * (r.subs[s.id] ?? 1);
      earnable += w; earned += w * (s.level === "full" ? 1 : s.level === "part" ? 0.5 : 0);
    }
  }
  return earnable > 0 ? (100 * earned) / earnable : 0;
}

for (const cs of CASES) {
  console.log(`\n=== ${cs.title}: score of each manager under other weightings, seeds ${from}-${from + n - 1} (before modifiers) ===`);
  const rows: Record<string, number[][]> = {};
  for (const b of BOTS) {
    rows[b.id] = RUBRICS.map(() => []);
    for (let seed = from; seed < from + n; seed++) {
      const w = newWorld(cs, seed), sc = scoreRun(playRun(w, b.bot, b.id), playRun(w, doNothing, "do_nothing"), playRun(w, oracle, "oracle"));
      RUBRICS.forEach((r, k) => rows[b.id]![k]!.push(sc.idle ? 0 : rescore(sc, r)));
    }
  }
  console.log("".padEnd(16) + RUBRICS.map((r) => r.name.slice(0, 2).padStart(9)).join(""));
  for (const b of BOTS) console.log(b.id.padEnd(16) + rows[b.id]!.map((xs) => mean(xs).toFixed(1).padStart(9)).join(""));
}
console.log("\n" + RUBRICS.map((r) => r.name).join("\n"));
