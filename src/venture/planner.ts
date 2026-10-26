// How an informed manager plans a quarter. Scoring needs it twice: the policy that judges what a position left behind (`referencePolicy`),
// and the benchmark for what could have been created in a world (`oracle`). The scripted contenders in bots.ts build on the same pieces.
// A policy sees what a player could see: the scenario, its own state, what deep dives and experiments showed, and the event's signal.
import {
  approval, blockedBy, capacity, EVENT_QUARTER, idleDecision, isLive, itemOf, overrun, planValue, projection, rootTruth, valueOf,
} from "./model.ts";
import type { Decision, Policy, State, World } from "./model.ts";
import { PRIORITIES } from "./types.ts";
import type { Item, Pace, Priority } from "./types.ts";

type Reserve = { rel: number; debt: number };
export const mkBase = (reserve: Reserve, pace: Pace, research: number, instrument: number): Decision => ({ roadmap: [], reserve, pace, research, instrument });

/**
 * What a manager could estimate for an item: its value with every effect at its average and each hidden fact at what a
 * deep dive showed (else the briefing's figure). An experiment's reading replaces the estimate.
 */
export const guess = (w: World, s: State, id: string): number => s.read[id] ?? valueOf({ ...w, expected: { effect: 1, overrun: 1, hidden: s.known } }, s, id);

export const believedRoot = (w: World, s: State): string => (s.known[w.cs.root.dive] === undefined ? "need_more_data" : rootTruth(w.cs, s.known));

/** Open items the manager could start now, in the order given, that fit the engineering, design and analyst weeks left. */
export function fill(w: World, s: State, base: Decision, order: Item[], slack: number, analystTaken: number): string[] {
  const cap = capacity(w, s, base);
  let eng = cap.road * slack, design = cap.design, analyst = cap.analyst - analystTaken;
  const out: string[] = [];
  for (const i of order) {
    if (isLive(s, i.id) || s.killed.includes(i.id) || blockedBy(w, s, i)) continue;
    const need = Math.max(0.5, i.eng * (1 + overrun(w, i, s, base).mu) - (s.progress[i.id] ?? 0));
    const share = need / Math.max(1e-9, i.eng * (1 + overrun(w, i, s, base).mu));
    if (need > eng || i.design * share > design || i.data * share > analyst) continue;
    out.push(i.id); eng -= need; design -= i.design * share; analyst -= i.data * share;
  }
  return out;
}

export const inProgressFirst = (s: State, xs: Item[]): Item[] => [...xs.filter((i) => (s.progress[i.id] ?? 0) > 0), ...xs.filter((i) => (s.progress[i.id] ?? 0) <= 0)];
export const byValuePerWeek = (w: World, s: State, xs: Item[]): Item[] => [...xs].filter((i) => guess(w, s, i.id) > 0).sort((a, b) => guess(w, s, b.id) / a.eng - guess(w, s, a.id) / b.eng);
export const informed = (s: State, i: Item): boolean => s.tested[i.id] !== undefined || (i.scale ?? []).some((x) => s.known[x.v] !== undefined) || (i.side_cost?.v !== undefined && s.known[i.side_cost.v] !== undefined);
export const priorityOf = (w: World, s: State): Priority => {
  const tot = (p: Priority): number => w.cs.items.filter((i) => !isLive(s, i.id) && i.serves.includes(p)).reduce((t, i) => t + Math.max(0, guess(w, s, i.id)), 0);
  return [...PRIORITIES].sort((a, b) => tot(b) - tot(a))[0]!;
};

/** What an item makes possible: the value of the best blocked item it clears the way for, or the trust it earns toward one. */
const unlockValue = (w: World, s: State, i: Item, g: Record<string, number>): number => {
  let v = 0;
  for (const b of w.cs.items) {
    const n = b.needs;
    if (!n || isLive(s, b.id) || !blockedBy(w, s, b) || (g[b.id] ?? 0) <= 0) continue;
    if (n.or_done === i.id || n.done?.includes(i.id)) v = Math.max(v, 0.6 * g[b.id]!);
    if (n.level !== undefined && i.enables !== undefined && i.enables >= n.level) v = Math.max(v, 0.6 * g[b.id]!);
    if (n.trust && n.trust[0] === i.sponsor && n.trust[1] - s.trust[i.sponsor] <= 12 && s.trust[i.sponsor] < n.trust[1]) v = Math.max(v, 0.4 * g[b.id]!);
  }
  return v;
};

