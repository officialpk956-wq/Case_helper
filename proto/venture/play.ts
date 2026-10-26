// PROTOTYPE. A run is four quarters of one decision-maker in one world.
import { newState, playQuarter } from "./model.ts";
import type { Decision, Report, State, World } from "./model.ts";

export type Bot = (w: World, s: State) => Decision;
export interface Quarter { s0: State; d: Decision; r: Report; s1: State }
export interface Run { w: World; bot: string; start: State; qs: Quarter[]; end: State }

/** The market event arrives in the third quarter. */
export const EVENT_QUARTER = 3;

export function playRun(w: World, bot: Bot, name: string): Run {
  let s = newState(w.cs);
  const start = structuredClone(s), qs: Quarter[] = [];
  for (let q = 1; q <= 4; q++) {
    const d = bot(w, s);
    const { s: s1, r } = playQuarter(w, s, d, { evQ: EVENT_QUARTER });
    qs.push({ s0: s, d, r, s1 });
    s = s1;
  }
  return { w, bot: name, start, qs, end: s };
}
