// Does the rubric separate good play from bad?  node src/calibrate.ts [--scenario file] [--seeds 200] [--explain bot [seed]]
// With no --scenario it calibrates every case in scenarios/ (retention cases, *.scenario.json, and venture cases, *.venture.json), one after another, and fails if any does.
// For a venture case, --seeds sets the number of worlds and --from the first seed.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BOTS } from "./bots.ts";
import { briefingOf, loadScenario, playRun, replay } from "./play.ts";
import { newRun } from "./engine.ts";
import { runScore, bandOf } from "./score.ts";
import type { Run } from "./types.ts";
import { calibrateVenture } from "./venture/calibrate.ts";
import { loadVenture } from "./venture/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string, dflt?: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? dflt) : dflt; };
if (!args.includes("--scenario") && !args.includes("--explain")) {
  const dir = join(here, "..", "scenarios");
  let failed = false;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".scenario.json") || x.endsWith(".venture.json")).sort()) {
    failed = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--scenario", join(dir, f), ...args], { stdio: "inherit" }).status !== 0 || failed;
  }
  process.exit(failed ? 1 : 0);
}
const file = flag("--scenario") ?? join(here, "..", "scenarios", "retention-after-the-search.scenario.json");
if (file.endsWith(".venture.json")) {
  const sc = loadVenture(file);
  const out = calibrateVenture(sc, { ...(flag("--seeds") ? { seeds: Number(flag("--seeds")) } : {}), ...(flag("--from") ? { from: Number(flag("--from")) } : {}) });
  console.log(out.lines.join("\n"));
  process.exit(out.failures ? 1 : 0);
}
const seeds = Number(flag("--seeds", "200"));
const sc = loadScenario(file);

const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const q = (v: number[], p: number): number => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))]!;
const f1 = (v: number): string => v.toFixed(1).padStart(5);

if (args.includes("--explain")) {
  const name = flag("--explain")!, seed = Number(args[args.indexOf("--explain") + 2] ?? 1);
  const run = playRun(sc, seed, BOTS[name]!);
  console.log(`${name}, seed ${seed}, event ${run.eventId}, run score ${runScore(run).toFixed(1)} (${bandOf(run, runScore(run))})`);
  for (const s of run.scores) {
    console.log(`\nCycle ${s.cycle}: traits ${s.traitTotal.toFixed(1)}  modifiers ${s.modifierTotal >= 0 ? "+" : ""}${s.modifierTotal}  final ${s.final.toFixed(1)} ${s.band}`);
    for (const t of s.traits) for (const sub of t.subs) console.log(`   ${sub.level.padEnd(4)} ${sub.points.toFixed(2).padStart(5)}/${sub.maxPoints.toFixed(2)}  ${t.name} / ${sub.label}  ${sub.evidence}`);
    for (const m of s.modifiers) console.log(`   MOD ${String(m.points).padStart(3)}  ${m.why}`);
  }
  process.exit(0);
}

const names = Object.keys(BOTS);
const runs: Record<string, Run[]> = {};
for (const n of names) runs[n] = Array.from({ length: seeds }, (_, i) => playRun(sc, i + 1, BOTS[n]!));
const scores: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, runs[n]!.map(runScore)]));

const expected = Object.fromEntries(sc.calibration.bots.map((b) => [b.id, b.expected_final]));
let failures = 0;
const outOfRange: string[] = [];
const bad = (m: string): void => { failures++; console.log(`  FAIL ${m}`); };

console.log(`\n${sc.title}: ${seeds} seeds per bot\n`);
console.log("bot                   expected      mean   p10   p90   min   max  in range   band");
for (const n of names) {
  const s = scores[n]!, e = expected[n];
  const m = mean(s);
  const inside = e ? s.filter((v) => v >= e.min && v <= e.max).length / s.length : NaN;
  const ok = e ? m >= e.min && m <= e.max : true;
  console.log(`${n.padEnd(21)} ${e ? `${e.min}-${e.max}`.padEnd(9) : "n/a".padEnd(9)} ${f1(m)} ${f1(q(s, 0.1))} ${f1(q(s, 0.9))} ${f1(Math.min(...s))} ${f1(Math.max(...s))}  ${(e ? `${Math.round(inside * 100)}%` : "-").padStart(7)}   ${bandOf(runs[n]![0]!, m)}${ok ? "" : "   <- mean outside expected range"}`);
  if (!ok) outOfRange.push(`${n}: mean ${m.toFixed(1)} is outside the expected ${e!.min}-${e!.max}`);
}

console.log("\nWhere the points come from (mean % of the points available in each trait, over applicable cycles):");
const traitIds = sc.rubric.traits.map((t) => t.id);
console.log(`${"bot".padEnd(21)} ${traitIds.map((t) => t.slice(0, 8).padStart(9)).join("")}`);
for (const n of names) {
  const cells = traitIds.map((id) => {
    let got = 0, can = 0;
    for (const r of runs[n]!) for (const s of r.scores) { const t = s.traits.find((x) => x.id === id)!; got += t.points; can += t.applicableWeight; }
    return can ? `${Math.round((100 * got) / can)}%`.padStart(9) : "      n/a";
  });
  console.log(`${n.padEnd(21)} ${cells.join("")}`);
}

