// Types for the parts of a scenario file the engine reads, plus the run, decision and score shapes.
// The JSON Schema is the contract; these types are the engine's view of it.

export type Level = "full" | "part" | "none" | "na";
export type Targeting = "broadcast" | "rules" | "preference_model";
export type Params = Record<string, any>;

export interface Rule { fn: string; params: Params }

export interface Effects {
  weekly_sessions_rel?: number;
  session_seconds_rel?: number;
  return_30d_rel?: number;
  notif_opt_out_abs?: number;
}

export interface Lever {
  id: string;
  name: string;
  kind: "build" | "dial" | "research" | "experiment" | "foundation" | "offer" | "holdout";
  category: string;
  stages: string[];
  cost_sprints: number;
  lead_cycles: number;
  available_from_cycle: number;
  requires?: { instrumentation_level?: number; levers?: string[] };
  soft_requires?: { levers: string[]; else_multiplier: number };
  reveals_hidden?: string[];
  effects?: Record<string, Effects>;
  params?: Params;
  description?: string;
  player_prior?: string;
  risk?: string;
}

export interface Segment {
  id: string;
  name: string;
  share: number;
  baseline: { weekly_sessions: number; session_seconds: number; return_30d: number; notif_opt_out: number };
}

export interface HiddenVariable {
  id: string;
  /** Shown to a player only as the name and number format of a reading, never the description or the truth. */
  player?: { label: string; percent?: boolean };
  truth: any;
  reveal: { via: { kind: "clarify" | "lever" | "event"; ref: string; fidelity?: "exact" | "directional" | "noisy" | "none" }[]; fidelity: "exact" | "directional" | "noisy" | "none" };
}

/** What one answer says in one world, and what it teaches the player about this case (`learns`, read by bots; humans read the text). */
export interface AnswerCase { text: string; learns?: Record<string, string> }
/** A fixed answer, or one that depends on a fact about this seed's case (`by` names the fact). */
export type Answer = string | { by: string; cases: Record<string, AnswerCase> };

export interface Question {
  id: string;
  text: string;
  relevance: "high" | "medium" | "low";
  answer: Answer;
  /** The question carries this quarter's signal when the seed's market event is one of these. */
  signal_for?: string[];
  reveals?: string[];
  bias_trap?: boolean;
}

/** Facts about the case that differ from seed to seed and that clarifying answers reveal. */
export interface CaseFacts {
  /** What the company can already see inside a session. */
  tracking: { id: string; weight: number; instrumentation_level: number }[];
  /** Which stages of the journey leadership has put in this quarter's brief. */
  scope: { id: string; weight: number; stages: string[] }[];
  /** How many bets leadership will back: the first builds the player starts. */
  backing: { id: string; weight: number; max_bets: number }[];
}

/** Something a player can have learned from: a question asked, or a reading of a hidden variable (from research, a test or a question). */
export type Backing = { clarify: string } | { reading: string };

export interface Subcriterion {
  id: string;
  label: string;
  rule: Rule;
  /** A claim about the world earns at most `part` until the player had learned from one of these. */
  backed_by?: { any_of: Backing[]; missing: string };
  evidence: { full: string; part: string; none: string };
}

export interface Trait { id: string; name: string; weight: number; subcriteria: Subcriterion[] }
export interface Modifier { id: string; points: number; rule: Rule; why: string }

export interface EventDef {
  id: string;
  name: string;
  weight: number;
  effects: Record<string, Effects>;
  mitigations: { when: Rule; factor: number }[];
}

export interface EngineConstants {
  ramp_first_live_cycle: number;
  return_30d_cap: number;
  opt_out_cap: number;
  opt_out_persistence: number;
  opt_out_return_penalty: number;
  notif_return_per_session_lift: number;
  notification_baseline: { volume: Record<string, number>; targeting: Targeting };
  event_persistence: number[];
  event_max_mitigation: number;
  population: number;
  mau_sessions_elasticity: number;
  mau_wobble_sd: number;
  post_placement_segment: string;
  post_placement_engagement_per_return: number;
  movement_thresholds: { flat_below: number; small_below: number };
  test_ship_threshold: number;
  test_kill_threshold: number;
  guardrail_breach_abs: number;
  quality_scaled_levers: Record<string, string>;
  test_reveals: Record<string, string[]>;
  variation: { effect_sd: number; hidden: Record<string, { sd: number; min?: number; max?: number; min_multiple_of_baseline_volume?: number }> };
  reveal: { noisy_sd: number; directional_sd: number; bucket_ratio: number };
}

