// The quarter model of a venture scenario: capacity, delivery, effects, funnel, money, quality, people.
// Every equation here is written out in docs/venture-model-spec.md, section 3.
// Money is in rupees lakh (L). A quarter is 12 working weeks.
import { normal, uniform } from "../rng.ts";
import { lc, termsOf } from "./types.ts";
import type { Effect, Expectation, HiddenFact, Item, MarketEvent, Pace, Party, Priority, VentureScenario } from "./types.ts";

export { PRIORITIES } from "./types.ts";
export const W = 12;
/** What an item is worth is counted over the year played and the year the term sheet covers. */
export const HORIZON = 8;
/** Quarters in a game, and the one in which the market event arrives. */
export const QUARTERS = 4;
export const EVENT_QUARTER = 3;
export const OVERHEAD = 0.22;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** Independent lifts overlap: two 10% lifts give 19%. Works for negatives. */
export const combine = (xs: number[]): number => 1 - xs.reduce((p, x) => p * (1 - x), 1);

/** How hard the team is pushed: output, tech debt added per shipped item, morale per quarter, incident odds. */
export const PACE: Record<Pace, { out: number; debt: number; morale: number; incident: number; design: number }> = {
  relaxed: { out: 0.92, debt: 0.5, morale: 1, incident: 0.8, design: 1 },
  steady: { out: 1.0, debt: 1, morale: 0, incident: 1, design: 1 },
  push: { out: 1.1, debt: 1.5, morale: -5, incident: 1.35, design: 0.95 },
};

export const factOf = (cs: VentureScenario, id: string): HiddenFact => { const f = cs.hidden.find((x) => x.id === id); if (!f) throw new Error(`no hidden fact ${id}`); return f; };
export const briefOf = (cs: VentureScenario, id: string): number | undefined => cs.hidden.find((x) => x.id === id)?.brief;

export interface Decision {
  priority?: Priority;
  /** Items to fund this quarter, in priority order. */
  roadmap: string[];
  drop?: string[];
  reserve: { rel: number; debt: number };
  pace: Pace;
  /** Share of free design weeks spent on research; the rest is polish. */
  research: number;
  /** Share of free analyst weeks spent on instrumentation; the rest is unused. */
  instrument: number;
  experiments?: string[];
  dives?: string[];
  asks?: { marketing?: number; contractors?: number };
  /** What was promised to whom this quarter. */
  commit?: string[];
  event?: { evidence: boolean; reading: string; direction: string };
  /** The term-sheet choice, made in the last quarter. */
  plan?: string;
  reflection?: { root_cause: string; expected: Expectation };
}

/** Anything that plays a quarter: a bot, or the planner that scores a position. It sees the world only through the state and the scenario. */
export type Policy = (w: World, s: State) => Decision;

export interface State {
  q: number;
  C: Record<string, number>;
  D: number; R: number; U: number; M: number;
  trust: Record<Party, number>;
  cash: number;
  heads: { eng: number; newEng: number; design: number; data: number };
  incidentLoad: number;
  progress: Record<string, number>;
  live: Record<string, number>;
  killed: string[];
  level: number; instrWeeks: number;
  tested: Record<string, number>; dived: Record<string, number>;
  /** What the player has been shown: a hidden fact by name (after a deep dive), and an item's value (after an experiment). */
  known: Record<string, number>; read: Record<string, number>;
  eventSeen: boolean; eventAbsorbed: number;
}

export interface World {
  cs: VentureScenario; seed: number;
  mult: Record<string, number>;
  hidden: Record<string, number>;
  z: Record<string, number>;
  event: MarketEvent;
  /** Evaluate the expected case: effects at their mean (or, with "true", at this world's), overruns without noise, no random incidents. */
  expected?: { effect: number | "true"; overrun: number; /** Hidden facts as the player knows them, in place of the briefing's figures. */ hidden?: Record<string, number> };
}

