// PROTOTYPE. What each item is worth in each world, against what a manager could guess before learning anything.
// Usage: node proto/venture/items.ts [caseIndex] [seeds]
import { CASES } from "./cases.ts";
import { guess } from "./bots.ts";
import { newState, newWorld, valueOf } from "./model.ts";

const cs = CASES[Number(process.argv[2] ?? 0)]!, n = Number(process.argv[3] ?? 60);
const s = newState(cs);
console.log(`${cs.title}: value in lakh over the year played and the year after (true world), against the guess at the briefing's figures`);
console.log("item".padEnd(20) + "eng".padStart(5) + "guess".padStart(8) + "mean".padStart(8) + "sd".padStart(7) + "min".padStart(8) + "max".padStart(8) + "P(<0)".padStart(7) + "  per-week(guess)");
for (const i of cs.inits) {
  const tv: number[] = [];
  for (let seed = 1; seed <= n; seed++) { const w = newWorld(cs, seed); tv.push(valueOf({ ...w, expected: { effect: "true", overrun: 1 } }, s, i.id)); }
  const m = tv.reduce((t, x) => t + x, 0) / n, sd = Math.sqrt(tv.reduce((t, x) => t + (x - m) ** 2, 0) / n);
  const g = guess(newWorld(cs, 1), s, i.id);
  console.log(i.id.padEnd(20) + String(i.eng).padStart(5) + g.toFixed(0).padStart(8) + m.toFixed(0).padStart(8) + sd.toFixed(0).padStart(7) + Math.min(...tv).toFixed(0).padStart(8) + Math.max(...tv).toFixed(0).padStart(8) + (tv.filter((x) => x < 0).length / n).toFixed(2).padStart(7) + "  " + (g / i.eng).toFixed(1));
}
