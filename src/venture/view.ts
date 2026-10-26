// What a player may see. The engine keeps the hidden facts, the size of every effect, the overrun of every item, the market event before it
// arrives, and the true cause; everything in this file is a projection of a scenario or a run that leaves those out. The browser only ever
// receives what this file returns, and a test holds it to that.
import { hash, stream } from "../rng.ts";
import { EVENT_QUARTER, QUARTERS, blockedBy, itemOf, planValue, rootTruth, valueOf } from "./model.ts";
import type { Report } from "./model.ts";
import { holdProfit, money, opening } from "./narrative.ts";
import { doNothing, oracle } from "./planner.ts";
import { isDone, playPolicy } from "./run.ts";
import type { Run } from "./run.ts";
import { SUBS, scoreRun, subLabel } from "./score.ts";
import type { Score } from "./score.ts";
import { PARTIES, lc, termsOf } from "./types.ts";
import type { Item, VentureScenario } from "./types.ts";

export const MAX_REWINDS = 2;
export const LIMITS = { roadmap: 20, experiments: 4, dives: 8, contractors: 40, marketing: 600 };

/** A fixed order for a list of options that does not put the right one first. `last` stays at the end. */
function shuffled<T extends { id: string }>(xs: T[], key: string, last?: string): T[] {
  const rank = (x: T): number => (x.id === last ? 2 : 0) + stream(hash(key + "|" + x.id), "order")();
  return [...xs].sort((a, b) => rank(a) - rank(b));
}

export const bandOf = (sc: VentureScenario, score: number): string => sc.rubric.bands.find((b) => score >= b.min)!.label;

// ---------- the scenario ----------

export function listEntry(sc: VentureScenario) {
  return {
    id: sc.id, title: sc.title, company: sc.company.name, one_liner: sc.company.one_liner, meta: sc.meta, kind: "venture" as const,
    cycles: QUARTERS, cycle_weeks: 12, traits: sc.rubric.dimensions.map((d) => d.name),
  };
}

const publicItem = (i: Item) => ({
  id: i.id, name: i.name, about: i.about, area: i.area, eng: i.eng, design: i.design, data: i.data, understood: i.clar, sponsor: i.sponsor, serves: i.serves,
  big: !!i.big, risky: !!i.risky, favourite: !!i.fav, effects: i.effects, debt: i.debt, quality: i.quality ?? null, enables: i.enables ?? null,
  per_new: i.per_new ?? null, per_new_on: i.per_new_on ?? null, one_off: i.one_off ?? null,
  side_cost: i.side_cost ? { per_quarter: i.side_cost.per_quarter, depends_on: i.side_cost.v ?? null, cut_by: i.side_cost.cut_by ?? null, cut: i.side_cost.cut ?? null } : null,
  needs: i.needs ?? null,
  depends_on: [...new Set([...(i.scale ?? []).map((x) => x.v), ...(i.side_cost?.v ? [i.side_cost.v] : [])])],
});

export function publicScenario(sc: VentureScenario) {
  return {
    id: sc.id, title: sc.title, version: sc.version, kind: "venture" as const,
    meta: { domain: sc.meta.domain, audience: sc.meta.audience, est_minutes: sc.meta.est_minutes, locale: sc.meta.locale, seat: sc.meta.seat },
    company: sc.company, stageNames: sc.stage_names, terms: termsOf(sc),
    // What the team can see on day one of each segment. The conversion at each step, the loss rate and the cost of each step are
    // what measurement is for, and reach the player in a report only as far as the measurement level allows.
    segments: sc.segments.map((s) => ({ id: s.id, name: s.name, description: s.description, arrivals: s.inflow, customers: s.customers, arpu: s.arpu })),
    squad: { eng: sc.squad.eng, design: sc.squad.design, data: sc.squad.data },
    items: sc.items.map(publicItem),
    facts: sc.hidden.map((f) => ({ id: f.id, label: f.label, description: f.description, brief: f.brief, unit: f.unit ?? "share" })),
    plans: sc.plans,
    root: { prompt: sc.root.prompt, options: shuffled(sc.root.options, sc.id + "|root", "need_more_data") },
    measurement: sc.measurement,
    quarters: sc.quarters.map((q) => ({ n: q.n, title: q.title })),
    rubric: {
      dimensions: sc.rubric.dimensions.map((d) => ({ id: d.id, name: d.name, weight: d.weight, subs: SUBS.filter((s) => s.dim === d.id).map((s) => subLabel(s.id, sc)) })),
      bands: sc.rubric.bands,
    },
    limits: LIMITS, maxRewinds: MAX_REWINDS,
  };
}

// ---------- a run ----------

