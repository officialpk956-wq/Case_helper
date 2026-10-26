// PROTOTYPE. What one manager did, quarter by quarter, in one world.
// Usage: node proto/venture/trace.ts <caseIndex> <bot> <seed>
import { CASES } from "./cases.ts";
import { BOTS, doNothing, oracle, referencePolicy } from "./bots.ts";
import { newWorld, outlook } from "./model.ts";
import { playRun } from "./play.ts";
import { scoreRun } from "./score.ts";

const cs = CASES[Number(process.argv[2] ?? 0)]!, id = process.argv[3] ?? "evidence_led", seed = Number(process.argv[4] ?? 1);
const w = newWorld(cs, seed), bot = BOTS.find((b) => b.id === id)!;
const run = playRun(w, bot.bot, id), base = playRun(w, doNothing, "do_nothing");
console.log(`${cs.title}, ${id}, seed ${seed}; event ${w.event.id}; hidden ${JSON.stringify(Object.fromEntries(Object.entries(w.hidden).map(([k, v]) => [k, Math.round(v * 100) / 100])))}`);
for (const [k, x] of run.qs.entries()) {
  const r = x.r;
  console.log(`Q${k + 1} ${x.d.pace} reserve ${x.d.reserve.rel.toFixed(2)}/${x.d.reserve.debt.toFixed(2)} road ${r.cap.road.toFixed(0)} used ${r.engUsed.toFixed(0)} | roadmap ${x.d.roadmap.join(",") || "-"} | done ${r.completed.join(",") || "-"} | blocked ${Object.keys(r.blocked).join(",") || "-"} | tests ${r.readings.tested.join(",") || "-"} dives ${r.readings.dived.join(",") || "-"}`);
  console.log(`   revenue ${r.revenue.toFixed(0)} profit ${r.profit.toFixed(0)} (idle ${base.qs[k]!.r.profit.toFixed(0)}) cash ${r.cash.toFixed(0)} | D ${r.D.toFixed(0)} R ${r.R.toFixed(0)} U ${r.U.toFixed(0)} M ${r.M.toFixed(0)} inc ${r.incidents} lam ${r.lambda.toFixed(2)} | trust ${Object.values(r.trust).map((t) => t.toFixed(0)).join("/")}${r.event ? ` | event absorbed ${(r.event.absorbed * 100).toFixed(0)}%` : ""}`);
}
const sc = scoreRun(run, base, playRun(w, oracle, "oracle"));
console.log(`outlook ${outlook(w, run.end, referencePolicy).toFixed(0)} vs idle ${outlook(w, base.end, referencePolicy).toFixed(0)}; score ${sc.total.toFixed(1)}`);
for (const m of sc.modifiers) console.log(`  modifier ${m.id} ${m.pts}: ${m.why}`);
for (const d of sc.dims) { console.log(`  ${d.name} ${d.score === null ? "n/a" : Math.round(d.score * 100)}`); for (const s of d.subs) console.log(`     ${s.level.padEnd(5)} ${s.id}: ${s.note}`); }
