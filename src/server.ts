// The simulation server: the engine runs here, the browser only sees what a player may.
// Local mode listens on 127.0.0.1; PUBLIC_ORIGIN enables a single-origin HTTPS deployment.
// Accounts, sign-in tokens and runs are saved to files when paths are configured.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AuthError, createAuth } from "./auth.ts";
import { openDatabase } from "./database.ts";
import { DecisionError, ask, chooseEndgame, newRun, playCycle } from "./engine.ts";
import { baselineNotif, experimentSlots, lever as leverOf, spendOf, testable, whyNot } from "./model.ts";
import { briefingOf, loadScenario, replay } from "./play.ts";
import { bandOf, runScore } from "./score.ts";
import type { CycleReport, CycleScore, Decision, Lever, Run, Scenario, TestRecord } from "./types.ts";
import { loadVenture, ventureFiles } from "./venture/load.ts";
import { BadShape, parseDecision as parseVentureDecision } from "./venture/parse.ts";
import { preview as venturePreview } from "./venture/preview.ts";
import { checkDecision as checkVentureDecision, isDone as ventureDone, lockQuarter, newRun as newVentureRun, replay as replayVenture } from "./venture/run.ts";
import type { Run as VentureRun } from "./venture/run.ts";
import { MAX_REWINDS as VENTURE_REWINDS, finalReport as ventureFinal, listEntry as ventureEntry, publicReport as venturePublicReport, publicScenario as venturePublic, runView as ventureView } from "./venture/view.ts";
import type { VentureScenario } from "./venture/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_REWINDS = 2;
const MAX_RUNS = 200;
const MAX_BODY = 64 * 1024;

// ---------- what a player may see of a scenario ----------

/** Lever parameters that describe what a player can set, not how the world responds. */
const PUBLIC_PARAMS = ["volume_per_week_range", "targeting_options", "sample_pct_range", "weeks_range", "sets_instrumentation_level", "unlocks_targeting"];

function publicLever(l: Lever) {
  const params = Object.fromEntries(PUBLIC_PARAMS.filter((k) => l.params && k in l.params).map((k) => [k, l.params![k]]));
  return {
    id: l.id, name: l.name, kind: l.kind, category: l.category, stages: l.stages, cost_sprints: l.cost_sprints, lead_cycles: l.lead_cycles,
    available_from_cycle: l.available_from_cycle, requires: l.requires, description: l.description, player_prior: l.player_prior, risk: l.risk,
    testable: testable(l), params,
  };
}

/** What each metric reads before the player has done anything: the share-weighted baselines the company reports. */
function baselines(sc: Scenario): Record<string, number> {
  const mean = (k: "weekly_sessions" | "session_seconds" | "return_30d" | "notif_opt_out"): number => sc.segments.reduce((t, s) => t + s.share * s.baseline[k], 0);
  const placed = sc.segments.find((s) => s.id === sc.engine.post_placement_segment)!;
  return {
    weekly_sessions: mean("weekly_sessions"), session_seconds: mean("session_seconds"), return_30d: mean("return_30d"), notif_opt_out: mean("notif_opt_out"),
    mau: sc.engine.population, post_placement_engagement: sc.engine.post_placement_engagement_per_return * placed.baseline.return_30d,
  };
}

export function publicScenario(sc: Scenario) {
  const raw = sc as any;
  const base = baselines(sc);
  const ab = sc.levers.find((l) => l.kind === "experiment")!;
  return {
    id: sc.id, title: sc.title, version: raw.version, meta: { domain: raw.meta.domain, audience: raw.meta.audience, est_minutes: raw.meta.est_minutes, locale: raw.meta.locale },
    stages: sc.stages, company: raw.company, timeline: sc.timeline,
    segments: sc.segments,
    metrics: raw.metrics.map((m: any) => ({ id: m.id, label: m.label, unit: m.unit, definition: m.definition, visible_from_instrumentation: m.visible_from_instrumentation, baseline: base[m.id] })),
    capacity: sc.capacity,
    instrumentation: sc.measurement.instrumentation_levels.map((l: any) => ({ level: l.level, label: l.label })),
    notificationBaseline: sc.engine.notification_baseline,
    experiment: { sample_pct_range: ab.params!.sample_pct_range, weeks_range: ab.params!.weeks_range, cost_sprints: ab.cost_sprints, description: ab.description },
    levers: sc.levers.map(publicLever),
    questions: sc.clarify.questions.map((q) => ({ id: q.id, text: q.text })),
    reflection: raw.reflection.prompts.filter((p: any) => p.options).map((p: any) => ({ id: p.id, text: p.text, kind: p.kind, options: p.options.map((o: any) => ({ id: o.id, label: o.label })) })),
    endgame: { cycle: sc.endgame.cycle, title: raw.endgame.title, brief: raw.endgame.brief, options: raw.endgame.options.map((o: any) => ({ id: o.id, name: o.name, pitch: o.pitch })), reasoningRequired: sc.endgame.grading.reasoning_required },
    traits: sc.rubric.traits.map((t) => ({ id: t.id, name: t.name, weight: t.weight })),
    bands: sc.rubric.bands,
    readings: Object.fromEntries(sc.hidden_variables.filter((h) => h.player).map((h) => [h.id, h.player])),
    maxRewinds: MAX_REWINDS,
  };
}