export function newWorld(cs: VentureScenario, seed: number, opts: { vary?: boolean } = {}): World {
  const vary = opts.vary !== false;
  const sd = 0.45;
  const mult: Record<string, number> = {}, z: Record<string, number> = {}, hidden: Record<string, number> = {};
  for (const i of cs.items) {
    z[i.id] = vary ? normal(seed, "overrun", i.id) : 0;
    for (const s of cs.segments) mult[`${i.id}|${s.id}`] = vary ? Math.exp(sd * normal(seed, "effect", i.id, s.id) - (sd * sd) / 2) : 1;
  }
  for (const f of cs.hidden) { const [lo, hi] = f.range; hidden[f.id] = vary ? lo + (hi - lo) * uniform(seed, "hidden", f.id) : (lo + hi) / 2; }
  let r = uniform(seed, "event") * cs.events.reduce((t, e) => t + e.weight, 0);
  let event = cs.events[cs.events.length - 1]!;
  for (const e of cs.events) { r -= e.weight; if (r <= 0) { event = e; break; } }
  return { cs, seed, mult, hidden, z, event };
}

export function newState(cs: VentureScenario): State {
  return {
    q: 1, C: Object.fromEntries(cs.segments.map((s) => [s.id, s.customers])), D: cs.start.debt, R: cs.start.reliability, U: cs.start.usability, M: cs.start.morale,
    trust: { ...cs.start.trust }, cash: cs.start.cash, heads: { eng: cs.squad.eng, newEng: 0, design: cs.squad.design, data: cs.squad.data },
    incidentLoad: 0, progress: {}, live: {}, killed: [], level: cs.start.level, instrWeeks: cs.start.level >= 2 ? 14 : cs.start.level === 1 ? 6 : 0,
    tested: {}, dived: {}, known: {}, read: {}, eventSeen: false, eventAbsorbed: 0,
  };
}

export const itemOf = (cs: VentureScenario, id: string): Item => { const i = cs.items.find((x) => x.id === id); if (!i) throw new Error(`no item ${id}`); return i; };
export const isLive = (s: State, id: string): boolean => s.live[id] !== undefined;

// ---------- capacity ----------

export interface Capacity { eng: number; road: number; design: number; analyst: number; vD: number; vM: number; reserveRel: number; reserveDebt: number; contractors: number; contractorsPaid: number; approvals: { marketing: number; contractors: number } }

/** Share of an ask a team will grant, from how much it trusts the player. */
export const approval = (trust: number): number => clamp((trust - 35) / 45, 0, 1);

export function capacity(w: World, s: State, d: Decision): Capacity {
  const pace = PACE[d.pace];
  const vD = clamp(1.1 - 0.008 * s.D, 0.55, 1);
  const vM = 0.8 + (0.2 * s.M) / 100;
  const heads = s.heads.eng + 0.6 * s.heads.newEng;
  const apC = approval(s.trust.lead), apM = approval(s.trust.biz);
  const granted = (d.asks?.contractors ?? 0) * apC;
  const contractors = granted * 0.8;
  const eng = heads * W * (1 - OVERHEAD) * vD * vM * pace.out - s.incidentLoad + contractors;
  const rel = clamp(d.reserve.rel, 0, 0.25), debt = clamp(d.reserve.debt, 0, 0.25);
  const road = Math.max(0, eng) * (1 - rel - debt);
  const design = s.heads.design * W * 0.8 * vM * pace.design;
  const analyst = s.heads.data * W * 0.85;
  return { eng: Math.max(0, eng), road, design, analyst, vD, vM, reserveRel: rel, reserveDebt: debt, contractors, contractorsPaid: granted, approvals: { marketing: apM, contractors: apC } };
}

// ---------- delivery ----------

/** What the item really takes: its estimate, scaled by an overrun that is smaller and tighter the better it is understood. */
export function clarity(i: Item, s: State, d: Decision): number {
  const tested = s.tested[i.id] !== undefined || (d.experiments ?? []).includes(i.id) ? 0.4 : 0;
  return clamp(i.clar + tested + 0.3 * d.research, 0, 1);
}
export function overrun(w: World, i: Item, s: State, d: Decision): { mu: number; sigma: number; actual: number } {
  const c = clarity(i, s, d);
  const mu = 0.08 + 0.004 * s.D - 0.1 * c;
  const sigma = 0.2 - 0.08 * c;
  const o = w.expected ? w.expected.overrun * mu : Math.max(-0.1, mu + sigma * (w.z[i.id] ?? 0));
  return { mu, sigma, actual: i.eng * (1 + o) };
}