/** What a report may show of the funnel, by how well the team could measure it that quarter. */
function funnelView(sc: VentureScenario, r: Report, level: number) {
  return Object.fromEntries(sc.segments.map((sg) => {
    const f = r.funnel[sg.id]!;
    const out: Record<string, number> = { arrivals: f.n1 / f.s[0], firstPayments: f.n3, customers: f.end, average: f.avg, revenue: (f.avg * f.arpu) / 1e5 };
    if (level >= 1) { out.registered = f.n1; out.lossRate = f.churn; }
    if (level >= 2) { out.second = f.n2; out.rate1 = f.s[0]; out.rate2 = f.s[1]; out.rate3 = f.s[2]; }
    return [sg.id, out];
  }));
}

export function publicEvent(run: Run) {
  const ev = run.w.event, key = `${run.w.seed}|event`;
  return { signal: ev.signal, causes: shuffled(ev.causes, key + "|c"), directions: shuffled(ev.directions, key + "|d"), canCheck: run.end.level >= 1 };
}

export function publicReport(run: Run, k: number) {
  const sc = run.w.cs, x = run.qs[k]!, r = x.r, level = x.s0.level;
  const factView = (id: string) => { const f = sc.hidden.find((h) => h.id === id)!; return { id, label: f.label, unit: f.unit ?? "share", value: x.s1.known[id]!, brief: f.brief }; };
  const event = r.event ? run.w.event : k > 0 && run.qs[k - 1]!.r.event ? run.w.event : null;
  return {
    q: r.q, title: sc.quarters.find((b) => b.n === r.q)?.title ?? `Quarter ${r.q}`, level,
    shipped: r.completed, stalled: r.stalled.map((id) => ({ id, weeks: r.workDone[id] ?? 0 })), blocked: r.blocked,
    funnel: funnelView(sc, r, level),
    money: {
      revenue: r.revenue, serving: r.var_cost, steps: r.stage_cost, rewards: r.reward, running: r.side_cost, squad: r.team, marketing: r.marketing, requests: r.asks,
      oneOff: r.one_off, incidentLoss: r.incidentLoss, profit: r.profit, cash: r.cash,
    },
    weeks: { roadmap: r.cap.road, used: r.engUsed, analyst: r.cap.analyst, analystUsed: r.analystUsed, designFree: r.designFree, polish: r.polish, research: r.researchWeeks },
    quality: { before: { debt: x.s0.D, reliability: x.s0.R, usability: x.s0.U, morale: x.s0.M }, after: { debt: r.D, reliability: r.R, usability: r.U, morale: r.M } },
    trust: { before: x.s0.trust, after: r.trust },
    incidents: r.incidents, attrition: r.attrition,
    promises: { kept: r.commitKept, broken: r.commitBroken, list: (x.d.commit ?? []).map((id) => ({ id, kept: r.completed.includes(id) || x.s0.live[id] !== undefined })) },
    learned: {
      facts: r.readings.dived.map(factView),
      experiments: r.readings.tested.map((id) => ({ id, value: x.s1.read[id]! })),
      skipped: [
        ...(x.d.experiments ?? []).filter((id) => !r.readings.tested.includes(id)).map((id) => ({ id, kind: "experiment", why: x.s0.level < 1 ? "it needs measurement level 1" : "there were not enough weeks left" })),
        ...(x.d.dives ?? []).filter((id) => !r.readings.dived.includes(id)).map((id) => ({ id, kind: "deep dive", why: `there were not enough ${lc(termsOf(sc).data)} weeks left` })),
      ],
    },
    event: event ? { name: event.name, signal: event.signal, body: event.body, aftershock: !r.event } : null,
    decision: x.d,
  };
}

export function runView(ref: number, run: Run, rewindsUsed: number) {
  const sc = run.w.cs, s = run.end, done = isDone(run);
  return {
    ref, scenarioId: sc.id, kind: "venture" as const,
    // `cycle` and `cycles` are what the case list reads on any kind of run.
    quarter: done ? QUARTERS : s.q, quarters: QUARTERS, cycle: done ? QUARTERS : s.q, cycles: QUARTERS, done, phase: done ? "final" : "play", decisions: run.qs.length,
    rewinds: { used: rewindsUsed, max: MAX_REWINDS },
    now: {
      cash: s.cash, customers: s.C, debt: s.D, reliability: s.R, usability: s.U, morale: s.M, trust: s.trust, level: s.level,
      squad: { eng: s.heads.eng, incoming: s.heads.newEng, design: s.heads.design, data: s.heads.data },
    },
    items: sc.items.map((i) => ({
      id: i.id,
      status: s.live[i.id] !== undefined ? "live" : s.killed.includes(i.id) ? "dropped" : (s.progress[i.id] ?? 0) > 0 ? "in progress" : "open",
      weeksPut: s.progress[i.id] ?? 0, liveSince: s.live[i.id] !== undefined ? s.live[i.id]! + 1 : null,
      blocked: s.live[i.id] !== undefined || s.killed.includes(i.id) ? null : blockedBy(run.w, s, i),
    })),
    learned: {
      facts: Object.entries(s.known).map(([id, value]) => ({ id, value, at: s.dived[id] ?? 0 })),
      experiments: Object.entries(s.read).map(([id, value]) => ({ id, value, at: s.tested[id] ?? 0 })),
    },
    reports: run.qs.map((_, k) => publicReport(run, k)),
    opening: done ? null : opening(run),
    holdProfit: done ? null : holdProfit(run),
    event: !done && s.q === EVENT_QUARTER ? publicEvent(run) : null,
    last: run.qs.length ? run.qs[run.qs.length - 1]!.d : null,
  };
}