// ---------- sessions ----------

interface RetentionSession { kind: "retention"; owner: string; ref: number; scenarioId: string; seed: number; run: Run; rewindsUsed: number; briefing: string[] }
interface VentureSession { kind: "venture"; owner: string; ref: number; scenarioId: string; seed: number; run: VentureRun; rewindsUsed: number; final?: ReturnType<typeof ventureFinal> }
type Session = RetentionSession | VentureSession;

const pubTest = (t: TestRecord) => ({
  cycle: t.cycle, lever: t.lever, segment: t.segment, samplePct: t.samplePct, weeks: t.weeks, stoppedEarly: t.stoppedEarly, volume: t.volume,
  estimate: t.estimate, optOutEstimate: t.optOutEstimate, verdict: t.verdict, cohorts: t.cohorts ? { rest: t.cohorts.rest, withheld: t.cohorts.withheld } : undefined,
});

function pubReport(run: Run, r: CycleReport) {
  const ev = r.eventActive ? run.sc.events.pool.find((e) => e.id === r.eventActive) : undefined;
  return {
    cycle: r.cycle, spent: r.spent, instrumentationLevel: r.instrumentationLevel, observed: r.observed, tests: r.tests.map(pubTest),
    event: ev ? { name: ev.name, signal: (ev as any).signal as string, body: (ev as any).body as string } : null,
  };
}

/** A cycle's score as it is shown while the run is on: the number, the band and each trait's share, with the evidence held back for the final report. */
const pubScore = (s: CycleScore) => ({
  cycle: s.cycle, final: s.final, band: s.band,
  traits: s.traits.map((t) => ({ id: t.id, name: t.name, pct: t.applicableWeight ? t.points / t.applicableWeight : null })),
});

function readings(run: Run) {
  const name = (via: string): string => run.sc.levers.find((l) => l.id === via)?.name ?? run.sc.clarify.questions.find((q) => q.id === via)?.text ?? via;
  return Object.entries(run.revealed).map(([id, rv]) => ({
    id, readings: rv.readings.map((r) => ({ cycle: r.cycle, via: r.via, viaName: name(r.via), fidelity: r.fidelity, covers: r.covers, value: r.value })),
  }));
}

function view(s: RetentionSession) {
  const run = s.run, sc = run.sc;
  const last = run.notif[run.notif.length - 1] ?? baselineNotif(sc);
  return {
    ref: s.ref, scenarioId: s.scenarioId,
    cycle: run.cycle, cycles: sc.timeline.cycles, done: run.done, decisions: run.decisions.length,
    phase: run.done ? (run.endgame ? "final" : "review") : "play",
    rewinds: { used: s.rewindsUsed, max: MAX_REWINDS },
    tokens: { left: sc.capacity.clarify_tokens - run.asked.length, total: sc.capacity.clarify_tokens },
    slots: run.done ? 0 : experimentSlots(sc, run.cycle),
    asked: run.asked.map((id) => ({ id, answer: run.answers[id] ?? "", at: run.askedAt[id] ?? run.cycle })),
    started: Object.entries(run.started).map(([id, st]) => ({ id, cycle: st.cycle, liveFrom: st.liveFrom, dropped: st.dropped })),
    notifications: last,
    ranking: run.ranking,
    readings: readings(run),
    reports: run.reports.map((r) => pubReport(run, r)),
    scores: run.scores.map(pubScore),
    endgameChosen: run.endgame ? run.endgame.option : null,
  };
}

