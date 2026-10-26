// Does the venture rubric separate good play from bad?  Called by src/calibrate.ts for a *.venture.json file.
// Seven scripted managers play many worlds. Their mean score has to land in the range the scenario expects of them, and a few things
// have to hold whatever the ranges say: doing nothing scores nothing, the numbers add up, a replay reproduces the game, and evidence-led
// play beats the textbook approach by a clear margin.
import { BOTS } from "./bots.ts";
import { doNothing, oracle } from "./planner.ts";
import { outlook } from "./model.ts";
import { referencePolicy } from "./planner.ts";
import { playPolicy, replay } from "./run.ts";
import type { Run } from "./run.ts";
import { SUBS, scoreRun } from "./score.ts";
import type { Score } from "./score.ts";
import { bandOf } from "./view.ts";
import type { VentureScenario } from "./types.ts";

const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
const f1 = (v: number, w = 5): string => v.toFixed(1).padStart(w);
const f0 = (v: number, w = 6): string => v.toFixed(0).padStart(w);

export interface Outcome { failures: number; lines: string[] }

export function calibrateVenture(sc: VentureScenario, opts: { seeds?: number; from?: number } = {}): Outcome {
  const seeds = opts.seeds ?? sc.calibration.seeds, from = opts.from ?? 1;
  const lines: string[] = [];
  let failures = 0;
  const say = (s = ""): void => { lines.push(s); };
  const bad = (m: string): void => { failures++; say(`  FAIL ${m}`); };

  const scores: Record<string, Score[]> = {}, gain: Record<string, number[]> = {}, left: Record<string, number[]> = {};
  const runs: Record<string, Run[]> = {};
  for (const b of BOTS) { scores[b.id] = []; gain[b.id] = []; left[b.id] = []; runs[b.id] = []; }
  for (let seed = from; seed < from + seeds; seed++) {
    const base = playPolicy(sc, seed, doNothing, "do_nothing"), bench = playPolicy(sc, seed, oracle, "oracle");
    const baseLeft = outlook(base.w, base.end, referencePolicy), baseProfit = base.qs.reduce((t, q) => t + q.r.profit, 0);
    for (const b of BOTS) {
      const run = b.id === "do_nothing" ? base : b.id === "oracle" ? bench : playPolicy(sc, seed, b.bot, b.id);
      runs[b.id]!.push(run);
      scores[b.id]!.push(scoreRun(run, base, bench));
      gain[b.id]!.push(run.qs.reduce((t, q) => t + q.r.profit, 0) - baseProfit);
      left[b.id]!.push(outlook(run.w, run.end, referencePolicy) - baseLeft);
    }
  }

  const expected = Object.fromEntries(sc.calibration.bots.map((b) => [b.id, b]));
  const outOfRange: string[] = [];
  say(`\n${sc.title}: ${seeds} worlds per bot (seeds ${from} to ${from + seeds - 1})\n`);
  say("bot                  expected     mean   min   max   profit vs idle  next year vs idle   band");
  for (const b of BOTS) {
    const totals = scores[b.id]!.map((s) => s.total), m = mean(totals), e = expected[b.id]?.expected_final;
    const ok = e ? m >= e.min && m <= e.max : true;
    say(`${b.id.padEnd(20)} ${(e ? `${e.min}-${e.max}` : "bench").padEnd(10)} ${f1(m)} ${f1(Math.min(...totals))} ${f1(Math.max(...totals))}  ${f0(mean(gain[b.id]!), 9)} L  ${f0(mean(left[b.id]!), 12)} L   ${bandOf(sc, m)}${ok ? "" : "   <- mean outside the expected range"}`);
    if (!ok) outOfRange.push(`${b.id}: mean ${m.toFixed(1)} is outside the expected ${e!.min}-${e!.max}`);
  }
  if (sc.calibration.min_gap) say(`
The gap between evidence-led and textbook play was set below the default of 25: ${sc.calibration.min_gap.gap}. ${sc.calibration.min_gap.why}`);
  const revised = sc.calibration.bots.filter((b) => b.revised);
  if (revised.length) {
    say("\nRanges revised after seeing results (the range as first written, and why):");
    for (const b of revised) say(`  ${b.id}: first ${b.revised!.min}-${b.revised!.max}, now ${b.expected_final.min}-${b.expected_final.max}. ${b.revised!.why}`);
  }

  say("\nWhere the points come from (mean share of what could be earned, by dimension):");
  const dimIds = sc.rubric.dimensions.map((d) => d.id);
  say(`${"bot".padEnd(20)} ${dimIds.map((d) => d.slice(0, 9).padStart(10)).join("")}`);
  for (const b of BOTS) say(`${b.id.padEnd(20)} ${dimIds.map((id) => f0(100 * mean(scores[b.id]!.map((s) => s.dims.find((d) => d.id === id)!.score ?? 0)), 10)).join("")}`);

  say("\nSub-criteria that every bot gets the same level on (dead weight for telling these bots apart):");
  const flat: string[] = [];
  for (const sub of SUBS) {
    const levels = new Set<string>();
    for (const b of BOTS) for (const s of scores[b.id]!) levels.add(s.dims.flatMap((d) => d.subs).find((x) => x.id === sub.id)!.level);
    if (levels.size < 2) flat.push(`${sub.id} is always ${[...levels][0]}`);
  }
  say(flat.length ? flat.map((x) => "  note " + x).join("\n") : "  every sub-criterion takes at least two different levels across the bots");

  say("\nInvariants:");
  const idle = scores.do_nothing!.map((s) => s.total);
  if (Math.max(...idle) > 0) bad(`do_nothing scored up to ${Math.max(...idle).toFixed(1)} (inaction must score 0)`); else say("  ok   doing nothing scores 0 in every world");
  const weights = sc.rubric.dimensions.reduce((a, d) => a + d.weight, 0);
  if (Math.abs(weights - 100) > 1e-9) bad(`dimension weights sum to ${weights}`); else say("  ok   dimension weights sum to 100");
  let arithmetic = true;
  for (const b of BOTS) for (const s of scores[b.id]!) if (Math.abs(s.total - Math.min(100, Math.max(0, s.base + s.modifiers.reduce((t, m) => t + m.pts, 0)))) > 1e-9) arithmetic = false;
  if (!arithmetic) bad("score != clamp(base + modifiers) somewhere"); else say("  ok   score = clamp(sub-criteria + modifiers) in every game of every bot");
  // A replay of a bot's decisions in the same world must give the same game.
  let same = true;
  for (const id of ["evidence_led", "textbook", "random"]) {
    const run = runs[id]![0]!, again = replay(sc, run.w.seed, run.qs.map((q) => q.d));
    if (JSON.stringify(again.qs.map((q) => q.r)) !== JSON.stringify(run.qs.map((q) => q.r))) same = false;
  }
  if (!same) bad("replaying the decisions did not reproduce the game"); else say("  ok   replaying a bot's decisions in its world reproduces the game exactly");
  const gap = mean(scores.evidence_led!.map((s) => s.total)) - mean(scores.textbook!.map((s) => s.total));
  const need = sc.calibration.min_gap?.gap ?? 25;
  if (gap < need) bad(`evidence_led beats textbook by only ${gap.toFixed(1)} (need ${need})`); else say(`  ok   evidence-led play beats the textbook approach by ${gap.toFixed(1)} points (need ${need})`);
  const order = ["do_nothing", "feature_factory", "random", "textbook", "evidence_led"].map((id) => mean(scores[id]!.map((s) => s.total)));
  if (order.some((v, i) => i && v < order[i - 1]! - 1e-9)) bad("the order do_nothing < feature_factory < random < textbook < evidence_led does not hold"); else say("  ok   do_nothing < feature_factory < random < textbook < evidence_led");

  for (const m of outOfRange) bad("expectation not met: " + m);
  say(failures ? `\n${failures} check(s) failed.` : "\nAll invariants and expectations hold.");
  return { failures, lines };
}