export interface Scenario {
  id: string;
  title: string;
  /** The journey's two stages in order: the one players work on, then the one after the goal. */
  stages: { id: string; label: string }[];
  timeline: { cycles: number; cycle_weeks: number };
  segments: Segment[];
  metrics: { id: string; kind: string; visible_from_instrumentation: number; noise_scale?: number }[];
  capacity: { eng_sprints_per_cycle: number; clarify_tokens: number; experiment_slots_per_cycle: number; experiment_slots_final_cycle?: number };
  engine: EngineConstants;
  levers: Lever[];
  hidden_variables: HiddenVariable[];
  measurement: {
    instrumentation_levels: { level: number; noise_sd: number }[];
    experiment: { base_noise_sd: number; min_weeks: number; min_sample_pct: number; peek_penalty_sd: number };
  };
  case_facts: CaseFacts;
  clarify: { questions: Question[] };
  reflection: { prompts: { id: string; kind: string; options?: { id: string }[]; truth?: Params }[] };
  events: { selection: "fixed" | "seeded"; cycle: number; pool: EventDef[] };
  rubric: {
    level_factors: { full: number; part: number; none: number };
    bands: { min: number; label: string }[];
    traits: Trait[];
    modifiers: Modifier[];
  };
  endgame: {
    cycle: number;
    options: { id: string; name: string; value_model: Rule }[];
    grading: { within_best_full: number; within_best_part: number; reasoning_required: boolean };
  };
  calibration: { bots: { id: string; policy: string; expected_final: { min: number; max: number } }[]; invariants: string[]; playbook?: Playbook };
}

// ---------- what the calibration bots do in a case ----------

/** A test an evidence-driven bot runs. A segment may be `$post_first` or `$during_first`: the one the brief points to. */
export interface InsightTest { lever: string; segment: string; samplePct?: number; weeks?: number; volume?: number }
/** A fixed plan: the fields every cycle shares, and what to do in each cycle (index 0 is cycle 1). */
export interface BotScript { base: Decision; cycles: Decision[] }
export interface Playbook {
  /** The briefing: the first question, then these, then the one the first answer points to (or the fallback). */
  brief: { first: string; then: string[]; fallback: string };
  /** The segment each stage is about, and which stage that is. */
  focus: { during: string; post: string; during_stage: string; post_stage: string };
  /** The analysis that shows the real cause, and the reflection answers before and after it. */
  diagnosis: { variable: string; lever: string; cause: string; unknown: string };
  scripts: {
    notification_spammer: BotScript;
    framework_first: BotScript;
    cautious_researcher: { tracked: BotScript; untracked: BotScript };
    answer_key_guesser: BotScript;
  };
  insight: {
    basic_tracking: string;
    pipeline: string;
    analytics: string;
    research: string[];
    first_cycle_tests: InsightTest[];
    second_cycle_tests: InsightTest[];
    last_cycle_tests: InsightTest[];
    /** A build that waits for its own test to win before it is started. */
    gated_build: string;
    /** The cheap build that leads when leadership has capped nothing. */
    cheap_leader: string;
    /** What a product manager builds against each threat, once told of it. */
    prepare: Record<string, string[]>;
    /** If this hidden variable has been read, this build is added to cycle 2's plan. */
    finding_adds: { variable: string; build: string };
    /** How far under the believed fatigue ceiling to set notification volumes, and when to stay further under. */
    margins: { default: number; by_threat: Record<string, number> };
  };
}

// ---------- what a player submits ----------

export interface Experiment {
  lever: string;
  segment: string;
  samplePct: number;
  weeks: number;
  stoppedEarly?: boolean;
  /** Only for the notification dial: the weekly volume being tested. */
  volume?: number;
  targeting?: Targeting;
}

export interface Reflection {
  root_cause?: string;
  primary_metric?: string;
  guardrail_metric?: string;
  expected_movement?: string;
}