export function blockedBy(w: World, s: State, i: Item): string | null {
  const n = i.needs;
  if (!n) return null;
  if (n.or_done && isLive(s, n.or_done)) return null;
  for (const id of n.done ?? []) if (!isLive(s, id)) return `needs ${itemOf(w.cs, id).name} first`;
  if (n.level !== undefined && s.level < n.level) return `needs measurement level ${n.level}`;
  if (n.trust && s.trust[n.trust[0]] < n.trust[1]) return `${lc(termsOf(w.cs).parties[n.trust[0]])} trust is ${Math.round(s.trust[n.trust[0]])}, and this needs ${n.trust[1]}${n.or_done ? `, or ${itemOf(w.cs, n.or_done).name} live` : ""}`;
  return null;
}

// ---------- the quarter ----------

export interface Report {
  q: number; cap: Capacity;
  completed: string[]; stalled: string[]; blocked: Record<string, string>; carried: Record<string, number>;
  /** Engineering weeks used, and what each item got. */
  engUsed: number; workDone: Record<string, number>;
  analystUsed: number; designFree: number; polish: number; researchWeeks: number;
  funnel: Record<string, { n1: number; n2: number; n3: number; s: [number, number, number]; churn: number; avg: number; end: number; arpu: number }>;
  revenue: number; var_cost: number; stage_cost: number; reward: number; side_cost: number; team: number; marketing: number; asks: number; one_off: number; incidentLoss: number;
  profit: number; cash: number;
  /** The measurement level at the end of the quarter: what the team can see in its numbers. */
  level: number;
  incidents: number; lambda: number; lambdaBase: number; D: number; R: number; U: number; M: number; trust: Record<Party, number>;
  commitKept: number; commitBroken: number;
  event?: { id: string; absorbed: number; hit: number; readingOk: boolean; readingRight: boolean; evidenced: boolean; dirOk: boolean };
  attrition: boolean;
  readings: { tested: string[]; dived: string[] };
}

/** A hidden fact's value: this world's, or in an expected-case evaluation what the briefing says, so the reader has learned nothing. */
const hiddenOf = (w: World, v: string, ref: number): number => {
  if (w.expected?.hidden?.[v] !== undefined) return w.expected.hidden[v]!;
  if (w.expected && w.expected.effect !== "true") return briefOf(w.cs, v) ?? ref;
  return w.hidden[v] ?? ref;
};
const eventHit = (q: number, evQ: number): number => (q === evQ ? 1 : q === evQ + 1 ? 0.5 : 0);

