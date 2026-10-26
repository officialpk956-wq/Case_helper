// The causal model: what is live, how much each lever is worth right now, and the true metrics that result.
// Everything here is pure. It reads the run and the scenario and never mutates either.
import type { Decision, Effects, Lever, NotifState, Run, Scenario, SegmentMetrics, StartedLever, TrueMetrics } from "./types.ts";
import { normal } from "./rng.ts";

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Complement rule: independent lifts overlap, so two 10% lifts give 19%, not 20%. Works for negatives too. */
export const combine = (xs: number[]): number => 1 - xs.reduce((p, x) => p * (1 - x), 1);

const FATIGUE = "notif_fatigue_ceiling";
const NOTIF_EXPONENT = 0.6;

export function lever(run: Run, id: string): Lever {
  const l = run.sc.levers.find((x) => x.id === id);
  if (!l) throw new Error(`unknown lever ${id}`);
  return l;
}

export const hiddenTruth = (run: Run, id: string): any => run.sc.hidden_variables.find((h) => h.id === id)?.truth;

export const isLive = (s: StartedLever | undefined, c: number): boolean => !!s && s.liveFrom <= c && (s.dropped === undefined || c < s.dropped);

/** What the company can already see in a session, before the player does anything. */
export const baseInstrLevel = (run: Run): number => run.sc.case_facts.tracking.find((o) => o.id === run.facts.tracking)!.instrumentation_level;
/** The stages of the journey this quarter's brief covers. */
export const scopeStages = (run: Run): string[] => run.sc.case_facts.scope.find((o) => o.id === run.facts.scope)!.stages;
/** A build that only serves stages the brief rules out is stopped at launch by the team that owns them. */
export const outOfScope = (run: Run, l: Lever): boolean => l.kind === "build" && l.stages.every((s) => !scopeStages(run).includes(s));
/** How many bets leadership will back this quarter. */
export const maxBets = (run: Run): number => run.sc.case_facts.backing.find((o) => o.id === run.facts.backing)!.max_bets;
/** Leadership backs the first builds the player starts; a later one is stopped at launch. A dropped bet keeps its place. */
const unbacked = (run: Run, l: Lever): boolean => l.kind === "build" && Object.keys(run.started).filter((id) => lever(run, id).kind === "build").indexOf(l.id) >= maxBets(run);
/** A build that is stopped at launch, outside the brief or beyond the bets leadership will back, costs capacity and delivers nothing. */
export const blocked = (run: Run, l: Lever): boolean => outOfScope(run, l) || unbacked(run, l);
/** A foundation the company already has counts as live for whatever needs it. */
const provided = (run: Run, id: string): boolean => { const set = lever(run, id).params?.sets_instrumentation_level; return typeof set === "number" && set > 0 && set <= baseInstrLevel(run); };

export const liveLever = (run: Run, id: string, c: number): boolean => isLive(run.started[id], c) && !blocked(run, lever(run, id));

export function instrLevel(run: Run, c: number): number {
  let lvl = baseInstrLevel(run);
  for (const l of run.sc.levers) {
    const set = l.params?.sets_instrumentation_level;
    if (typeof set === "number" && liveLever(run, l.id, c)) lvl = Math.max(lvl, set);
  }
  return lvl;
}

/** How much of a lever's full effect applies in cycle c. `hypothetical` ignores whether it is live (used by A/B tests). */
export function leverScale(run: Run, l: Lever, c: number, hypothetical = false): number {
  let k = 1;
  if (blocked(run, l)) return 0;
  if (!hypothetical) {
    if (!liveLever(run, l.id, c)) return 0;
    k = c === run.started[l.id]!.liveFrom ? run.sc.engine.ramp_first_live_cycle : 1;
  }
  const soft = l.soft_requires;
  if (soft && !soft.levers.every((id) => liveLever(run, id, c))) k *= soft.else_multiplier;
  const curve = run.sc.engine.quality_scaled_levers[l.id];
  if (curve) {
    const t = hiddenTruth(run, curve) as Record<string, number>;
    const top = Math.max(...Object.keys(t).map(Number));
    k *= t[String(Math.min(instrLevel(run, c), top))] ?? 1;
  }
  return k;
}

