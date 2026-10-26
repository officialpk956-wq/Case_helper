// A venture run: one world, one player (or bot), up to four quarters. The server, the calibration and the tests all play through here,
// so a bot is held to the same rules as a person.
import { DecisionError } from "../engine.ts";
import { EVENT_QUARTER, QUARTERS, itemOf, newState, newWorld, playQuarter } from "./model.ts";
import type { Decision, Policy, Report, State, World } from "./model.ts";
import { EXPECTATIONS, PACES, PRIORITIES, lc, termsOf } from "./types.ts";
import type { VentureScenario } from "./types.ts";

export interface Quarter { s0: State; d: Decision; r: Report; s1: State }
export interface Run { w: World; label: string; start: State; qs: Quarter[]; end: State }

export const newRun = (sc: VentureScenario, seed: number, label = "player", opts: { vary?: boolean } = {}): Run => {
  const w = newWorld(sc, seed, opts), s = newState(sc);
  return { w, label, start: structuredClone(s), qs: [], end: s };
};
export const isDone = (run: Run): boolean => run.qs.length >= QUARTERS;
/** The quarter about to be played, 1 to 4 (5 once the game is over). */
export const quarterOf = (run: Run): number => run.end.q;

const MAX_ROADMAP = 20, MAX_EXPERIMENTS = 4, MAX_DIVES = 8;
const MAX_CONTRACTOR_WEEKS = 40, MAX_MARKETING_LAKH = 600;
const fail = (m: string): never => { throw new DecisionError(m); };

/**
 * Refuse what a player could not do, in plain words, before anything is played. What is merely unwise is allowed and shown by the
 * preview (an item that is blocked, work that does not fit, an experiment before there is anything to measure with).
 */
export function checkDecision(run: Run, d: Decision): void {
  const sc = run.w.cs, s = run.end, q = s.q, T = termsOf(sc);
  if (isDone(run)) fail("the game is over");
  const name = (id: string): string => itemOf(sc, id).name;
  const unique = (ids: string[], what: string): void => { if (new Set(ids).size !== ids.length) fail(`${what} lists something twice`); };
  const known = (ids: string[], what: string): void => { for (const id of ids) if (!sc.items.some((i) => i.id === id)) fail(`${what} names "${id}", which is not an item in this case`); };

  known(d.roadmap, "the roadmap"); unique(d.roadmap, "the roadmap");
  if (d.roadmap.length > MAX_ROADMAP) fail(`the roadmap has too many items (at most ${MAX_ROADMAP})`);
  for (const id of d.roadmap) {
    if (s.live[id] !== undefined) fail(`${name(id)} is already live`);
    if (s.killed.includes(id)) fail(`${name(id)} was dropped and cannot be restarted`);
  }
  const drops = d.drop ?? [];
  known(drops, "the drop list"); unique(drops, "the drop list");
  for (const id of drops) {
    if (s.live[id] !== undefined) fail(`${name(id)} is already live, so there is nothing to drop`);
    if ((s.progress[id] ?? 0) <= 0) fail(`${name(id)} has not been started, so there is nothing to drop`);
    if (d.roadmap.includes(id)) fail(`${name(id)} is both funded and dropped`);
  }
  if (!(d.reserve.rel >= 0 && d.reserve.rel <= 0.25 && d.reserve.debt >= 0 && d.reserve.debt <= 0.25)) fail("each reserve is between 0% and 25%");
  if (!(d.research >= 0 && d.research <= 1 && d.instrument >= 0 && d.instrument <= 1)) fail(`the ${lc(T.design)} and ${lc(T.data)} splits are between 0% and 100%`);
  if (d.priority !== undefined && !PRIORITIES.includes(d.priority)) fail("that is not a theme");
  if (!PACES.includes(d.pace)) fail("that is not a pace");
  const tests = d.experiments ?? [];
  known(tests, "the experiments"); unique(tests, "the experiments");
  if (tests.length > MAX_EXPERIMENTS) fail(`at most ${MAX_EXPERIMENTS} experiments in a quarter`);
  for (const id of tests) if (s.live[id] !== undefined) fail(`${name(id)} is already live, so there is nothing to test`);
  const dives = d.dives ?? [];
  for (const id of dives) if (!sc.hidden.some((f) => f.id === id)) fail(`a deep dive names "${id}", which is not something this case can investigate`);
  unique(dives, "the deep dives");
  if (dives.length > MAX_DIVES) fail(`at most ${MAX_DIVES} deep dives in a quarter`);
  const asks = d.asks ?? {};
  if (!((asks.contractors ?? 0) >= 0 && (asks.contractors ?? 0) <= MAX_CONTRACTOR_WEEKS)) fail(`ask for between 0 and ${MAX_CONTRACTOR_WEEKS} contractor weeks`);
  if (!((asks.marketing ?? 0) >= 0 && (asks.marketing ?? 0) <= MAX_MARKETING_LAKH)) fail(`ask for between 0 and ${MAX_MARKETING_LAKH} lakh of marketing`);
  const promised = d.commit ?? [];
  known(promised, "the promises"); unique(promised, "the promises");
  for (const id of promised) if (!d.roadmap.includes(id)) fail(`you promised ${name(id)} but it is not on the roadmap`);
  if (d.event !== undefined) {
    if (q !== EVENT_QUARTER) fail("there is no market event to respond to this quarter");
    const ev = run.w.event;
    if (!ev.causes.some((c) => c.id === d.event!.reading)) fail("that is not one of the causes offered");
    if (!ev.directions.some((c) => c.id === d.event!.direction)) fail("that is not one of the responses offered");
  }
  if (d.plan !== undefined) {
    if (q !== QUARTERS) fail("the board offers its plans in the last quarter");
    if (!sc.plans.some((p) => p.id === d.plan)) fail("that is not one of the plans offered");
  }
  if (d.reflection !== undefined) {
    if (!sc.root.options.some((o) => o.id === d.reflection!.root_cause)) fail("that is not one of the causes offered");
    if (!EXPECTATIONS.includes(d.reflection.expected)) fail("that is not a forecast");
  }
}

/** Validate, play and record one quarter. */
export function lockQuarter(run: Run, d: Decision): Quarter {
  checkDecision(run, d);
  const s0 = run.end, { s, r } = playQuarter(run.w, s0, d);
  const quarter: Quarter = { s0, d: structuredClone(d), r, s1: s };
  run.qs.push(quarter);
  run.end = s;
  return quarter;
}

/** Play a whole game with a policy. */
export function playPolicy(sc: VentureScenario, seed: number, policy: Policy, label: string, opts: { vary?: boolean } = {}): Run {
  const run = newRun(sc, seed, label, opts);
  while (!isDone(run)) lockQuarter(run, policy(run.w, run.end));
  return run;
}

/** The same world, played again with fixed decisions. Used to rewind, and to test that the server plays what it is sent. */
export function replay(sc: VentureScenario, seed: number, decisions: Decision[], opts: { vary?: boolean } = {}): Run {
  const run = newRun(sc, seed, "player", opts);
  for (const d of decisions) lockQuarter(run, d);
  return run;
}
