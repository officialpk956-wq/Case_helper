// PROTOTYPE. Scripted play for the product-manager seat. Each bot is a stand-in for a kind of manager, used to check that
// the scoring separates good play from bad. A bot sees what a player could see: the case data, its own state, what its
// deep dives and experiments showed, and, in the third quarter, the signal of the event.
import { uniform } from "../../src/rng.ts";
import { approval, blockedBy, capacity, idleDecision, initOf, isLive, overrun, planValue, projection, PRIORITIES, rootTruth, valueOf } from "./model.ts";
import type { Decision, Init, Pace, Priority, State, World } from "./model.ts";
import type { Bot } from "./play.ts";
import { EVENT_QUARTER } from "./play.ts";

type Reserve = { rel: number; debt: number };
const mkBase = (reserve: Reserve, pace: Pace, research: number, instrument: number): Decision => ({ roadmap: [], reserve, pace, research, instrument });

/**
 * What a manager could estimate for an item: its value with every effect at its average and each hidden fact at what a
 * deep dive showed (else the middle of its range). An experiment's reading replaces the estimate.
 */
export const guess = (w: World, s: State, id: string): number => s.read[id] ?? valueOf({ ...w, expected: { effect: 1, overrun: 1, hidden: s.known } }, s, id);

const mid = (w: World): Record<string, number> => Object.fromEntries(Object.entries(w.cs.hidden).map(([k, [lo, hi]]) => [k, (lo + hi) / 2]));
const believedRoot = (w: World, s: State): string => (s.known[w.cs.root.dive] === undefined ? "need_more_data" : rootTruth(w.cs, s.known));