export function playQuarter(w: World, s0: State, d: Decision, opts: { evQ?: number } = {}): { s: State; r: Report } {
  const cs = w.cs, evQ = opts.evQ ?? EVENT_QUARTER;
  const s: State = structuredClone(s0);
  const pace = PACE[d.pace];
  const cap = capacity(w, s, d);
  for (const id of d.drop ?? []) { if (!s.killed.includes(id)) s.killed.push(id); delete s.progress[id]; }

  // --- analyst weeks: items need some; experiments and dives cost; the rest is instrumentation
  let remE = cap.road, remZ = cap.design, remA = cap.analyst;
  const completed: string[] = [], stalled: string[] = [], blocked: Record<string, string> = {}, workDone: Record<string, number> = {};
  const testedNow: string[] = [], divedNow: string[] = [];
  if (s.level >= 1) for (const id of d.experiments ?? []) {
    if (remA >= 2 && remE >= 0.5) { remA -= 2; remE -= 0.5; s.tested[id] = s.q; testedNow.push(id); s.read[id] = valueOf({ ...w, expected: { effect: "true", overrun: 1 } }, s, id) * (1 + 0.3 * normal(w.seed, "test", id)); }
  }
  for (const id of d.dives ?? []) if (remA >= 1.5) { remA -= 1.5; s.dived[id] = s.q; divedNow.push(id); s.known[id] = (w.hidden[id] ?? 0) * (1 + 0.08 * normal(w.seed, "dive", id)); }

  // --- delivery in priority order
  const funded = (d.roadmap ?? []).filter((id) => !s.killed.includes(id) && !isLive(s, id));
  for (const id of funded) {
    const i = itemOf(cs, id);
    const why = blockedBy(w, s, i);
    if (why) { blocked[id] = why; continue; }
    const need = overrun(w, i, s, d).actual - (s.progress[id] ?? 0);
    const zCap = i.design > 0 ? (remZ * overrun(w, i, s, d).actual) / i.design : Infinity;
    const aCap = i.data > 0 ? (remA * overrun(w, i, s, d).actual) / i.data : Infinity;
    const use = Math.max(0, Math.min(need, remE, zCap, aCap));
    const frac = use / overrun(w, i, s, d).actual;
    remE -= use; remZ -= i.design * frac; remA -= i.data * frac; workDone[id] = use;
    s.progress[id] = (s.progress[id] ?? 0) + use;
    if (s.progress[id]! >= overrun(w, i, s, d).actual - 1e-9) { completed.push(id); s.live[id] = s.q; } else stalled.push(id);
  }
  const analystUsed = cap.analyst - remA;
  const designFree = Math.max(0, remZ);
  const researchWeeks = designFree * clamp(d.research, 0, 1), polish = designFree - researchWeeks;
  s.instrWeeks += Math.max(0, remA) * clamp(d.instrument, 0, 1);
  s.level = Math.max(s.level, s.instrWeeks >= 14 ? 2 : s.instrWeeks >= 6 ? 1 : 0);
  for (const id of completed) { const e = itemOf(cs, id).enables; if (e) s.level = Math.max(s.level, e); }

  // --- debt, reliability, usability from what shipped and what was reserved
  const dDelta = completed.reduce((t, id) => t + itemOf(cs, id).debt * (itemOf(cs, id).debt > 0 ? pace.debt : 1), 0) + 3.5 - 16 * Math.min(1, cap.reserveDebt / 0.15);
  const rDelta = 14 * Math.min(1, cap.reserveRel / 0.15) - 5 + completed.reduce((t, id) => t + (itemOf(cs, id).quality?.rel ?? 0), 0);
  const uDelta = 12 * (polish / cs.design_ref) - 5 + completed.reduce((t, id) => t + (itemOf(cs, id).quality?.use ?? 0), 0) - 0.06 * Math.max(0, s.D - 50);

  // --- the market event: reading and response decide how much of it is absorbed
  let absorbed = 0, hit = 0, readingOk = false, readingRight = false, evidenced = false, dirOk = false;
  const ev = w.event;
  hit = eventHit(s.q, evQ);
  if (s.q === evQ) s.eventSeen = true;
  if (hit > 0) {
    if (s.q === evQ) {
      readingRight = d.event?.reading === ev.cause;
      evidenced = !!d.event?.evidence && s.level >= 1;
      readingOk = readingRight && evidenced;
      dirOk = d.event?.direction === ev.direction;
      absorbed = ev.mitigations.reduce((t, m) => {
        const okLive = m.live ? isLive(s, m.live) || completed.includes(m.live) : true;
        const okTrust = m.trust ? s.trust[m.trust[0]] >= m.trust[1] : true;
        const okLevel = m.level !== undefined ? s.level >= m.level : true;
        const okRel = m.rel !== undefined ? s.R >= m.rel : true;
        return okLive && okTrust && okLevel && okRel ? t + m.by : t;
      }, 0) + (readingRight ? (evidenced ? 0.15 : 0.05) : 0) + (dirOk ? 0.1 : 0);
      absorbed = clamp(absorbed, 0, 0.9);
      s.eventAbsorbed = absorbed;
    } else absorbed = s.eventAbsorbed;
  }

  // --- incidents
  const lambdaBase = cs.incident_base * (1 + 0.015 * s.D) * (1.3 - s.R / 100) * pace.incident * (1 - 0.5 * Math.min(1, cap.reserveRel / 0.2));
  const lambda = lambdaBase + (hit > 0 && ev.incident ? ev.incident * hit * (1 - absorbed) : 0);
  const u = w.expected ? 0.5 : uniform(w.seed, "incident", s.q);
  let incidents = 0;
  if (w.expected) incidents = lambda; else { const p0 = Math.exp(-lambda), p1 = p0 * lambda; incidents = u < p0 ? 0 : u < p0 + p1 ? 1 : 2; }

  // --- funnel
  const frac = (id: string): number => (completed.includes(id) ? 0.4 : isLive(s, id) ? 1 : 0);
  const kU = 0.7 + 0.3 * (s.U / 100);
  const push = 1 + 0.12 * Math.pow(((d.asks?.marketing ?? 0) * cap.approvals.marketing) / Math.max(1, cs.squad.marketing * 0.2), 0.65) * (d.asks?.marketing ? 1 : 0);
  const funnel: Report["funnel"] = {};
  let revenue = 0, var_cost = 0, stage_cost = 0, reward = 0, incidentLoss = 0;
  const liveIds = cs.items.filter((i) => frac(i.id) > 0);
  for (const sg of cs.segments) {
    const lifts: Record<keyof Effect, number[]> = { s1: [], s2: [], s3: [], churn: [], arpu: [], cost: [], inflow: [] };
    const inflowBy: Record<string, number> = {};
    for (const i of liveIds) {
      const e = i.effects[sg.id]; if (!e) continue;
      const m = w.expected && w.expected.effect !== "true" ? w.expected.effect : (w.mult[`${i.id}|${sg.id}`] ?? 1);
      const k = frac(i.id) * kU * (0.85 + 0.15 * clarity(i, s, d)) * m;
      for (const key of Object.keys(e) as (keyof Effect)[]) {
        let v = (e[key] ?? 0) * k;
        for (const sc of i.scale ?? []) if (sc.keys.includes(key)) v *= (hiddenOf(w, sc.v, sc.ref)) / sc.ref;
        lifts[key].push(v);
        if (key === "inflow") inflowBy[i.id] = v;
      }
    }
    if (hit > 0) { const ef = ev.effects[sg.id] ?? {}; for (const key of Object.keys(ef) as (keyof Effect)[]) lifts[key].push((ef[key] ?? 0) * hit * (1 - absorbed)); }
    const L = (k: keyof Effect): number => combine(lifts[k]);
    const st: [number, number, number] = [clamp(sg.stages[0] * (1 + L("s1")), 0, 0.95), clamp(sg.stages[1] * (1 + L("s2")), 0, 0.95), clamp(sg.stages[2] * (1 + L("s3")), 0, 0.95)];
    const incChurn = 0.01 * incidents;
    const churn = clamp(sg.churn * (1 - L("churn")) + incChurn, sg.churn * 0.2, 0.9);
    const inflow = sg.inflow * (1 + L("inflow")) * push;
    const n1 = inflow * st[0], n2 = n1 * st[1], n3 = n2 * st[2];
    const C0 = s.C[sg.id]!;
    const end = C0 * (1 - churn) + n3;
    const avg = (C0 + end) / 2;
    const arpu = sg.arpu * (1 + L("arpu"));
    revenue += (avg * arpu) / 1e5;
    var_cost += (avg * sg.var_cost * clamp(1 + L("cost"), 0.3, 1.5)) / 1e5;
    stage_cost += (n1 * sg.stage_cost) / 1e5;
    for (const i of liveIds) if (i.per_new && i.effects[sg.id]) reward += i.per_new_on === "lift" ? (n3 * ((inflowBy[i.id] ?? 0) / (1 + L("inflow"))) * i.per_new) / 1e5 : (n3 * i.per_new * frac(i.id)) / 1e5;
    funnel[sg.id] = { n1, n2, n3, s: st, churn, avg, end, arpu };
    s.C[sg.id] = end;
  }
  incidentLoss = revenue * 0.015 * incidents;
  revenue -= incidentLoss;
  let side_cost = 0;
  for (const i of liveIds) if (i.side_cost) {
    const sc = i.side_cost; let c = sc.per_quarter * (sc.v ? hiddenOf(w, sc.v, sc.ref ?? 1) / (sc.ref ?? 1) : 1);
    if (sc.cut_by && isLive(s, sc.cut_by)) c *= 1 - (sc.cut ?? 0.6);
    side_cost += c * frac(i.id);
  }
  const one_off = completed.reduce((t, id) => t + (itemOf(cs, id).one_off ?? 0), 0);
  const asks = (d.asks?.marketing ?? 0) * cap.approvals.marketing + cap.contractorsPaid * 0.9;
  const teamCost = s.heads.eng * cs.squad.cost_eng + s.heads.newEng * cs.squad.cost_eng + s.heads.design * cs.squad.cost_design + s.heads.data * cs.squad.cost_data + cs.squad.pm + cs.squad.fixed;
  const profit = revenue - var_cost - stage_cost - reward - side_cost - teamCost - cs.squad.marketing - asks - one_off;
  s.cash += profit;

  // --- people and trust
  const committed = d.commit ?? [];
  const kept = committed.filter((id) => completed.includes(id) || isLive(s0, id)).length;
  const broken = committed.length - kept;
  const overload = Math.max(0, funded.reduce((t, id) => t + itemOf(cs, id).eng, 0) / Math.max(1, cap.road) - 1.1);
  const mDelta = pace.morale + 6 * ((funded.length ? completed.length / funded.length : 0.6) - 0.6) + (cap.reserveDebt >= 0.08 ? 2 : 0) - 4 * incidents - 8 * (committed.length ? broken / committed.length : 0) + (committed.length && kept / committed.length > 0.8 ? 3 : 0) - 10 * overload;
  s.M = clamp(s.M + mDelta, 0, 100);
  let attrition = false;
  if (s.heads.newEng > 0) { s.heads.eng += s.heads.newEng; s.heads.newEng = 0; }
  if (s.M < 42 && (w.expected ? false : uniform(w.seed, "attrition", s.q) < (42 - s.M) / 40)) { s.heads.eng -= 1; s.heads.newEng += 1; attrition = true; }
  const sponsorOf = (id: string): Party => itemOf(cs, id).sponsor;
  for (const id of committed) { const t = sponsorOf(id); s.trust[t] = clamp(s.trust[t] + (completed.includes(id) || isLive(s0, id) ? 5 : -8), 0, 100); }
  s.trust.eng = clamp(s.trust.eng - 2 * incidents + (d.pace === "push" ? -3 : d.pace === "relaxed" ? 1 : 0) + (cap.reserveDebt >= 0.08 ? 1 : 0), 0, 100);
  s.trust.lead = clamp(s.trust.lead - 3 * incidents + (profit > 0 ? 1 : -1), 0, 100);
  if ((d.asks?.marketing ?? 0) > 0 && cap.approvals.marketing < 0.5) s.trust.biz = clamp(s.trust.biz - 3, 0, 100);

  s.D = clamp(s.D + dDelta, 0, 100);
  s.R = clamp(s.R + rDelta - 6 * incidents, 0, 100);
  s.U = clamp(s.U + uDelta, 0, 100);
  s.incidentLoad = 2.5 * incidents;
  s.q += 1;

  const r: Report = {
    q: s0.q, cap, completed, stalled, blocked, carried: { ...s.progress }, engUsed: cap.road - remE, workDone,
    analystUsed, designFree, polish, researchWeeks, funnel, revenue, var_cost, stage_cost, reward, side_cost, team: teamCost, marketing: cs.squad.marketing, asks, one_off, incidentLoss,
    profit, cash: s.cash, level: s.level, incidents, lambda, lambdaBase, D: s.D, R: s.R, U: s.U, M: s.M, trust: { ...s.trust }, commitKept: kept, commitBroken: broken,
    event: hit > 0 && s0.q === evQ ? { id: ev.id, absorbed, hit, readingOk, readingRight, evidenced, dirOk } : undefined, attrition, readings: { tested: testedNow, dived: divedNow },
  };
  return { s, r };
}