/** Which levers a player could start right now with this plan, and why not for the others. */
function locks(run: Run, planned: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  // A preview may name a lever that does not exist; the error says so, and the locks are worked out from the ones that do.
  const real = planned.filter((p) => run.sc.levers.some((l) => l.id === p));
  for (const l of run.sc.levers) {
    if (!["build", "foundation", "research"].includes(l.kind)) continue;
    out[l.id] = whyNot(run, l.id, run.cycle, real.filter((p) => p !== l.id));
  }
  return out;
}

const pretty = (id: string): string => id.replace(/_/g, " ");

function finalReport(s: RetentionSession) {
  const run = s.run, sc = run.sc, total = runScore(run);
  const traits = sc.rubric.traits.map((t) => {
    let got = 0, can = 0;
    for (const cs of run.scores) { const x = cs.traits.find((y) => y.id === t.id)!; got += x.points; can += x.applicableWeight; }
    return { id: t.id, name: t.name, weight: t.weight, pct: can ? got / can : null };
  });
  const e = run.endgame!;
  const optName = (id: string): string => sc.endgame.options.find((o) => o.id === id)!.name;
  const track = sc.case_facts.tracking.find((o) => o.id === run.facts.tracking)!;
  const scope = sc.case_facts.scope.find((o) => o.id === run.facts.scope)!;
  const backing = sc.case_facts.backing.find((o) => o.id === run.facts.backing)!;
  const level = sc.measurement.instrumentation_levels.find((l: any) => l.level === track.instrumentation_level) as any;
  const event = sc.events.pool.find((x) => x.id === run.eventId) as any;
  return {
    ref: s.ref, scenarioId: s.scenarioId, score: total, band: bandOf(run, total), traits,
    cycles: run.scores.map((cs) => ({
      cycle: cs.cycle, final: cs.final, band: cs.band, traitTotal: cs.traitTotal, modifierTotal: cs.modifierTotal, modifiers: cs.modifiers,
      traits: cs.traits.map((t) => ({ id: t.id, name: t.name, subs: t.subs.map((x) => ({ id: x.id, label: x.label, level: x.level, points: x.points, maxPoints: x.maxPoints, evidence: x.evidence })) })),
    })),
    endgame: {
      option: e.option, optionName: optName(e.option), reasoning: e.reasoning, ratio: e.ratio, best: e.best,
      values: sc.endgame.options.map((o) => ({ id: o.id, name: o.name, value: e.values[o.id]! })),
    },
    case: [
      { label: "Tracking when you started", value: level ? `Level ${level.level}: ${level.label}` : pretty(track.id) },
      { label: "Stages in this quarter's brief", value: scope.stages.map((id) => sc.stages.find((s) => s.id === id)!.label).join(" and ") },
      { label: "Bets leadership would back", value: String(backing.max_bets) },
      { label: "What the market did", value: event.name as string },
    ],
    decisions: run.decisions.map((d, i) => ({ cycle: i + 1, ...d })),
    rewindsUsed: s.rewindsUsed,
  };
}

// ---------- the app ----------

// ---------- reading what the browser sends ----------