// ---------- the review ----------

const sum = (xs: number[]): number => xs.reduce((t, x) => t + x, 0);

/** Everything, once the game is over: the score and why, what was true, and what an informed manager would have done. */
export function finalReport(ref: number, run: Run, rewindsUsed: number, scored?: Score) {
  const sc = run.w.cs, seed = run.w.seed;
  const base = playPolicy(sc, seed, doNothing, "do_nothing"), bench = playPolicy(sc, seed, oracle, "oracle");
  const score = scored ?? scoreRun(run, base, bench);
  const tw = { ...run.w, expected: { effect: "true" as const, overrun: 1 } };
  const doubled = new Set(sc.rubric.doubled);
  const name = (id: string): string => itemOf(sc, id).name;
  const ev = run.w.event, hit = run.qs[EVENT_QUARTER - 1]!.r.event;
  const chosen = run.qs[QUARTERS - 1]!.d.plan ?? null;
  const planVals = sc.plans.map((p) => ({ id: p.id, name: p.name, value: planValue(run.w, run.end, p.id) }));
  const made = sum(run.qs.map((q) => q.r.profit)), madeBase = sum(base.qs.map((q) => q.r.profit)), madeBench = sum(bench.qs.map((q) => q.r.profit));
  const shippedIn: Record<string, number> = {};
  run.qs.forEach((q, k) => q.r.completed.forEach((id) => { shippedIn[id] = k + 1; }));
  return {
    ref, scenarioId: sc.id, kind: "venture" as const,
    score: score.total, base: score.base, band: bandOf(sc, score.total), idle: score.idle, rewindsUsed,
    modifiers: score.modifiers,
    dimensions: score.dims.map((d) => ({
      id: d.id, name: d.name, weight: d.weight, share: d.score,
      subs: d.subs.map((sub) => ({ id: sub.id, label: sub.label, level: sub.level, note: sub.note, doubled: doubled.has(sub.id) })),
    })),
    truth: {
      facts: sc.hidden.map((f) => ({ id: f.id, label: f.label, unit: f.unit ?? "share", brief: f.brief, truth: run.w.hidden[f.id]!, found: run.end.known[f.id] ?? null })),
      root: { truth: sc.root.options.find((o) => o.id === rootTruth(sc, run.w.hidden))!.label, said: run.qs.map((q) => q.d.reflection?.root_cause).filter(Boolean).slice(-1)[0] ?? null },
      event: {
        name: ev.name, body: ev.body, cause: ev.causes.find((c) => c.id === ev.cause)!.label, response: ev.directions.find((d) => d.id === ev.direction)!.label,
        you: run.qs[EVENT_QUARTER - 1]!.d.event ?? null,
        readRight: hit?.readingRight ?? false, checked: hit?.evidenced ?? false, answeredRight: hit?.dirOk ?? false, absorbed: hit?.absorbed ?? 0,
      },
    },
    items: sc.items.map((i) => ({
      id: i.id, name: i.name, worth: valueOf(tw, run.start, i.id), briefed: valueOf({ ...run.w, expected: { effect: 1, overrun: 1 } }, run.start, i.id), shippedIn: shippedIn[i.id] ?? null,
    })),
    plans: planVals.map((p) => ({ ...p, chosen: p.id === chosen })),
    money: { made, ifNothing: madeBase, informed: madeBench },
    informed: bench.qs.map((q, k) => ({
      q: k + 1, funded: q.d.roadmap.map(name), pace: q.d.pace, reserves: q.d.reserve, plan: q.d.plan ? sc.plans.find((p) => p.id === q.d.plan)!.name : null, profit: q.r.profit,
    })),
    quarters: run.qs.map((q, k) => ({ q: k + 1, decision: q.d, profit: q.r.profit, cash: q.r.cash, shipped: q.r.completed })),
    parties: PARTIES.map((p) => ({ id: p, label: lc(termsOf(run.w.cs).parties[p]), start: run.start.trust[p], end: run.end.trust[p] })),
    summary: { cash: money(run.end.cash) },
  };
}