/** The deterministic projection a player sees before locking: the same arithmetic with effects at their mean and overruns at their expectation. */
export function projection(w: World, s: State, d: Decision, hidden?: Record<string, number>): { r: Report; status: Record<string, "ships" | "at risk" | "does not fit" | "blocked"> } {
  const ex: World = { ...w, expected: { effect: 1, overrun: 1, ...(hidden ? { hidden } : {}) } };
  const out = playQuarter(ex, s, d, { evQ: 99 });
  const status: Record<string, "ships" | "at risk" | "does not fit" | "blocked"> = {};
  // "At risk" means it fits at the expected overrun but not at the 80th percentile one.
  const funded = d.roadmap.filter((id) => !s.killed.includes(id) && !isLive(s, id));
  let rem = out.r.cap.road;
  for (const id of funded) {
    const i = itemOf(w.cs, id);
    if (out.r.blocked[id]) { status[id] = "blocked"; continue; }
    const o = overrun(ex, i, s, d);
    const need80 = i.eng * (1 + o.mu + 0.84 * o.sigma) - (s.progress[id] ?? 0);
    const need50 = o.actual - (s.progress[id] ?? 0);
    if (need50 > rem + 1e-9) { status[id] = "does not fit"; rem = 0; continue; }
    rem -= need50;
    status[id] = need80 > need50 + rem + 1e-9 ? "at risk" : "ships";
  }
  return { r: out.r, status };
}