export interface StatusNote { hypothesis?: string; bet?: string; expected_movement?: string; risk?: string }

export interface Decision {
  clarify?: string[];
  focusSegment?: string;
  /** Levers to start this cycle: build, foundation or research. */
  start?: string[];
  /** Levers to shut down from this cycle on. */
  drop?: string[];
  /** Set the notification dial. Persists until changed. */
  notifications?: Record<string, { volume: number; targeting?: Targeting }>;
  experiments?: Experiment[];
  /** Lever ids, best expected impact first. */
  impactRanking?: string[];
  reflection?: Reflection;
  status?: StatusNote;
  endgame?: { option: string; reasoning?: string };
}

// ---------- run state ----------

export interface StartedLever { cycle: number; liveFrom: number; dropped?: number }
export type NotifState = Record<string, { volume: number; targeting: Targeting }>;

export interface TestRecord {
  cycle: number;
  lever: string;
  segment: string;
  samplePct: number;
  weeks: number;
  stoppedEarly: boolean;
  volume?: number;
  sd: number;
  estimate: number;
  optOutEstimate?: number;
  /** A cohort holdout: the 30-day return read for the sample kept off the quarter's work and for everyone else, each with its relative noise. `estimate` is the gap between them. */
  cohorts?: { rest: number; restSd: number; withheld: number; withheldSd: number };
  verdict: "win" | "loss" | "inconclusive";
}

/** One thing the player learned: what source, at what fidelity, about which segments, and the value they were shown. */
export interface Reading {
  cycle: number;
  via: string;
  fidelity: "exact" | "directional" | "noisy";
  sd: number;
  covers: string[] | "all";
  /** exact: the truth. noisy: the same shape with numbers fuzzed. directional: { order: [...] } among siblings, or { bucket } for a number. */
  value: unknown;
}
export interface Revealed { fidelity: string; cycle: number; via: string; readings: Reading[] }

export interface SegmentMetrics { weekly_sessions: number; session_seconds: number; return_30d: number; notif_opt_out: number }
export interface TrueMetrics {
  segments: Record<string, SegmentMetrics>;
  weekly_sessions: number;
  session_seconds: number;
  return_30d: number;
  notif_opt_out: number;
  mau: number;
  post_placement_engagement: number;
}

export interface SubScore { id: string; label: string; level: Level; points: number; maxPoints: number; evidence: string }
export interface TraitScore { id: string; name: string; weight: number; applicableWeight: number; points: number; subs: SubScore[] }
export interface CycleScore {
  cycle: number;
  traits: TraitScore[];
  traitTotal: number;
  modifiers: { id: string; points: number; why: string }[];
  modifierTotal: number;
  final: number;
  band: string;
}

export interface CycleReport {
  cycle: number;
  spent: number;
  instrumentationLevel: number;
  true: TrueMetrics;
  observed: Record<string, number>;
  tests: TestRecord[];
  eventActive: string | null;
}

export interface EndgameResult { option: string; reasoning: string; values: Record<string, number>; best: number; ratio: number }

export interface Run {
  /** The world this seed drew. */
  sc: Scenario;
  /** The scenario as written: what a designer would call typical, and the player's only benchmark. */
  nominal: Scenario;
  seed: number;
  eventId: string;
  /** The next cycle to play, 1-based. */
  cycle: number;
  done: boolean;
  started: Record<string, StartedLever>;
  /** Effective notification state in each played cycle (index = cycle - 1). */
  notif: NotifState[];
  asked: string[];
  /** The cycle each question was asked in; 0 is the briefing before the first cycle. */
  askedAt: Record<string, number>;
  /** This seed's case facts: option ids for `tracking` and `scope`, and the market event as `threat`. Hidden from the player. */
  facts: Record<string, string>;
  /** What the player has learned of those facts from answers. */
  known: Record<string, string>;
  /** The text of each answer the player has read. */
  answers: Record<string, string>;
  revealed: Record<string, Revealed>;
  tests: TestRecord[];
  decisions: Decision[];
  reports: CycleReport[];
  scores: CycleScore[];
  /** Share of the event's effect that was absorbed, fixed at the event cycle. */
  mitigation: number | null;
  endgame: EndgameResult | null;
  ranking: string[];
}
