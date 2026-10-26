import { readFileSync } from "node:fs";
import type { Decision, Run, Scenario } from "./types.ts";
import { ask, chooseEndgame, newRun, playCycle } from "./engine.ts";
import type { Bot } from "./bots.ts";

export const loadScenario = (path: string): Scenario => JSON.parse(readFileSync(path, "utf8")) as Scenario;

/** Play a whole run with a bot. A bot that reads answers briefs first: it asks until it has nothing more to ask. One that waits for the final report chooses how to monetise at the review. */
export function playRun(sc: Scenario, seed: number, bot: Bot, opts: { vary?: boolean } = {}): Run {
  const run = newRun(sc, seed, opts);
  if (bot.ask) for (let q = bot.ask(run); q.length; q = bot.ask(run)) ask(run, q);
  while (!run.done) playCycle(run, bot(run));
  if (!run.endgame && bot.review) chooseEndgame(run, bot.review(run));
  return run;
}

/** The questions a run asked before its first cycle, to replay with its decisions. */
export const briefingOf = (run: Run): string[] => Object.keys(run.askedAt).filter((q) => run.askedAt[q] === 0);

/** Replay fixed decisions under a different seed: same choices, different luck, and (unless `vary: false`) a different world. */
export function replay(sc: Scenario, seed: number, decisions: Decision[], opts: { vary?: boolean; briefing?: string[] } = {}): Run {
  const run = newRun(sc, seed, opts);
  if (opts.briefing?.length) ask(run, opts.briefing);
  for (const d of decisions) playCycle(run, d);
  return run;
}
