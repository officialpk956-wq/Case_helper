// What a player sees before locking a quarter: what is predictable, as numbers, and what is not, as a range.
// Predictable: how many weeks there are, what each item needs, what fits, what is blocked and why, the money lines at the briefing's
// figures. Uncertain: how big the effects will really be, how far the work will overrun, whether an incident strikes. The range is that
// uncertainty only. It never uses a hidden fact's true value, so it cannot tell a player more than the briefing and their own deep dives.
import { hash } from "../rng.ts";
import { clamp, idleDecision, itemOf, newWorld, overrun, playQuarter, projection } from "./model.ts";
import type { Capacity, Decision, Report, World } from "./model.ts";
import type { Run } from "./run.ts";
import { lc, termsOf } from "./types.ts";

export type ItemStatus = "ships" | "at risk" | "does not fit" | "blocked";
export interface PreviewItem { id: string; status: ItemStatus; why: string | null; weeksStillNeeded: number; weeksIfSlow: number }
export interface Preview {
  capacity: Pick<Capacity, "eng" | "road" | "design" | "analyst" | "vD" | "vM" | "reserveRel" | "reserveDebt" | "contractors">;
  /** Weeks of the roadmap the funded items would take at the expected overrun, against the weeks available. */
  roadmapWeeks: { needed: number; have: number };
  analystWeeks: { used: number; have: number };
  designWeeks: { free: number; research: number; polish: number };
  items: PreviewItem[];
  /** Experiments and deep dives asked for that would not run, and why. */
  skipped: { id: string; kind: "experiment" | "dive"; why: string }[];
  money: { revenue: number; costs: number; profit: number; holdProfit: number; low: number; high: number; cashAfter: number };
  after: { customers: number; D: number; R: number; U: number; M: number; incidents: number };
  notes: string[];
}

const SAMPLES = 40;
const SAMPLE_QUANTILE = 0.1;

/** Worlds that differ from this one in everything a player is rightly unsure of, and agree with what they know about hidden facts. */
function sampleWorlds(run: Run): World[] {
  const known = run.end.known, sc = run.w.cs;
  return Array.from({ length: SAMPLES }, (_, k) => {
    // Seeded by the scenario and the quarter, never by this run's seed: the preview must not be a function of the world it is about.
    const w = newWorld(sc, hash(`${sc.id}|preview|${run.end.q}|${k}`));
    return { ...w, hidden: Object.fromEntries(sc.hidden.map((f) => [f.id, known[f.id] ?? f.brief])) };
  });
}

const costsOf = (r: Report): number => r.revenue - r.profit;

export function preview(run: Run, d: Decision): Preview {
  const s = run.end, sc = run.w.cs, T = termsOf(sc);
  const { r, status } = projection(run.w, s, d, s.known);
  const hold = projection(run.w, s, { ...idleDecision(), pace: d.pace, reserve: d.reserve }, s.known).r;
  const profits = sampleWorlds(run).map((w) => playQuarter(w, s, d, { evQ: 99 }).r.profit).sort((a, b) => a - b);
  const at = (p: number): number => profits[clamp(Math.floor(p * profits.length), 0, profits.length - 1)]!;
  const items: PreviewItem[] = d.roadmap.filter((id) => !s.killed.includes(id) && s.live[id] === undefined).map((id) => {
    const i = itemOf(sc, id), o = overrun({ ...run.w, expected: { effect: 1, overrun: 1 } }, i, s, d), done = s.progress[id] ?? 0;
    return {
      id, status: status[id] ?? "blocked", why: r.blocked[id] ?? null,
      weeksStillNeeded: Math.max(0, o.actual - done), weeksIfSlow: Math.max(0, i.eng * (1 + o.mu + 0.84 * o.sigma) - done),
    };
  });
  const skipped: Preview["skipped"] = [
    ...(d.experiments ?? []).filter((id) => !r.readings.tested.includes(id)).map((id) => ({ id, kind: "experiment" as const, why: s.level < 1 ? "needs measurement level 1" : `not enough ${lc(T.data)} or ${lc(T.eng)} weeks left` })),
    ...(d.dives ?? []).filter((id) => !r.readings.dived.includes(id)).map((id) => ({ id, kind: "dive" as const, why: `not enough ${lc(T.data)} weeks left` })),
  ];
  const notes: string[] = [];
  for (const id of d.commit ?? []) {
    const it = items.find((x) => x.id === id);
    if (it && it.status !== "ships") notes.push(`You promised ${itemOf(sc, id).name}, and it is ${it.status === "blocked" ? "blocked" : it.status === "at risk" ? "at risk" : "not going to fit"} this quarter.`);
  }
  const needed = items.filter((x) => x.status !== "blocked").reduce((t, x) => t + x.weeksStillNeeded, 0);
  if (needed > r.cap.road * 1.15) notes.push("The roadmap asks for much more than the team can do. Work in progress stalls and nobody is happy about it.");
  if (s.q === 3) notes.push("The market event is not part of this preview.");
  return {
    capacity: { eng: r.cap.eng, road: r.cap.road, design: r.cap.design, analyst: r.cap.analyst, vD: r.cap.vD, vM: r.cap.vM, reserveRel: r.cap.reserveRel, reserveDebt: r.cap.reserveDebt, contractors: r.cap.contractors },
    roadmapWeeks: { needed, have: r.cap.road },
    analystWeeks: { used: r.analystUsed, have: r.cap.analyst },
    designWeeks: { free: r.designFree, research: r.researchWeeks, polish: r.polish },
    items, skipped,
    money: { revenue: r.revenue, costs: costsOf(r), profit: r.profit, holdProfit: hold.profit, low: at(SAMPLE_QUANTILE), high: at(1 - SAMPLE_QUANTILE), cashAfter: r.cash },
    after: { customers: Object.values(r.funnel).reduce((t, f) => t + f.end, 0), D: r.D, R: r.R, U: r.U, M: r.M, incidents: r.incidents },
    notes,
  };
}