const bad = (what: string): never => { throw new HttpError(400, `that is not a decision: ${what}`); };
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, what: string, max = 2000): string => (typeof v === "string" && v.length <= max ? v : bad(what));
const num = (v: unknown, what: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(what));
const strs = (v: unknown, what: string): string[] => (Array.isArray(v) && v.length <= 60 ? v.map((x) => str(x, what, 80)) : bad(what));
const only = (o: Record<string, unknown>, allowed: string[], what: string): void => { for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${what} has no "${k}"`); };
const texts = (v: unknown, keys: string[], what: string): Record<string, string> => {
  if (!isObj(v)) return bad(what);
  only(v, keys, what);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x, `${what}.${k}`)]));
};
const STATUS_KEYS = ["hypothesis", "bet", "expected_movement", "risk"];

/** A decision as a player could have made it, or an error. Nothing the engine would have to guess about gets through. */
export function parseDecision(raw: unknown): Decision {
  if (!isObj(raw)) return bad("a decision is an object");
  only(raw, ["clarify", "focusSegment", "start", "drop", "notifications", "experiments", "impactRanking", "reflection", "status", "endgame"], "a decision");
  const d: Decision = {};
  if ("clarify" in raw) d.clarify = strs(raw.clarify, "clarify");
  if ("start" in raw) d.start = strs(raw.start, "start");
  if ("drop" in raw) d.drop = strs(raw.drop, "drop");
  if ("impactRanking" in raw) d.impactRanking = strs(raw.impactRanking, "impactRanking");
  if ("focusSegment" in raw) d.focusSegment = str(raw.focusSegment, "focusSegment", 80);
  if ("notifications" in raw) {
    if (!isObj(raw.notifications)) bad("notifications");
    d.notifications = Object.fromEntries(Object.entries(raw.notifications as Record<string, unknown>).map(([seg, n]) => {
      if (!isObj(n)) return bad("notifications");
      only(n, ["volume", "targeting"], "a notification setting");
      return [seg, { volume: num(n.volume, "volume"), ...("targeting" in n ? { targeting: str(n.targeting, "targeting", 40) as "rules" } : {}) }];
    }));
  }
  if ("experiments" in raw) {
    if (!Array.isArray(raw.experiments) || raw.experiments.length > 10) bad("experiments");
    d.experiments = (raw.experiments as unknown[]).map((e) => {
      if (!isObj(e)) return bad("a test");
      only(e, ["lever", "segment", "samplePct", "weeks", "volume", "targeting", "stoppedEarly"], "a test");
      if ("stoppedEarly" in e && typeof e.stoppedEarly !== "boolean") bad("stoppedEarly");
      return {
        lever: str(e.lever, "lever", 80), segment: str(e.segment, "segment", 80), samplePct: num(e.samplePct, "samplePct"), weeks: num(e.weeks, "weeks"),
        ...("volume" in e ? { volume: num(e.volume, "volume") } : {}), ...("targeting" in e ? { targeting: str(e.targeting, "targeting", 40) as "rules" } : {}),
        ...("stoppedEarly" in e ? { stoppedEarly: e.stoppedEarly === true } : {}),
      };
    });
  }
  if ("reflection" in raw) d.reflection = texts(raw.reflection, ["root_cause", "primary_metric", "guardrail_metric", "expected_movement"], "reflection");
  if ("status" in raw) d.status = texts(raw.status, STATUS_KEYS, "status");
  if ("endgame" in raw) {
    if (!isObj(raw.endgame)) bad("endgame");
    const e = raw.endgame as Record<string, unknown>;
    only(e, ["option", "reasoning"], "endgame");
    d.endgame = { option: str(e.option, "option", 80), ...("reasoning" in e ? { reasoning: str(e.reasoning, "reasoning") } : {}) };
  }
  return d;
}

export interface App { server: Server; scenarios: Scenario[]; ventures: VentureScenario[]; sessions: Map<number, Session> }

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const SECURITY = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function createApp(opts: { scenarioDir?: string; webDir?: string; usersFile?: string; runsFile?: string; publicOrigin?: string; contactEmail?: string; persist?: () => Promise<void> } = {}): App {
  const dir = opts.scenarioDir ?? join(here, "..", "scenarios");
  const webDir = opts.webDir ?? join(here, "..", "web");
  const publicOrigin = opts.publicOrigin ? new URL(opts.publicOrigin) : null;
  if (publicOrigin && (publicOrigin.protocol !== "https:" || publicOrigin.pathname !== "/" || publicOrigin.search || publicOrigin.hash || publicOrigin.username || publicOrigin.password)) throw new Error("PUBLIC_ORIGIN must be an HTTPS origin");
  if (publicOrigin && (!opts.usersFile || !opts.runsFile)) throw new Error("hosted mode needs persistent USERS_FILE and RUNS_FILE");
  if (publicOrigin && (!opts.contactEmail || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(opts.contactEmail))) throw new Error("hosted mode needs CONTACT_EMAIL");
  let auth = createAuth(opts.usersFile, !!publicOrigin);
  const scenarios = readdirSync(dir).filter((f) => f.endsWith(".scenario.json")).sort().map((f) => loadScenario(join(dir, f)));
  const ventures = ventureFiles(dir).map(loadVenture).sort((a, b) => (a.meta.order ?? 99) - (b.meta.order ?? 99) || a.title.localeCompare(b.title));
  const sessions = new Map<number, Session>();
  if (opts.runsFile && existsSync(opts.runsFile)) {
    const saved = JSON.parse(readFileSync(opts.runsFile, "utf8"));
    if (saved.version !== 1 || !Array.isArray(saved.runs)) throw new Error("unsupported runs file");
    for (const item of saved.runs) {
      if (!Number.isSafeInteger(item.ref) || typeof item.owner !== "string" || !["retention", "venture"].includes(item.kind)) throw new Error("invalid saved run");
      const sc = item.kind === "venture" ? ventures.find((v) => v.id === item.scenarioId) : scenarios.find((v) => v.id === item.scenarioId);
      if (!sc) throw new Error(`saved case is unavailable: ${item.scenarioId}`);
      if (item.kind === "venture") item.run.w.cs = sc;
      else item.run.sc = sc;
      sessions.set(item.ref, item as Session);
    }
  }
  const saveRuns = (): void => {
    if (!opts.runsFile) return;
    mkdirSync(dirname(opts.runsFile), { recursive: true });
    const tmp = `${opts.runsFile}.tmp`;
    try {
      const runs = [...sessions.values()].map((s) => s.kind === "venture"
        ? { ...s, run: { ...s.run, w: { ...s.run.w, cs: undefined } } }
        : { ...s, run: { ...s.run, sc: undefined } });
      writeFileSync(tmp, JSON.stringify({ version: 1, runs }), { mode: 0o600 });
      renameSync(tmp, opts.runsFile);
    } catch (e) { rmSync(tmp, { force: true }); throw e; }
  };
  const restoreFile = (file: string | undefined, contents: string | null): void => {
    if (!file) return;
    if (contents === null) rmSync(file, { force: true });
    else writeFileSync(file, contents, { mode: 0o600 });
  };
  const contentsOf = (file: string | undefined): string | null => file && existsSync(file) ? readFileSync(file, "utf8") : null;
  const authMutation = async <T>(action: () => Promise<T> | T): Promise<T> => {
    if (!opts.persist) return action();
    const oldUsers = contentsOf(opts.usersFile), oldRuns = contentsOf(opts.runsFile);
    const oldSessions = [...sessions.entries()].map(([ref, run]) => [ref, structuredClone(run)] as const);
    const result = await action();
    try { await opts.persist?.(); return result; }
    catch (e) {
      restoreFile(opts.usersFile, oldUsers);
      restoreFile(opts.runsFile, oldRuns);
      auth = createAuth(opts.usersFile, !!publicOrigin);
      sessions.clear(); for (const [ref, run] of oldSessions) sessions.set(ref, run);
      throw e;
    }
  };
  let mutationTail: Promise<void> = Promise.resolve();
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const next = mutationTail.then(action);
    mutationTail = next.then(() => {}, () => {});
    return next;
  };
  // A run's number is also the key of what the browser remembers about it (drafts, the timer), so it must not repeat after a restart:
  // it is drawn at random, not counted from a start time that a quick restart could land on again.
  const newRef = (): number => { let ref: number; do ref = randomInt(1, 2 ** 48); while (sessions.has(ref)); return ref; };
  const files = new Map(readdirSync(webDir).filter((f) => TYPES[extname(f)]).map((f) => [f, join(webDir, f)]));
  const traffic = new Map<string, { minute: number; count: number }>();
  const limit = (key: string, max: number): void => {
    const minute = Math.floor(Date.now() / 60_000);
    const seen = traffic.get(key);
    if (!seen || seen.minute !== minute) { traffic.set(key, { minute, count: 1 }); return; }
    if (++seen.count > max) throw new HttpError(429, "too many requests; try again in a minute");
    if (traffic.size > 10_000) for (const [k, v] of traffic) if (v.minute !== minute) traffic.delete(k);
  };

  const scenario = (id: string): Scenario => {
    const sc = scenarios.find((x) => x.id === id);
    if (!sc) throw new HttpError(404, "no such case");
    return sc;
  };
  /** Someone else's run is answered exactly like one that does not exist. */
  const session = (ref: string, user: string): Session => {
    const s = sessions.get(Number(ref));
    if (!s || s.owner !== user) throw new HttpError(404, "that run is not here");
    return s;
  };
  const decisionOf = (body: any): Decision => parseDecision(body?.decision);

  /** Try a step on a copy first, so a decision that fails halfway through can never leave the real run half-changed. */
  const rehearse = (s: RetentionSession, step: (copy: Run) => void): void => {
    try { step(structuredClone(s.run)); } catch (e) {
      if (e instanceof DecisionError) throw e;
      throw new HttpError(400, "that is not shaped like a decision");
    }
  };

  const ventureDecision = (body: any) => {
    try { return parseVentureDecision(body?.decision); } catch (e) {
      if (e instanceof BadShape) throw new HttpError(400, e.message);
      throw e;
    }
  };

  /** A run of a venture case. The quarter is played here; the browser gets the projection in view.ts and nothing else. */
  const ventureRun = (s: VentureSession, method: string, action: string | undefined, body: any): unknown => {
    const sc = s.run.w.cs;
    if (method === "GET" && !action) return ventureView(s.ref, s.run, s.rewindsUsed);
    if (method === "GET" && action === "final") {
      if (!ventureDone(s.run)) throw new HttpError(409, "the run is not finished");
      return (s.final ??= ventureFinal(s.ref, s.run, s.rewindsUsed));
    }
    if (method === "POST" && action === "preview") {
      const d = ventureDecision(body);
      try {
        checkVentureDecision(s.run, d);
        return { ok: true, error: null, preview: venturePreview(s.run, d) };
      } catch (e) {
        if (!(e instanceof DecisionError)) throw e;
        return { ok: false, error: e.message, preview: null };
      }
    }
    if (method === "POST" && action === "lock") {
      const d = ventureDecision(body);
      const q = lockQuarter(s.run, d);
      s.final = undefined;
      return { report: venturePublicReport(s.run, s.run.qs.indexOf(q)), state: ventureView(s.ref, s.run, s.rewindsUsed) };
    }
    if (method === "POST" && action === "rewind") {
      const target = body?.target;
      if (s.rewindsUsed >= VENTURE_REWINDS) throw new HttpError(409, "no rewinds left");
      if (!Number.isInteger(target) || target < 1 || target > s.run.qs.length) throw new HttpError(400, "there is nothing to rewind to there");
      s.run = replayVenture(sc, s.seed, s.run.qs.slice(0, target - 1).map((q) => q.d));
      s.rewindsUsed++;
      s.final = undefined;
      return ventureView(s.ref, s.run, s.rewindsUsed);
    }
    throw new HttpError(404, "not found");
  };

  const api = (method: string, path: string, body: any, user: string): unknown => {
    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "/api/cases") {
      return [
        ...scenarios.map((sc) => ({ id: sc.id, title: sc.title, company: (sc as any).company.name, one_liner: (sc as any).company.one_liner, meta: (sc as any).meta, kind: "retention" as const, cycles: sc.timeline.cycles, cycle_weeks: sc.timeline.cycle_weeks, traits: sc.rubric.traits.map((t) => t.name) })),
        ...ventures.map(ventureEntry),
      ];
    }
    if (method === "GET" && (m = path.match(/^\/api\/cases\/([\w-]+)$/))) {
      const v = ventures.find((x) => x.id === m![1]);
      return v ? venturePublic(v) : publicScenario(scenario(m[1]!));
    }
    if (method === "POST" && path === "/api/runs") {
      const seed = Number.isInteger(body?.seed) ? body.seed : randomInt(1, 2 ** 31 - 1);
      const vsc = ventures.find((x) => x.id === String(body?.scenario));
      if (vsc) {
        const v: VentureSession = { kind: "venture", owner: user, ref: newRef(), scenarioId: vsc.id, seed, run: newVentureRun(vsc, seed), rewindsUsed: 0 };
        sessions.set(v.ref, v);
        if (sessions.size > MAX_RUNS) {
          const old = [...sessions.values()].find((x) => x.owner === user && x.ref !== v.ref);
          if (!old) throw new HttpError(503, "the server has reached its run limit");
          sessions.delete(old.ref);
        }
        return ventureView(v.ref, v.run, 0);
      }
      const sc = scenario(String(body?.scenario));
      const s: Session = { kind: "retention", owner: user, ref: newRef(), scenarioId: sc.id, seed, run: newRun(sc, seed), rewindsUsed: 0, briefing: [] };
      sessions.set(s.ref, s);
      if (sessions.size > MAX_RUNS) {
        const old = [...sessions.values()].find((x) => x.owner === user && x.ref !== s.ref);
        if (!old) throw new HttpError(503, "the server has reached its run limit");
        sessions.delete(old.ref);
      }
      return view(s);
    }
    if ((m = path.match(/^\/api\/runs\/(\d+)(?:\/(\w+))?$/))) {
      const s = session(m[1]!, user), action = m[2];
      if (s.kind === "venture") return ventureRun(s, method, action, body);
      if (method === "GET" && !action) return view(s);
      if (method === "GET" && action === "final") {
        if (!(s.run.done && s.run.endgame)) throw new HttpError(409, "the run is not finished");
        return finalReport(s);
      }
      if (method === "POST" && action === "ask") {
        const ids = body?.ids;
        if (!Array.isArray(ids) || ids.some((x: unknown) => typeof x !== "string")) throw new HttpError(400, "ids must be a list of question ids");
        ask(s.run, ids);
        s.briefing = briefingOf(s.run);
        return view(s);
      }
      if (method === "POST" && action === "preview") {
        // Play the decision on a copy and report only whether it stands. The copy's results never leave this function.
        const d = decisionOf(body);
        const planned = d.start ?? [];
        try {
          if (s.run.done) throw new DecisionError("the run is finished");
          playCycle(structuredClone(s.run), d);
          return { ok: true, error: null, spend: spendOf(s.run.sc, d), locks: locks(s.run, planned) };
        } catch (e) {
          if (!(e instanceof DecisionError)) throw new HttpError(400, "that decision is not shaped like one");
          return { ok: false, error: e.message, spend: spendOf(s.run.sc, d), locks: locks(s.run, planned) };
        }
      }
      if (method === "POST" && action === "lock") {
        const d = decisionOf(body);
        rehearse(s, (copy) => playCycle(copy, d));
        const res = playCycle(s.run, d);
        return { report: pubReport(s.run, res.report), score: pubScore(res.score), state: view(s) };
      }
      if (method === "POST" && action === "endgame") {
        const o = body?.option;
        if (typeof o !== "string") throw new HttpError(400, "an option is required");
        const choice = { option: o, reasoning: body.reasoning === undefined ? undefined : str(body.reasoning, "reasoning"), status: body.status === undefined ? undefined : texts(body.status, STATUS_KEYS, "status") };
        rehearse(s, (copy) => chooseEndgame(copy, choice));
        chooseEndgame(s.run, choice);
        return view(s);
      }
      if (method === "POST" && action === "rewind") {
        const target = body?.target;
        if (s.rewindsUsed >= MAX_REWINDS) throw new HttpError(409, "no rewinds left");
        if (!Number.isInteger(target) || target < 1 || target > s.run.decisions.length) throw new HttpError(400, "there is nothing to rewind to there");
        s.run = replay(scenario(s.scenarioId), s.seed, s.run.decisions.slice(0, target - 1), { briefing: s.briefing });
        s.rewindsUsed++;
        return view(s);
      }
    }
    throw new HttpError(404, "not found");
  };

  const readBody = (req: IncomingMessage): Promise<any> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      // Past the limit nothing more is kept, but the connection is not cut: that would reset it before the 413 could be read.
      req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) reject(new HttpError(413, "too large")); else chunks.push(c); });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new HttpError(400, "not JSON")); }
      });
      req.on("error", reject);
    });

  const send = (res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void => { res.writeHead(status, { ...SECURITY, ...extra, "Content-Type": type }); res.end(body); };
  const sendJson = (res: ServerResponse, status: number, v: unknown, extra?: Record<string, string>): void => send(res, status, "application/json; charset=utf-8", JSON.stringify(v), extra);

  /** Sign-in, sign-up, sign-out and "who am I": the only API routes that work without a session. */
  const authApi = async (res: ServerResponse, method: string, path: string, body: any, cookie: string | undefined): Promise<void> => {
    if (method === "GET" && path === "/api/auth/me") {
      const user = auth.userOf(cookie);
      if (!user) throw new HttpError(401, "sign in first");
      return sendJson(res, 200, { user });
    }
    if (method === "POST" && (path === "/api/auth/login" || path === "/api/auth/register")) {
      const { user, cookie: set } = await authMutation(() => (path.endsWith("login") ? auth.login : auth.register)(body?.username, body?.password));
      return sendJson(res, 200, { user }, { "Set-Cookie": set });
    }
    if (method === "POST" && path === "/api/auth/logout") return sendJson(res, 200, { ok: true }, { "Set-Cookie": await authMutation(() => auth.logout(cookie)) });
    if (method === "POST" && path === "/api/auth/delete") {
      const set = await authMutation(() => {
        const user = auth.userOf(cookie);
        if (!user) throw new HttpError(401, "sign in first");
        for (const [ref, run] of sessions) if (run.owner === user) sessions.delete(ref);
        saveRuns();
        return auth.deleteAccount(cookie);
      });
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": set });
    }
    throw new HttpError(404, "not found");
  };

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/healthz") return send(res, 200, "text/plain; charset=utf-8", "ok");
      const port = (server.address() as { port: number } | null)?.port;
      const host = String(req.headers.host ?? "");
      if (publicOrigin ? host !== publicOrigin.host : !(host === `127.0.0.1:${port}` || host === `localhost:${port}`)) throw new HttpError(403, "unexpected host");
      const origin = req.headers.origin;
      if (origin && origin !== (publicOrigin?.origin ?? `http://${host}`)) throw new HttpError(403, "unexpected origin");
      const url = new URL(req.url ?? "/", `http://${host}`);
      const method = req.method ?? "GET";
      if (publicOrigin) {
        const peer = req.socket.remoteAddress ?? "unknown";
        limit(`all:${peer}`, 180);
        if (method === "POST" && /^\/api\/auth\/(?:register|login)$/.test(url.pathname)) limit(`auth:${peer}`, 12);
      }
      if (url.pathname.startsWith("/api/")) {
        if (method === "POST" && (req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === "content-type").length !== 1 || String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase() !== "application/json")) throw new HttpError(415, "send JSON");
        const body = method === "POST" ? await readBody(req) : undefined;
        if (url.pathname.startsWith("/api/auth/")) return method === "POST"
          ? await serial(() => authApi(res, method, url.pathname, body, req.headers.cookie))
          : await authApi(res, method, url.pathname, body, req.headers.cookie);
        const user = auth.userOf(req.headers.cookie);
        if (!user) throw new HttpError(401, "sign in first");
        if (method !== "POST") return sendJson(res, 200, api(method, url.pathname, body, user));
        if (/^\/api\/runs\/\d+\/preview$/.test(url.pathname)) return sendJson(res, 200, api(method, url.pathname, body, user));
        return await serial(async () => {
          const before = [...sessions.entries()].map(([ref, run]) => [ref, structuredClone(run)] as const);
          try {
            const result = api(method, url.pathname, body, user);
            saveRuns();
            await opts.persist?.();
            return sendJson(res, 200, result);
          } catch (e) { sessions.clear(); for (const [ref, run] of before) sessions.set(ref, run); saveRuns(); throw e; }
        });
      }
      if (method !== "GET") throw new HttpError(405, "method not allowed");
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const file = files.get(name);
      if (!file) throw new HttpError(404, "not found");
      if (name === "legal.html") return send(res, 200, TYPES[extname(name)]!, readFileSync(file, "utf8").replaceAll("{{CONTACT_EMAIL}}", opts.contactEmail ?? "the person running this server"));
      return send(res, 200, TYPES[extname(name)]!, readFileSync(file));
    } catch (e) {
      if (e instanceof HttpError || e instanceof AuthError) return sendJson(res, e.status, { error: e.message });
      if (e instanceof DecisionError) return sendJson(res, 422, { error: e.message });
      console.error(e);
      return sendJson(res, 500, { error: "something went wrong on the server" });
    }
  });
  return { server, scenarios, ventures, sessions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const start = async () => {
    const port = Number(process.env.PORT ?? 4310);
    const origin = process.env.PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL;
    const usersFile = process.env.USERS_FILE ?? join(here, "..", "data", "users.json");
    const runsFile = process.env.RUNS_FILE ?? join(here, "..", "data", "runs.json");
    if (origin && !process.env.DATABASE_URL) throw new Error("hosted mode requires DATABASE_URL; its local filesystem may be ephemeral");
    const database = process.env.DATABASE_URL ? await openDatabase(usersFile, runsFile, process.env.DATABASE_URL) : null;
    const app = createApp({ usersFile, runsFile, publicOrigin: origin, contactEmail: process.env.CONTACT_EMAIL, persist: database?.persist });
    app.server.listen(port, origin ? "0.0.0.0" : "127.0.0.1", () => console.log(`pm-sim is at ${origin ?? `http://127.0.0.1:${port}`} (${app.scenarios.length + app.ventures.length} cases)`));
  };
  start().catch((e) => { console.error(e); process.exitCode = 1; });
}