/** Why a lever cannot be started in cycle c, or null if it can. `planned` are levers already chosen this cycle. */
export function whyNot(run: Run, id: string, c: number, planned: string[] = []): string | null {
  const l = run.sc.levers.find((x) => x.id === id);
  if (!l) return `unknown lever ${id}`;
  if (!["build", "foundation", "research"].includes(l.kind)) return `${id} is not something you start`;
  if (run.started[id] || planned.includes(id)) return `${id} is already started`;
  if (c < l.available_from_cycle) return `${id} is not available until cycle ${l.available_from_cycle}`;
  // Something with no lead time and planned in this same decision is live from the start of the cycle.
  const liveNow = (rid: string): boolean => liveLever(run, rid, c) || provided(run, rid) || (planned.includes(rid) && lever(run, rid).lead_cycles === 0);
  const plannedLevel = planned.reduce((m, pid) => { const pl = lever(run, pid); const set = pl.params?.sets_instrumentation_level; return typeof set === "number" && pl.lead_cycles === 0 ? Math.max(m, set) : m; }, 0);
  const need = l.requires?.instrumentation_level ?? 0;
  if (Math.max(instrLevel(run, c), plannedLevel) < need) return `${id} needs instrumentation level ${need}`;
  for (const r of l.requires?.levers ?? []) if (!liveNow(r)) return `${id} needs ${r} to be live`;
  return null;
}

export const dialLever = (run: Run): Lever => {
  const l = run.sc.levers.find((x) => x.kind === "dial");
  if (!l) throw new Error("scenario has no dial lever");
  return l;
};

export const ceiling = (run: Run, segId: string): number => (hiddenTruth(run, FATIGUE) as Record<string, number>)[segId] ?? Infinity;

/** Relative lift in weekly sessions from the notification dial, measured against current practice. */
export function notifLift(run: Run, segId: string, st: { volume: number; targeting: string }): number {
  const m = dialLever(run).params!.model;
  const gain: number = m.gain_weekly_sessions_rel_per_vol_pow_0_6[segId] ?? 0;
  const mult: Record<string, number> = m.targeting_multiplier;
  const base = run.sc.engine.notification_baseline;
  return gain * (st.volume ** NOTIF_EXPONENT * mult[st.targeting]! - base.volume[segId]! ** NOTIF_EXPONENT * mult[base.targeting]!);
}

const ZERO: Required<Effects> = { weekly_sessions_rel: 0, session_seconds_rel: 0, return_30d_rel: 0, notif_opt_out_abs: 0 };

/** The market event's effect in cycle t, after what the player did to absorb it. */
export function eventEffect(run: Run, t: number, segId: string): Required<Effects> {
  const e0 = run.sc.events.cycle;
  if (t < e0 || run.mitigation === null) return ZERO;
  const p = run.sc.engine.event_persistence[t - e0] ?? 0;
  const k = p * (1 - run.mitigation);
  const ef = run.sc.events.pool.find((e) => e.id === run.eventId)?.effects[segId] ?? {};
  return {
    weekly_sessions_rel: (ef.weekly_sessions_rel ?? 0) * k,
    session_seconds_rel: (ef.session_seconds_rel ?? 0) * k,
    return_30d_rel: (ef.return_30d_rel ?? 0) * k,
    notif_opt_out_abs: (ef.notif_opt_out_abs ?? 0) * k,
  };
}

/** Opt-outs above baseline in cycle c. Damage persists: part of last cycle's excess carries over. */
export function optOutExcess(run: Run, c: number, segId: string): number {
  const slope = dialLever(run).params!.model.opt_out_abs_per_notification_over_ceiling as number;
  let excess = 0;
  for (let t = 1; t <= c; t++) {
    const st = run.notif[t - 1]![segId]!;
    const over = Math.max(0, st.volume - ceiling(run, segId));
    excess = run.sc.engine.opt_out_persistence * excess + slope * over + eventEffect(run, t, segId).notif_opt_out_abs;
  }
  return excess;
}