/** Learns first, builds what the evidence supports, keeps reserves matched to need, answers the event from data, picks the plan on expected value. */
export const evidenceLed: Policy = (w, s) => {
  const cs = w.cs;
  const base = mkBase({ rel: s.R < 62 ? 0.1 : 0.06, debt: s.D > 58 ? 0.12 : 0.07 }, s.M < 52 ? "relaxed" : "steady", 0.4, s.level >= 2 ? 0.2 : 1);
  const dives = cs.hidden.map((f) => f.id).filter((k) => s.known[k] === undefined);
  const experiments = s.level < 1 ? [] : cs.items.filter((i) => (i.risky || i.big) && !isLive(s, i.id) && s.tested[i.id] === undefined && !blockedBy(w, s, i) && guess(w, s, i.id) > 0)
    .sort((a, b) => guess(w, s, b.id) - guess(w, s, a.id)).slice(0, 2).map((i) => i.id);
  const g = Object.fromEntries(cs.items.map((i) => [i.id, guess(w, s, i.id)]));
  const open = cs.items.filter((i) => (!i.risky && !i.big ? true : informed(s, i)) && g[i.id]! + unlockValue(w, s, i, g) > 0);
  const rank = (i: Item): number => (g[i.id]! + unlockValue(w, s, i, g)) / i.eng;
  const roadmap = fill(w, s, base, inProgressFirst(s, [...open].sort((a, b) => rank(b) - rank(a))), 1.0, 2 * experiments.length + 1.5 * dives.length);
  let used = 0;
  const road = capacity(w, s, base).road;
  const commit: string[] = [];
  for (const id of roadmap) { const i = itemOf(cs, id); used += i.eng; if (used <= 0.8 * road && commit.length < 3) commit.push(id); }
  const q = s.q;
  const d: Decision = { ...base, priority: priorityOf(w, s), roadmap, experiments, dives, commit };
  if (approval(s.trust.lead) >= 0.5 && q <= 3) d.asks = { contractors: 8 };
  // Dropped: an experiment that read negative on something already under way.
  d.drop = cs.items.filter((i) => !isLive(s, i.id) && s.read[i.id] !== undefined && s.read[i.id]! < 0 && (s.progress[i.id] ?? 0) > 0).map((i) => i.id);
  if (q === EVENT_QUARTER) d.event = { evidence: s.level >= 1, reading: w.event.cause, direction: w.event.direction };
  if (q === 4) d.plan = [...cs.plans].sort((a, b) => planValue(w, s, b.id, "expected") - planValue(w, s, a.id, "expected"))[0]!.id;
  const p = projection(w, s, d).r, hold = projection(w, s, { ...base, roadmap: [] }).r;
  const rel = (p.profit - hold.profit) / Math.max(1, p.revenue);
  d.reflection = { root_cause: believedRoot(w, s), expected: rel < -0.01 ? "down" : rel < 0.01 ? "flat" : rel < 0.04 ? "up_small" : "up_large" };
  return d;
};

/** What the position left behind is judged by: build the best-looking items at their briefed values, steady pace, modest reserves. */
export const referencePolicy: Policy = (w, s) => {
  const base = mkBase({ rel: 0.08, debt: 0.08 }, "steady", 0.3, 0.3);
  return { ...base, roadmap: fill(w, s, base, inProgressFirst(s, byValuePerWeek(w, s, w.cs.items.filter((i) => !i.risky && !i.big))), 1.0, 0) };
};

/** An evidence-led manager who is simply told every hidden fact and every item's true value. The benchmark for what a manager could have created. */
export const oracle: Policy = (w, s) => {
  const tw: World = { ...w, expected: { effect: "true", overrun: 1 } };
  const read = Object.fromEntries(w.cs.items.map((i) => [i.id, valueOf(tw, s, i.id)]));
  const tested = Object.fromEntries(w.cs.items.map((i) => [i.id, 0]));
  return { ...evidenceLed(w, { ...s, known: { ...w.hidden }, read, tested }), dives: [], experiments: [] };
};

/** Takes no decisions at all: the baseline every outcome is measured against. */
export const doNothing: Policy = () => idleDecision();