console.log("\nRule coverage across all bot runs (a rule that never reaches full, part and none, or a modifier that never fires, is dead weight):");
const seenLevel: Record<string, Set<string>> = {}, fired: Record<string, number> = {};
for (const n of names) for (const r of runs[n]!) for (const s of r.scores) {
  for (const t of s.traits) for (const sub of t.subs) (seenLevel[sub.id] ??= new Set()).add(sub.level);
  for (const m of s.modifiers) fired[m.id] = (fired[m.id] ?? 0) + 1;
}
const dead: string[] = [];
for (const t of sc.rubric.traits) for (const sub of t.subcriteria) {
  const lv = seenLevel[sub.id] ?? new Set<string>();
  const missing = ["full", "part", "none"].filter((l) => !lv.has(l));
  if (missing.length) dead.push(sub.id + " never reaches " + missing.join("/"));
}
for (const m of sc.rubric.modifiers) if (!fired[m.id]) dead.push("modifier " + m.id + " never fires");
console.log(dead.length ? dead.map((d) => "  note " + d).join("\n") : "  every sub-criterion reaches full, part and none, and every modifier fires");

console.log("\nInvariants:");
// 1. Inaction and form-filling must not score.
for (const n of ["do_nothing", "lazy_filler"]) {
  const worst = Math.max(...scores[n]!);
  if (worst >= 40) bad(`${n} reached ${worst.toFixed(1)} (must stay in the Poor band, below 40)`); else console.log(`  ok   ${n} never leaves Poor (worst ${worst.toFixed(1)})`);
}
// 2. Measurement luck: one fixed world, identical decisions, different seeds.
for (const n of ["insight_first", "framework_first"]) {
  // One world: the case as written, and the market event the base run met. Only the measurement noise changes.
  const base = playRun(sc, 1, BOTS[n]!, { vary: false });
  const sameWorld = Array.from({ length: seeds }, (_, i) => i + 1).filter((s) => newRun(sc, s, { vary: false }).eventId === base.eventId);
  const spread = sameWorld.map((s) => runScore(replay(sc, s, base.decisions, { vary: false, briefing: briefingOf(base) })));
  const range = Math.max(...spread) - Math.min(...spread);
  if (range > 8) bad(n + ": in one world the same decisions swing " + range.toFixed(1) + " points across seeds (limit 8)"); else console.log("  ok   " + n + ": in one world the same decisions swing only " + range.toFixed(1) + " points across seeds");
}
// 2b. Evidence-driven play has to hold up in every world.
const worlds = q(scores.insight_first!, 0.9) - q(scores.insight_first!, 0.1);
if (worlds > 12) bad("insight_first spreads " + worlds.toFixed(1) + " points from p10 to p90 across worlds (limit 12)"); else console.log("  ok   insight_first spreads only " + worlds.toFixed(1) + " points from p10 to p90 across worlds");
// 2c. Reported, not asserted: how much an answer key written for the base world loses when the world changes.
for (const n of ["answer_key_guesser", "insight_first"]) {
  const inBase = mean(Array.from({ length: seeds }, (_, i) => runScore(playRun(sc, i + 1, BOTS[n]!, { vary: false }))));
  const inWorlds = mean(scores[n]!);
  console.log("  info " + n + ": " + inBase.toFixed(1) + " in the world it was written for, " + inWorlds.toFixed(1) + " across varied worlds (loses " + (inBase - inWorlds).toFixed(1) + ")");
}
// 3. The arithmetic.
const weights = sc.rubric.traits.reduce((a, t) => a + t.weight, 0);
if (weights !== 100) bad(`trait weights sum to ${weights}`); else console.log("  ok   trait weights sum to 100");
let arithmetic = true;
for (const n of names) for (const r of runs[n]!) for (const s of r.scores) if (Math.abs(s.final - Math.min(100, Math.max(0, s.traitTotal + s.modifierTotal))) > 1e-9) arithmetic = false;
if (!arithmetic) bad("final != trait_total + modifier_total somewhere"); else console.log("  ok   final = trait_total + modifier_total in every cycle of every run");
// 4. Good play beats the textbook approach by a clear margin.
const gap = mean(scores.insight_first!) - mean(scores.framework_first!);
if (gap < 15) bad(`insight_first beats framework_first by only ${gap.toFixed(1)} (need 15)`); else console.log(`  ok   insight_first beats framework_first by ${gap.toFixed(1)} points`);

for (const m of outOfRange) bad("expectation not met: " + m);
console.log(failures ? "\n" + failures + " check(s) failed." : "\nAll invariants and expectations hold.");
process.exit(failures ? 1 : 0);
