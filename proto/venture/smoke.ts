import { newState, newWorld, playQuarter, type Decision } from "./model.ts";
import { CASES } from "./cases.ts";
for (const cs of CASES) {
  const w = newWorld(cs, 1);
  let s = newState(cs);
  console.log(`\n${cs.title}  event ${w.event.id}`);
  for (let q = 1; q <= 4; q++) {
    const d: Decision = { roadmap: [], reserve: { rel: 0.05, debt: 0.05 }, pace: "steady", research: 0.5, instrument: 0.5 };
    const { s: n, r } = playQuarter(w, s, d); s = n;
    console.log(`Q${q} rev ${r.revenue.toFixed(0)} cost ${(r.varCost + r.stageCost + r.team + r.marketing).toFixed(0)} profit ${r.profit.toFixed(0)} cash ${r.cash.toFixed(0)}  cap eng ${r.cap.eng.toFixed(0)} road ${r.cap.road.toFixed(0)} D ${r.D.toFixed(0)} R ${r.R.toFixed(0)} U ${r.U.toFixed(0)} M ${r.M.toFixed(0)} inc ${r.incidents} ev ${r.event ? r.event.id + " abs " + r.event.absorbed.toFixed(2) : "-"}`);
  }
}
