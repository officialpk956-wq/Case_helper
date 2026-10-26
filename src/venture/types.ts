// Types for a venture scenario file: a company with customers, a squad, money and hidden facts, played for four quarters.
// The JSON Schema (schema/venture.schema.json) is the contract; these types are the engine's view of it.
// Money is in rupees lakh (1 L = 100,000 rupees). A quarter is 12 working weeks.

/** The five parties whose trust in the player matters. */
export type Party = "eng" | "design" | "biz" | "lead" | "ext";
export const PARTIES: Party[] = ["eng", "design", "biz", "lead", "ext"];
export type Priority = "grow" | "activate" | "retain" | "monetise" | "quality" | "debt" | "learn";
export const PRIORITIES: Priority[] = ["grow", "activate", "retain", "monetise", "quality", "debt", "learn"];
export type Pace = "relaxed" | "steady" | "push";
export const PACES: Pace[] = ["relaxed", "steady", "push"];
export type Expectation = "down" | "flat" | "up_small" | "up_large";
export const EXPECTATIONS: Expectation[] = ["down", "flat", "up_small", "up_large"];
/** The words a case uses for the three kinds of team capacity, the three company dials and the five parties. A case that leaves one out reads in the product team's words. */
export interface Terms { eng: string; design: string; data: string; debt: string; reliability: string; usability: string; parties: Record<Party, string> }
export const DEFAULT_TERMS: Terms = {
  eng: "Engineering", design: "Design", data: "Analyst", debt: "Technical debt", reliability: "Reliability", usability: "Usability",
  parties: { eng: "Engineering", design: "Design", biz: "Business", lead: "Leadership", ext: "Outside parties" },
};
/** What a scenario file may say: any of the terms. */
export type CaseTerms = Partial<Omit<Terms, "parties">> & { parties?: Partial<Record<Party, string>> };
export const termsOf = (sc: { terms?: CaseTerms }): Terms => ({
  ...DEFAULT_TERMS, ...sc.terms, parties: { ...DEFAULT_TERMS.parties, ...sc.terms?.parties },
});
/** A term inside a sentence: 'Brand and merchandising' reads 'brand and merchandising'. */
export const lc = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
export type Seat = "product_manager" | "chief_executive" | "growth_strategy" | "developer" | "designer";

/** Relative lifts to one segment. A positive loss lift (`churn`) is a reduction, so an adverse effect on losses is negative; a negative `cost` lift makes serving cheaper. */
export interface Effect { s1?: number; s2?: number; s3?: number; churn?: number; arpu?: number; cost?: number; inflow?: number }
export const EFFECT_KEYS: (keyof Effect)[] = ["s1", "s2", "s3", "churn", "arpu", "cost", "inflow"];

export interface Segment {
  id: string; name: string; description?: string;
  /** Prospects arriving per quarter. */
  inflow: number;
  /** Conversion at each of three stages. */
  stages: [number, number, number];
  /** Share of customers lost per quarter. */
  churn: number;
  /** Revenue per customer per quarter, in rupees. */
  arpu: number;
  /** Cost to serve one customer for a quarter, in rupees. */
  var_cost: number;
  customers: number;
  /** Rupees spent per prospect that registers (a verification, a trial seat). */
  stage_cost: number;
}

export interface Item {
  id: string; name: string; about: string; area: string;
  eng: number; design: number; data: number;
  /** How well it is understood before any discovery, 0 to 1. Drives how far the estimate can be trusted. */
  clar: number;
  debt: number;
  quality?: { rel?: number; use?: number };
  effects: Record<string, Effect>;
  /** Scale these effect keys by hidden[v] / ref, so what the item is worth depends on a fact the player has to learn. */
  scale?: { v: string; ref: number; keys: (keyof Effect)[] }[];
  /** Rupees per customer it pays (a reward), and one-off rupees lakh when it ships. */
  per_new?: number; one_off?: number;
  /** Who the per-customer cost is paid on: every new paying customer in the segment (a reward), or only the extra ones the item brings (a referral). */
  per_new_on?: "all" | "lift";
  /** A running cost in rupees lakh a quarter, scaled by a hidden fact and cut by another item. */
  side_cost?: { per_quarter: number; v?: string; ref?: number; cut_by?: string; cut?: number };
  sponsor: Party;
  serves: Priority[];
  needs?: { done?: string[]; level?: number; trust?: [Party, number]; or_done?: string };
  risky?: boolean; big?: boolean; fav?: boolean;
  /** Raises the measurement level when it ships. */
  enables?: number;
}

