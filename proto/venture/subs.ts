// PROTOTYPE. Which sub-criteria each scripted manager earns, as the share of worlds at full / part / none (na in brackets).
// Usage: node proto/venture/subs.ts [caseIndex] [seeds]
import { CASES } from "./cases.ts";
import { BOTS, doNothing, oracle } from "./bots.ts";
import { newWorld } from "./model.ts";
import { playRun } from "./play.ts";
import { scoreRun } from "./score.ts";

const cs = CASES[Number(process.argv[2] ?? 0)]!, n = Number(process.argv[3] ?? 30);
const table: Record<string, Record<string, Record<string, number>>> = {};
for (const b of BOTS) {
  table[b.id] = {};
  for (let seed = 1; seed <= n; seed++) {
    const w = newWorld(cs, seed), base = playRun(w, doNothing, "do_nothing"), sc = scoreRun(playRun(w, b.bot, b.id), base, playRun(w, oracle, "oracle"));
    for (const d of sc.dims) for (const s of d.subs) { const t = (table[b.id]![s.id] ??= { full: 0, part: 0, none: 0, na: 0 }); t[s.level]!++; }
  }
}
console.log(`${cs.title}, ${n} worlds. Each cell: full/part/none (na)`);
const ids = Object.keys(table["evidence_led"]!);
console.log("".padEnd(26) + BOTS.slice(1).map((b) => b.id.slice(0, 14).padStart(16)).join(""));
for (const id of ids) {
  console.log(id.padEnd(26) + BOTS.slice(1).map((b) => { const t = table[b.id]![id]!; return `${t.full}/${t.part}/${t.none}${t.na ? `(${t.na})` : ""}`.padStart(16); }).join(""));
}