/** The true cause in a world, or, given the facts a player has been shown, the cause they would conclude. */
export const rootTruth = (cs: VentureScenario, hidden: Record<string, number>): string => {
  const v = hidden[cs.root.dive] ?? briefOf(cs, cs.root.dive)!;
  return v >= cs.root.threshold ? cs.root.high : cs.root.low;
};

// ---------- values: what one item is worth, and what a plan is worth ----------

/** A neutral decision: nothing funded, modest reserves, steady pace. */
export const idleDecision = (): Decision => ({ roadmap: [], reserve: { rel: 0.05, debt: 0.05 }, pace: "steady", research: 0.5, instrument: 0.5 });

/**
 * Profit a quarter an item adds once live, times the quarters it will run, less what it costs to run.
 * Evaluated in whatever world is passed: pass the true one for the answer, an expected one for what a player could estimate.
 */
export function valueOf(w: World, s: State, id: string, quarters = HORIZON - s.q + 1): number {
  const ex: World = { ...w, expected: w.expected ?? { effect: 1, overrun: 1 } };
  let a = structuredClone(s), b = structuredClone(s), total = 0;
  b.live[id] = s.q - 1;
  // The quarter it ships counts for 0.4 (live for part of it); later quarters see its customers accumulate.
  for (let k = 0; k < Math.max(1, Math.round(quarters)); k++) {
    const ra = playQuarter(ex, a, idleDecision(), { evQ: 99 }), rb = playQuarter(ex, b, idleDecision(), { evQ: 99 });
    total += (rb.r.profit - ra.r.profit) * (k === 0 ? 0.4 : 1);
    a = ra.s; b = rb.s;
  }
  return total - (itemOf(w.cs, id).one_off ?? 0);
}