export function trueMetrics(run: Run, c: number): TrueMetrics {
  const e = run.sc.engine;
  const segments: Record<string, SegmentMetrics> = {};
  let ws = 0, secs = 0, ret = 0, opt = 0, wsBase = 0;
  for (const seg of run.sc.segments) {
    const sess: number[] = [], sec: number[] = [], rtn: number[] = [];
    for (const l of run.sc.levers) {
      if (!l.effects) continue;
      const k = leverScale(run, l, c);
      const ef = l.effects[seg.id];
      if (!k || !ef) continue;
      if (ef.weekly_sessions_rel) sess.push(ef.weekly_sessions_rel * k);
      if (ef.session_seconds_rel) sec.push(ef.session_seconds_rel * k);
      if (ef.return_30d_rel) rtn.push(ef.return_30d_rel * k);
    }
    const lift = notifLift(run, seg.id, run.notif[c - 1]![seg.id]!);
    sess.push(lift);
    rtn.push(e.notif_return_per_session_lift * lift);

    const optOut = clamp(seg.baseline.notif_opt_out + optOutExcess(run, c, seg.id), 0, e.opt_out_cap);
    const penalty = e.opt_out_return_penalty * (optOut - seg.baseline.notif_opt_out);
    const ev = eventEffect(run, c, seg.id);
    const b = seg.baseline;
    const m: SegmentMetrics = {
      weekly_sessions: b.weekly_sessions * (1 + combine(sess)) * (1 + ev.weekly_sessions_rel),
      session_seconds: b.session_seconds * (1 + combine(sec)) * (1 + ev.session_seconds_rel),
      return_30d: clamp(b.return_30d * (1 + combine(rtn) - penalty) * (1 + ev.return_30d_rel), 0, e.return_30d_cap),
      notif_opt_out: optOut,
    };
    segments[seg.id] = m;
    ws += seg.share * m.weekly_sessions;
    secs += seg.share * m.session_seconds;
    ret += seg.share * m.return_30d;
    opt += seg.share * m.notif_opt_out;
    wsBase += seg.share * b.weekly_sessions;
  }
  const wobble = e.mau_wobble_sd * normal(run.seed, "mau", c);
  return {
    segments,
    weekly_sessions: ws,
    session_seconds: secs,
    return_30d: ret,
    notif_opt_out: opt,
    mau: e.population * (1 + e.mau_sessions_elasticity * (ws / wsBase - 1)) * (1 + wobble),
    post_placement_engagement: e.post_placement_engagement_per_return * segments[e.post_placement_segment]!.return_30d,
  };
}

/** Engineering sprints a decision commits: new levers, the notification dial if touched, and each A/B test. */
export function spendOf(sc: Scenario, d: Decision): number {
  const byId = new Map(sc.levers.map((l) => [l.id, l]));
  let s = 0;
  for (const id of d.start ?? []) s += byId.get(id)?.cost_sprints ?? 0;
  const dial = sc.levers.find((l) => l.kind === "dial");
  if (dial && d.notifications && Object.keys(d.notifications).length) s += dial.cost_sprints;
  const ab = sc.levers.find((l) => l.kind === "experiment");
  s += (d.experiments?.length ?? 0) * (ab?.cost_sprints ?? 0);
  return s;
}

/** The notification policy the company runs today, in every segment. */
export const baselineNotif = (sc: Scenario): NotifState =>
  Object.fromEntries(sc.segments.map((s) => [s.id, { volume: sc.engine.notification_baseline.volume[s.id]!, targeting: sc.engine.notification_baseline.targeting }]));

/** How many tests a decision in cycle c may run. The last cycle can have its own number: nothing is built there, so there is room for one more. */
export const experimentSlots = (sc: Scenario, c: number): number =>
  (c === sc.timeline.cycles ? sc.capacity.experiment_slots_final_cycle : undefined) ?? sc.capacity.experiment_slots_per_cycle;

/** What a player can put in an experiment slot: a notification policy, a pricing offer, a holdout, or a build with an effect. */
export const testable = (l: Lever): boolean => l.kind === "dial" || l.kind === "offer" || l.kind === "holdout" || (l.kind === "build" && !!l.effects);

export const baselineReturn = (run: Run): number => run.sc.segments.reduce((t, s) => t + s.share * s.baseline.return_30d, 0);
export const baselineOptOut = (run: Run): number => run.sc.segments.reduce((t, s) => t + s.share * s.baseline.notif_opt_out, 0);

export function noiseSd(run: Run, level: number): number {
  const lv = run.sc.measurement.instrumentation_levels;
  return (lv.find((x) => x.level === level) ?? lv[lv.length - 1]!).noise_sd;
}

/** What the player sees: only metrics their instrumentation can see, with measurement noise. */
export function observe(run: Run, c: number, t: TrueMetrics): Record<string, number> {
  const level = instrLevel(run, c);
  const sd = noiseSd(run, level);
  const out: Record<string, number> = {};
  for (const m of run.sc.metrics) {
    if (m.visible_from_instrumentation > level) continue;
    const v = (t as any)[m.id];
    if (typeof v !== "number") continue;
    out[m.id] = m.kind === "vanity" ? v : Math.max(0, v * (1 + sd * (m.noise_scale ?? 1) * normal(run.seed, "obs", c, m.id)));
  }
  return out;
}
