// What every venture case shares: how a scenario's rubric, calibration and measurement text are written for each seat.
// The expected score ranges below were written before any of the six later cases was run. They were reasoned from the two product-manager
// cases and the seat's weights, and are deliberately wide. A case whose bot lands outside them is reported; a range changed after seeing
// results carries `revised` in the scenario file.
import type { Seat, VentureScenario } from "../../src/venture/types.ts";

type Rubric = VentureScenario["rubric"];

const DOUBLED = ["priority_alignment", "diagnosis", "learned_before_bets", "delivered_vs_best", "value_created", "plan_choice"];
const BANDS = [{ min: 90, label: "Exceptional" }, { min: 75, label: "Strong" }, { min: 60, label: "Competent" }, { min: 40, label: "Weak" }, { min: 0, label: "Poor" }];

/** Dimension weights by seat (the proposal in the spec, section 8) and the names each seat reads. */
const DIMENSIONS: Record<Seat, { weights: number[]; names: string[] }> = {
  product_manager: { weights: [20, 20, 15, 10, 10, 10, 15], names: ["Strategy and focus", "Customer and evidence", "Delivery and execution", "Quality and technical stewardship", "Cross-team leadership", "Adaptability", "Business value"] },
  chief_executive: { weights: [20, 10, 10, 10, 20, 15, 15], names: ["Strategy and capital allocation", "Market and customer evidence", "Execution through the leadership team", "Risk, quality and resilience", "People and organisation", "Adaptability", "Enterprise value and runway"] },
  growth_strategy: { weights: [20, 15, 10, 5, 15, 15, 20], names: ["Where to play", "Evidence and experiments", "Growth execution", "Unit economics and quality", "Partners and stakeholders", "Adaptability", "Growth value"] },
  developer: { weights: [10, 10, 20, 25, 15, 10, 10], names: ["Technical direction and focus", "Diagnosis and evidence", "Delivery and execution", "Quality, reliability and security", "Team and cross-team leadership", "Adaptability", "Business value"] },
  designer: { weights: [10, 20, 15, 20, 15, 5, 15], names: ["Problem framing and focus", "Research and evidence", "Craft and delivery", "Systems, accessibility and quality", "Collaboration", "Adaptability", "Impact"] },
};
const IDS = ["strategy", "evidence", "delivery", "stewardship", "leadership", "adapt", "value"];

export const rubric = (seat: Seat): Rubric => ({
  dimensions: IDS.map((id, i) => ({ id, name: DIMENSIONS[seat].names[i]!, weight: DIMENSIONS[seat].weights[i]! })),
  doubled: DOUBLED, bands: BANDS,
});

/** Ranges written before the first run of a case: wide, because the weights differ by seat. */
export const calibration = (): VentureScenario["calibration"] => ({
  seeds: 40,
  bots: [
    { id: "do_nothing", expected_final: { min: 0, max: 5 } },
    { id: "random", expected_final: { min: 20, max: 45 } },
    { id: "feature_factory", expected_final: { min: 10, max: 40 } },
    { id: "debt_first", expected_final: { min: 35, max: 65 } },
    { id: "textbook", expected_final: { min: 35, max: 65 } },
    { id: "evidence_led", expected_final: { min: 80, max: 100 } },
  ],
});

export const meta = (seat: Seat, domain: string, order: number, audience: string[], locale = "en-IN"): VentureScenario["meta"] => ({
  domain, seat, order, audience, est_minutes: 75, locale,
  inspiration: "A manager's year in a company with a problem: four quarters, a team, hidden facts that sponsors state wrongly, one market event and a plan for the year after.",
  rights_note: "Original scenario. The company, the people, the product and every number are invented.",
});

export const measurement = (l0: string, l0shows: string): VentureScenario["measurement"] => [
  { level: 0, label: l0, shows: l0shows },
  { level: 1, label: "Core events", shows: "Also the first step and the share of customers lost each quarter." },
  { level: 2, label: "The full funnel", shows: "Also every step and every conversion rate, by segment." },
];

/** The four quarters' titles and templates. `first` is the opening of quarter 1; the rest are common to every case. */
export const quarters = (first: string, title1: string, plan4: string): VentureScenario["quarters"] => [
  { n: 1, title: title1, opening: first },
  { n: 2, title: "First results", opening: "Last quarter {shipped} shipped. Profit was {profit}, {delta} on the quarter before. {learned} {pleased}" },
  { n: 3, title: "The shock", opening: "Last quarter {shipped} shipped and profit was {profit}. Something has changed outside the team. Read the signal below, say what you think is behind it and whether you checked, and decide how to answer." },
  { n: 4, title: "The term sheet", opening: plan4 },
];

export const PLAN4 = "The board will back one of three plans for next year. Profit last quarter was {profit}. Where you stand: usability {U}, reliability {R}, technical debt {D}, engineering trust {trust_eng}, leadership trust {trust_lead}.";

/** The squad block every case needs, with a small default for what is not the point. */
export const squad = (eng: number, design: number, data: number, fixed: number, marketing: number): VentureScenario["squad"] => ({
  eng, design, data, cost_eng: 8.75, cost_design: 8, cost_data: 8, pm: 12, fixed, marketing,
});