/**
 * Profit over the next four quarters from a position, in the true world, if a fixed reference policy keeps building: what the position
 * left behind is worth. Debt, morale, trust and what is already live all show in it, because they decide what the policy can do.
 */
export function outlook(w: World, s: State, decide: (w: World, s: State) => Decision = () => idleDecision()): number {
  const ex: World = { ...w, expected: w.expected ?? { effect: "true", overrun: 1 } };
  let st = structuredClone(s), total = 0;
  for (let k = 0; k < 4; k++) { const out = playQuarter(ex, st, decide(w, st), { evQ: 99 }); total += out.r.profit; st = out.s; }
  return total;
}

/** Four quarters of profit from the end state under a plan, in this world. Each unmet condition takes a share off what the plan promises. */
export function planValue(w: World, s: State, planId: string, view: "true" | "expected" = "true"): number {
  const cs = w.cs, p = cs.plans.find((x) => x.id === planId)!;
  const n = p.needs;
  const unmet = [n.use !== undefined && s.U < n.use, n.rel !== undefined && s.R < n.rel, n.debt_below !== undefined && s.D >= n.debt_below, n.trust !== undefined && s.trust[n.trust[0]] < n.trust[1]].filter(Boolean).length;
  const f = 1 - 0.3 * unmet;
  const m = (x: number): number => 1 + (x - 1) * f;
  const plan: VentureScenario = structuredClone(cs);
  for (const sg of plan.segments) { sg.inflow *= m(p.inflow); sg.arpu *= m(p.arpu); sg.var_cost *= m(p.cost); sg.churn *= m(p.churn); }
  plan.squad.marketing *= m(p.marketing);
  const w2: World = { ...w, cs: plan, expected: view === "true" ? { effect: "true", overrun: 1 } : { effect: 1, overrun: 1, hidden: s.known } };
  let st = structuredClone(s), total = 0;
  for (let k = 0; k < 4; k++) { const out = playQuarter(w2, st, idleDecision(), { evQ: 99 }); total += out.r.profit; st = out.s; }
  return total;
}
