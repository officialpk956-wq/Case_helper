// Reading a decision that arrives from a browser. Nothing the engine would have to guess about gets through: unknown keys, wrong types
// and oversize values are refused here, and what is merely impossible in this case (an item that does not exist, a reserve out of range)
// is refused by checkDecision, with a reason a player can read.
import type { Decision } from "./model.ts";
import type { Expectation, Pace, Priority } from "./types.ts";

export class BadShape extends Error {}

const bad = (what: string): never => { throw new BadShape(`that is not a decision: ${what}`); };
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, what: string, max = 80): string => (typeof v === "string" && v.length <= max ? v : bad(what));
const num = (v: unknown, what: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(what));
const strs = (v: unknown, what: string, max = 40): string[] => (Array.isArray(v) && v.length <= max ? v.map((x) => str(x, what)) : bad(what));
const only = (o: Record<string, unknown>, allowed: string[], what: string): void => { for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${what} has no "${k}"`); };

export function parseDecision(raw: unknown): Decision {
  if (!isObj(raw)) return bad("a decision is an object");
  only(raw, ["priority", "roadmap", "drop", "reserve", "pace", "research", "instrument", "experiments", "dives", "asks", "commit", "event", "plan", "reflection"], "a decision");
  for (const k of ["roadmap", "reserve", "pace", "research", "instrument"]) if (!(k in raw)) bad(`"${k}" is required`);
  const reserve = raw.reserve;
  if (!isObj(reserve)) return bad("reserve");
  only(reserve, ["rel", "debt"], "reserve");
  const d: Decision = {
    roadmap: strs(raw.roadmap, "roadmap"),
    reserve: { rel: num(reserve.rel, "reserve.rel"), debt: num(reserve.debt, "reserve.debt") },
    pace: str(raw.pace, "pace", 20) as Pace,
    research: num(raw.research, "research"),
    instrument: num(raw.instrument, "instrument"),
  };
  if ("priority" in raw) d.priority = str(raw.priority, "priority", 20) as Priority;
  if ("drop" in raw) d.drop = strs(raw.drop, "drop");
  if ("experiments" in raw) d.experiments = strs(raw.experiments, "experiments");
  if ("dives" in raw) d.dives = strs(raw.dives, "dives");
  if ("commit" in raw) d.commit = strs(raw.commit, "commit");
  if ("plan" in raw) d.plan = str(raw.plan, "plan");
  if ("asks" in raw) {
    const a = raw.asks;
    if (!isObj(a)) return bad("asks");
    only(a, ["marketing", "contractors"], "asks");
    d.asks = { ...("marketing" in a ? { marketing: num(a.marketing, "asks.marketing") } : {}), ...("contractors" in a ? { contractors: num(a.contractors, "asks.contractors") } : {}) };
  }
  if ("event" in raw) {
    const e = raw.event;
    if (!isObj(e)) return bad("event");
    only(e, ["evidence", "reading", "direction"], "event");
    if (typeof e.evidence !== "boolean") bad("event.evidence");
    d.event = { evidence: e.evidence as boolean, reading: str(e.reading, "event.reading"), direction: str(e.direction, "event.direction") };
  }
  if ("reflection" in raw) {
    const r = raw.reflection;
    if (!isObj(r)) return bad("reflection");
    only(r, ["root_cause", "expected"], "reflection");
    d.reflection = { root_cause: str(r.root_cause, "reflection.root_cause"), expected: str(r.expected, "reflection.expected", 20) as Expectation };
  }
  return d;
}
