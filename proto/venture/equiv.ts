// PROTOTYPE. Does the engine in src/venture, reading the scenario files, score exactly as this prototype does?
// Usage: node proto/venture/equiv.ts [seeds]
import { join } from "node:path";
import { CASES } from "./cases.ts";
import { BOTS as PBOTS, doNothing as pIdle, oracle as pOracle } from "./bots.ts";
import { newWorld as pWorld } from "./model.ts";
import { playRun as pPlay } from "./play.ts";
import { scoreRun as pScore } from "./score.ts";
import { loadVentureDir } from "../../src/venture/load.ts";
import { BOTS } from "../../src/venture/bots.ts";
import { playPolicy } from "../../src/venture/run.ts";
import { scoreRun } from "../../src/venture/score.ts";

const n = Number(process.argv[2] ?? 8) || 8;
// Only the cases the prototype had (the two product-manager cases) have anything to compare against; the others were written for the engine.
const scs = loadVentureDir(join(import.meta.dirname, "..", "..", "scenarios")).filter((sc) => CASES.some((c) => c.id === sc.id));
let worst = 0;
scs.forEach((sc) => {
  const cs = CASES.find((c) => c.id === sc.id)!;
  for (const b of BOTS.filter((x) => x.id !== "oracle")) {
    const pb = PBOTS.find((x) => x.id === b.id)!;
    let sumDiff = 0;
    for (let seed = 1; seed <= n; seed++) {
      const run = playPolicy(sc, seed, b.bot, b.id), base = playPolicy(sc, seed, BOTS[0]!.bot, "do_nothing"), orc = playPolicy(sc, seed, BOTS.find((x) => x.id === "oracle")!.bot, "oracle");
      const ours = scoreRun(run, base, orc).total;
      const w = pWorld(cs, seed);
      const theirs = pScore(pPlay(w, pb.bot, b.id), pPlay(w, pIdle, "do_nothing"), pPlay(w, pOracle, "oracle")).total;
      sumDiff = Math.max(sumDiff, Math.abs(ours - theirs));
    }
    worst = Math.max(worst, sumDiff);
    console.log(`${sc.title.padEnd(20)} ${b.id.padEnd(16)} largest difference in score over ${n} worlds: ${sumDiff.toFixed(4)}`);
  }
});
console.log(`worst ${worst.toFixed(4)}`);