export interface Mitigation { live?: string; trust?: [Party, number]; level?: number; rel?: number; by: number }
export interface MarketEvent {
  id: string; name: string; weight: number; signal: string; body: string;
  /** The cause the data would show, and the right response. */
  cause: string; direction: string;
  causes: { id: string; label: string }[];
  directions: { id: string; label: string }[];
  /** What it does in the quarter it hits (full) and the next (half), by segment. */
  effects: Record<string, Effect>;
  /** Extra incidents expected in the quarter it hits. */
  incident?: number;
  /** What absorbs it. */
  mitigations: Mitigation[];
}

export interface PlanNeeds { use?: number; rel?: number; debt_below?: number; trust?: [Party, number] }
export interface Plan {
  id: string; name: string; pitch: string;
  /** Multipliers on the next four quarters, and what has to be true for it to work. */
  inflow: number; arpu: number; cost: number; churn: number; marketing: number;
  needs: PlanNeeds;
}

/** A number the case states and the world does not quite honour: the briefing says `brief`, the truth in any one game is drawn from `range`. */
export interface HiddenFact { id: string; label: string; description: string; brief: number; range: [number, number]; unit?: "share" | "multiple" }

export interface Squad { eng: number; design: number; data: number; cost_eng: number; cost_design: number; cost_data: number; pm: number; fixed: number; marketing: number }
/** Where the company stands on day one. Debt: 0 clean to 100 crippling; the others 0 to 100 with higher better. */
export interface Start { debt: number; reliability: number; usability: number; morale: number; trust: Record<Party, number>; cash: number; level: number }

export interface Root {
  prompt: string;
  options: { id: string; label: string }[];
  /** The deep dive on `dive` shows which option is true: `high` when the fact is at least `threshold`, else `low`. */
  dive: string; threshold: number; high: string; low: string;
}

export interface Stakeholder { name: string; role: string; says: string }
export interface QuarterBrief { n: number; title: string; opening: string }
export interface RubricDimension { id: string; name: string; weight: number }

export interface VentureScenario {
  family: "venture";
  schema_version: "0.1";
  id: string; title: string; version: string;
  /** `order` places the case in the list a player sees (the first two cases are the retention ones). */
  meta: { domain: string; seat: Seat; order?: number; audience: string[]; est_minutes: number; locale: string; inspiration: string; rights_note: string };
  company: { name: string; one_liner: string; stage: string; market: string; business_model: string; product: string; role: string; brief: string; stakeholders: Stakeholder[] };
  stage_names: [string, string, string];
  /** Seat-specific words for capacity, the company dials and the parties; see Terms. */
  terms?: CaseTerms;
  segments: Segment[];
  items: Item[];
  squad: Squad;
  start: Start;
  /** The incident rate with a middling product: expected incidents a quarter. */
  incident_base: number;
  /** Design weeks in a typical quarter, the unit usability work is measured in. */
  design_ref: number;
  hidden: HiddenFact[];
  events: MarketEvent[];
  plans: Plan[];
  root: Root;
  /** What the team can see in its numbers at each measurement level. */
  measurement: { level: number; label: string; shows: string }[];
  quarters: QuarterBrief[];
  rubric: { dimensions: RubricDimension[]; doubled: string[]; bands: { min: number; label: string }[] };
  calibration: {
    seeds: number;
    /** How far evidence-led play must beat the textbook manager. 25 unless a case says otherwise and says why. */
    min_gap?: { gap: number; why: string };
    bots: { id: string; expected_final: { min: number; max: number }; revised?: { min: number; max: number; why: string } }[];
  };
}
