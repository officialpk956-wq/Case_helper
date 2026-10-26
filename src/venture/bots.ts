// Scripted play for a venture scenario. Each bot is a stand-in for a kind of manager, used to check that the scoring separates good
// play from bad. A bot sees what a player could see: the scenario, its own state, what its deep dives and experiments showed, and, in
// the third quarter, the signal of the event. None of them uses a language model.
import { uniform } from "../rng.ts";
import { EVENT_QUARTER } from "./model.ts";
import type { Decision, Policy } from "./model.ts";
import { PRIORITIES } from "./types.ts";
import type { Expectation, Pace } from "./types.ts";
import { byValuePerWeek, doNothing, evidenceLed, fill, inProgressFirst, mkBase, oracle, priorityOf } from "./planner.ts";
import { planValue } from "./model.ts";

const pickWith = <T>(xs: T[], u: number): T => xs[Math.min(xs.length - 1, Math.floor(u * xs.length))]!;
const coin = (seed: number, tag: string, q: number): number => uniform(seed, "bot", tag, q);
const wrongOf = (ids: { id: string }[], truth: string, u: number): string => pickWith(ids.filter((x) => x.id !== truth), u).id;

/** Frameworks without evidence: ranks by estimated value per week at the briefing's figures, never investigates, trusts its own estimates. */
export const textbook: Policy = (w, s) => {
  const cs = w.cs;
  const base = mkBase({ rel: 0.08, debt: 0.08 }, "steady", 0.3, 0.3);
  const roadmap = fill(w, s, base, inProgressFirst(s, byValuePerWeek(w, s, cs.items)), 1.05, 0);
  const d: Decision = { ...base, priority: priorityOf(w, s), roadmap, commit: roadmap.slice(0, 3) };
  const q = s.q;
  if (q === EVENT_QUARTER) d.event = { evidence: false, reading: w.event.cause, direction: coin(w.seed, "text-dir", q) < 0.5 ? w.event.direction : wrongOf(w.event.directions, w.event.direction, coin(w.seed, "text-dir2", q)) };
  if (q === 4) d.plan = [...cs.plans].sort((a, b) => planValue(w, s, b.id, "expected") - planValue(w, s, a.id, "expected"))[0]!.id;
  d.reflection = { root_cause: cs.root.options[0]!.id, expected: "up_large" };
  return d;
};

/** Ships as much as it can: the loudest sponsor's item first, then the cheapest; pushes the team, keeps no reserves, promises everything. */
export const featureFactory: Policy = (w, s) => {
  const cs = w.cs;
  const base = mkBase({ rel: 0, debt: 0 }, "push", 0, 0);
  const order = [...cs.items.filter((i) => i.fav), ...[...cs.items].filter((i) => !i.fav).sort((a, b) => a.eng - b.eng)];
  const roadmap = fill(w, s, base, inProgressFirst(s, order), 2.6, 0);
  const d: Decision = { ...base, priority: "grow", roadmap, commit: roadmap, asks: { contractors: 30, marketing: 200 } };
  const q = s.q;
  if (q === EVENT_QUARTER) d.event = { evidence: false, reading: wrongOf(w.event.causes, w.event.cause, coin(w.seed, "ff-cause", q)), direction: wrongOf(w.event.directions, w.event.direction, coin(w.seed, "ff-dir", q)) };
  if (q === 4) d.plan = cs.plans[0]!.id;
  d.reflection = { root_cause: cs.root.options[0]!.id, expected: "up_large" };
  return d;
};

/** Pays down debt and hardens the product first; builds little, and what it builds is chosen on estimates. */
export const debtFirst: Policy = (w, s) => {
  const cs = w.cs;
  const base = mkBase({ rel: 0.25, debt: 0.25 }, "relaxed", 0.6, 0.5);
  const care = cs.items.filter((i) => i.serves.includes("debt") || i.serves.includes("quality"));
  const roadmap = fill(w, s, base, inProgressFirst(s, [...care, ...byValuePerWeek(w, s, cs.items.filter((i) => !care.includes(i)))]), 0.9, 0);
  const d: Decision = { ...base, priority: "debt", roadmap, commit: roadmap.slice(0, 1) };
  const q = s.q;
  if (q === EVENT_QUARTER) d.event = { evidence: false, reading: w.event.cause, direction: coin(w.seed, "df-dir", q) < 0.5 ? w.event.direction : wrongOf(w.event.directions, w.event.direction, coin(w.seed, "df-dir2", q)) };
  if (q === 4) d.plan = cs.plans[cs.plans.length - 1]!.id;
  d.reflection = { root_cause: cs.root.options.find((o) => o.id === "reliability")?.id ?? cs.root.options[0]!.id, expected: "flat" };
  return d;
};

/** Anything valid. The control for what chance alone earns. */
export const randomPlay: Policy = (w, s) => {
  const cs = w.cs, q = s.q, u = (tag: string): number => coin(w.seed, tag, q);
  const open = cs.items.filter((i) => s.live[i.id] === undefined && !s.killed.includes(i.id));
  const pool = [...open].sort((a, b) => uniform(w.seed, "bot-rand", q, a.id) - uniform(w.seed, "bot-rand", q, b.id));
  const roadmap = pool.slice(0, 2 + Math.floor(u("n") * 4)).map((i) => i.id);
  const d: Decision = {
    priority: pickWith(PRIORITIES, u("prio")), roadmap, reserve: { rel: u("rel") * 0.2, debt: u("debt") * 0.2 },
    pace: pickWith<Pace>(["relaxed", "steady", "push"], u("pace")), research: u("res"), instrument: u("ins"),
    commit: roadmap.filter((_, k) => uniform(w.seed, "bot-commit", q, k) < 0.5),
    experiments: u("exp") < 0.5 ? pool.slice(0, 1 + Math.floor(u("exp2") * 2)).map((i) => i.id) : [],
    dives: u("dive") < 0.5 ? [pickWith(cs.hidden.map((f) => f.id), u("dive2"))] : [],
    reflection: { root_cause: pickWith(cs.root.options, u("root")).id, expected: pickWith<Expectation>(["down", "flat", "up_small", "up_large"], u("exp3")) },
  };
  if (u("ask") < 0.4) d.asks = { contractors: Math.floor(u("ask2") * 20), marketing: Math.floor(u("ask3") * 200) };
  if (q === EVENT_QUARTER) d.event = { evidence: u("ev") < 0.5, reading: pickWith(w.event.causes, u("cause")).id, direction: pickWith(w.event.directions, u("dir")).id };
  if (q === 4) d.plan = pickWith(cs.plans, u("plan")).id;
  return d;
};

export { doNothing, evidenceLed, oracle };

export const BOTS: { id: string; bot: Policy; blurb: string }[] = [
  { id: "do_nothing", bot: doNothing, blurb: "Takes no decisions." },
  { id: "random", bot: randomPlay, blurb: "Anything valid, chosen by chance." },
  { id: "feature_factory", bot: featureFactory, blurb: "Ships the loudest sponsor's items and as many as it can, pushes the team, keeps no reserves." },
  { id: "debt_first", bot: debtFirst, blurb: "Pays down debt and hardens the product; builds little." },
  { id: "textbook", bot: textbook, blurb: "Frameworks and estimates, no investigation." },
  { id: "evidence_led", bot: evidenceLed, blurb: "Instruments, learns, then builds what the evidence supports." },
  { id: "oracle", bot: oracle, blurb: "Told every hidden fact and every item's true value; the benchmark, not a contender." },
];