/** Open items the manager could start now, in the order given, that fit the engineering, design and analyst weeks left. */
function fill(w: World, s: State, base: Decision, order: Init[], slack: number, analystTaken: number): string[] {
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

const inProgressFirst = (s: State, xs: Init[]): Init[] => [...xs.filter((i) => (s.progress[i.id] ?? 0) > 0), ...xs.filter((i) => (s.progress[i.id] ?? 0) <= 0)];
const byValuePerWeek = (w: World, s: State, xs: Init[]): Init[] => [...xs].filter((i) => guess(w, s, i.id) > 0).sort((a, b) => guess(w, s, b.id) / a.eng - guess(w, s, a.id) / b.eng);
const informed = (s: State, i: Init): boolean => s.tested[i.id] !== undefined || (i.scale ?? []).some((x) => s.known[x.v] !== undefined) || (i.sideCost?.v !== undefined && s.known[i.sideCost.v] !== undefined);
const priorityOf = (w: World, s: State): Priority => {
  const tot = (p: Priority): number => w.cs.inits.filter((i) => !isLive(s, i.id) && i.serves.includes(p)).reduce((t, i) => t + Math.max(0, guess(w, s, i.id)), 0);
  return [...PRIORITIES].sort((a, b) => tot(b) - tot(a))[0]!;
};
const pickWith = <T>(xs: T[], u: number): T => xs[Math.min(xs.length - 1, Math.floor(u * xs.length))]!;
const coin = (w: World, tag: string, q: number): number => uniform(w.seed, "bot", tag, q);
const wrongOf = (ids: { id: string }[], truth: string, u: number): string => pickWith(ids.filter((x) => x.id !== truth), u).id;

export const doNothing: Bot = () => idleDecision();

/** Learns first, builds what the evidence supports, keeps reserves matched to need, answers the event from data, picks the plan on expected value. */
/** What an item makes possible: the value of the best blocked item it clears the way for, or the trust it earns toward one. */
const unlockValue = (w: World, s: State, i: Init, g: Record<string, number>): number => {
  let v = 0;
  for (const b of w.cs.inits) {
    const n = b.needs;
    if (!n || isLive(s, b.id) || !blockedBy(w, s, b) || (g[b.id] ?? 0) <= 0) continue;
    if (n.orDone === i.id || n.done?.includes(i.id)) v = Math.max(v, 0.6 * g[b.id]!);
    if (n.level !== undefined && i.enables !== undefined && i.enables >= n.level) v = Math.max(v, 0.6 * g[b.id]!);
    if (n.trust && n.trust[0] === i.sponsor && n.trust[1] - s.trust[i.sponsor] <= 12 && s.trust[i.sponsor] < n.trust[1]) v = Math.max(v, 0.4 * g[b.id]!);
  }
  return v;
};

export const evidenceLed: Bot = (w, s) => {
  const cs = w.cs;
  const base = mkBase({ rel: s.R < 62 ? 0.1 : 0.06, debt: s.D > 58 ? 0.12 : 0.07 }, s.M < 52 ? "relaxed" : "steady", 0.4, s.level >= 2 ? 0.2 : 1);
  const dives = Object.keys(cs.hidden).filter((k) => s.known[k] === undefined);
  const experiments = s.level < 1 ? [] : cs.inits.filter((i) => (i.risky || i.big) && !isLive(s, i.id) && s.tested[i.id] === undefined && !blockedBy(w, s, i) && guess(w, s, i.id) > 0)
    .sort((a, b) => guess(w, s, b.id) - guess(w, s, a.id)).slice(0, 2).map((i) => i.id);
  const g = Object.fromEntries(cs.inits.map((i) => [i.id, guess(w, s, i.id)]));
  const open = cs.inits.filter((i) => (!i.risky && !i.big ? true : informed(s, i)) && g[i.id]! + unlockValue(w, s, i, g) > 0);
  const rank = (i: Init): number => (g[i.id]! + unlockValue(w, s, i, g)) / i.eng;
  const roadmap = fill(w, s, base, inProgressFirst(s, [...open].sort((a, b) => rank(b) - rank(a))), 1.0, 2 * experiments.length + 1.5 * dives.length);
  let used = 0;
  const road = capacity(w, s, base).road;
  const commit: string[] = [];
  for (const id of roadmap) { const i = initOf(cs, id); used += i.eng; if (used <= 0.8 * road && commit.length < 3) commit.push(id); }
  const q = s.q;
  const d: Decision = { ...base, priority: priorityOf(w, s), roadmap, experiments, dives, commit };
  if (approval(s.trust.lead) >= 0.5 && q <= 3) d.asks = { contractors: 8 };
  // Dropped: an experiment that read negative on something already under way.
  d.drop = cs.inits.filter((i) => s.read[i.id] !== undefined && s.read[i.id]! < 0 && (s.progress[i.id] ?? 0) > 0).map((i) => i.id);
  if (q === EVENT_QUARTER) d.event = { evidence: s.level >= 1, reading: w.event.cause, direction: w.event.direction };
  if (q === 4) d.plan = [...cs.plans].sort((a, b) => planValue(w, s, b.id, "expected") - planValue(w, s, a.id, "expected"))[0]!.id;
  const p = projection(w, s, d).r, hold = projection(w, s, { ...base, roadmap: [] }).r;
  const rel = (p.profit - hold.profit) / Math.max(1, p.revenue);
  d.reflection = { root_cause: believedRoot(w, s), expected: rel < -0.01 ? "down" : rel < 0.01 ? "flat" : rel < 0.04 ? "up_small" : "up_large" };
  return d;
};

/** Frameworks without evidence: ranks by estimated value per week at the middle of every range, never investigates, trusts its own estimates. */
export const textbook: Bot = (w, s) => {
  const cs = w.cs;
  const base = mkBase({ rel: 0.08, debt: 0.08 }, "steady", 0.3, 0.3);
  const roadmap = fill(w, s, base, inProgressFirst(s, byValuePerWeek(w, s, cs.inits)), 1.05, 0);
  const d: Decision = { ...base, priority: priorityOf(w, s), roadmap, commit: roadmap.slice(0, 3) };
  const q = s.q;
  if (q === EVENT_QUARTER) d.event = { evidence: false, reading: w.event.cause, direction: coin(w, "text-dir", q) < 0.5 ? w.event.direction : wrongOf(w.event.directions, w.event.direction, coin(w, "text-dir2", q)) };
  if (q === 4) d.plan = [...cs.plans].sort((a, b) => planValue(w, s, b.id, "expected") - planValue(w, s, a.id, "expected"))[0]!.id;
  d.reflection = { root_cause: cs.root.options[0]!.id, expected: "up_large" };
  return d;
};

/** Ships as much as it can: the loudest sponsor's item first, then the cheapest; pushes the team, keeps no reserves, promises everything. */
export const featureFactory: Bot = (w, s) => {
  const cs = w.cs;
  const base = mkBase({ rel: 0, debt: 0 }, "push", 0, 0);
  const order = [...cs.inits.filter((i) => i.fav), ...[...cs.inits].filter((i) => !i.fav).sort((a, b) => a.eng - b.eng)];
  const roadmap = fill(w, s, base, inProgressFirst(s, order), 2.6, 0);
  const d: Decision = { ...base, priority: "grow", roadmap, commit: roadmap, asks: { contractors: 30, marketing: 200 } };
  const q = s.q;
  if (q === EVENT_QUARTER) d.event = { evidence: false, reading: wrongOf(w.event.causes, w.event.cause, coin(w, "ff-cause", q)), direction: wrongOf(w.event.directions, w.event.direction, coin(w, "ff-dir", q)) };
  if (q === 4) d.plan = cs.plans[0]!.id;
  d.reflection = { root_cause: cs.root.options[0]!.id, expected: "up_large" };
  return d;
};

/** Pays down debt and hardens the product first; builds little, and what it builds is chosen on estimates. */
export const debtFirst: Bot = (w, s) => {
  const cs = w.cs;
  const base = mkBase({ rel: 0.25, debt: 0.25 }, "relaxed", 0.6, 0.5);
  const care = cs.inits.filter((i) => i.serves.includes("debt") || i.serves.includes("quality"));
  const roadmap = fill(w, s, base, inProgressFirst(s, [...care, ...byValuePerWeek(w, s, cs.inits.filter((i) => !care.includes(i)))]), 0.9, 0);
  const d: Decision = { ...base, priority: "debt", roadmap, commit: roadmap.slice(0, 1) };
  const q = s.q;
  if (q === EVENT_QUARTER) d.event = { evidence: false, reading: w.event.cause, direction: coin(w, "df-dir", q) < 0.5 ? w.event.direction : wrongOf(w.event.directions, w.event.direction, coin(w, "df-dir2", q)) };
  if (q === 4) d.plan = cs.plans[cs.plans.length - 1]!.id;
  d.reflection = { root_cause: cs.root.options.find((o) => o.id === "reliability")?.id ?? cs.root.options[0]!.id, expected: "flat" };
  return d;
};

/** What the position left behind is judged by: build the best-looking items at their briefed values, steady pace, modest reserves. */
export const referencePolicy = (w: World, s: State): Decision => {
  const base = mkBase({ rel: 0.08, debt: 0.08 }, "steady", 0.3, 0.3);
  return { ...base, roadmap: fill(w, s, base, inProgressFirst(s, byValuePerWeek(w, s, w.cs.inits.filter((i) => !i.risky && !i.big))), 1.0, 0) };
};

/** An evidence-led manager who is simply told every hidden fact and every item's true value. The benchmark for what a manager could have created. */
export const oracle: Bot = (w, s) => {
  const tw: World = { ...w, expected: { effect: "true", overrun: 1 } };
  const read = Object.fromEntries(w.cs.inits.map((i) => [i.id, valueOf(tw, s, i.id)]));
  const tested = Object.fromEntries(w.cs.inits.map((i) => [i.id, 0]));
  return { ...evidenceLed(w, { ...s, known: { ...w.hidden }, read, tested }), dives: [], experiments: [] };
};

/** Anything valid. The control for what chance alone earns. */
export const randomPlay: Bot = (w, s) => {
  const cs = w.cs, q = s.q, u = (tag: string): number => coin(w, tag, q);
  const open = cs.inits.filter((i) => !isLive(s, i.id) && !s.killed.includes(i.id));
  const pool = [...open].sort((a, b) => uniform(w.seed, "bot-rand", q, a.id) - uniform(w.seed, "bot-rand", q, b.id));
  const roadmap = pool.slice(0, 2 + Math.floor(u("n") * 4)).map((i) => i.id);
  const d: Decision = {
    priority: pickWith(PRIORITIES, u("prio")), roadmap, reserve: { rel: u("rel") * 0.2, debt: u("debt") * 0.2 },
    pace: pickWith<Pace>(["relaxed", "steady", "push"], u("pace")), research: u("res"), instrument: u("ins"),
    commit: roadmap.filter((_, k) => uniform(w.seed, "bot-commit", q, k) < 0.5),
    experiments: u("exp") < 0.5 ? pool.slice(0, 1 + Math.floor(u("exp2") * 2)).map((i) => i.id) : [],
    dives: u("dive") < 0.5 ? [pickWith(Object.keys(cs.hidden), u("dive2"))] : [],
    reflection: { root_cause: pickWith(cs.root.options, u("root")).id, expected: pickWith<"down" | "flat" | "up_small" | "up_large">(["down", "flat", "up_small", "up_large"], u("exp3")) },
  };
  if (u("ask") < 0.4) d.asks = { contractors: Math.floor(u("ask2") * 20), marketing: Math.floor(u("ask3") * 200) };
  if (q === EVENT_QUARTER) d.event = { evidence: u("ev") < 0.5, reading: pickWith(w.event.causes, u("cause")).id, direction: pickWith(w.event.directions, u("dir")).id };
  if (q === 4) d.plan = pickWith(cs.plans, u("plan")).id;
  return d;
};

export const BOTS: { id: string; bot: Bot; blurb: string }[] = [
  { id: "do_nothing", bot: doNothing, blurb: "Takes no decisions." },
  { id: "random", bot: randomPlay, blurb: "Anything valid, chosen by chance." },
  { id: "feature_factory", bot: featureFactory, blurb: "Ships the loudest sponsor's items and as many as it can, pushes the team, keeps no reserves." },
  { id: "debt_first", bot: debtFirst, blurb: "Pays down debt and hardens the product; builds little." },
  { id: "textbook", bot: textbook, blurb: "Frameworks and estimates, no investigation." },
  { id: "evidence_led", bot: evidenceLed, blurb: "Instruments, learns, then builds what the evidence supports." },
  { id: "oracle", bot: oracle, blurb: "Told every hidden fact and every item's true value; the benchmark, not a contender." },
];
