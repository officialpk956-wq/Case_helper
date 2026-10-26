// PROTOTYPE. The two product-manager cases as data: the company, its funnel, what could be built, what could go wrong.
// Every name, number and sentence is original. The numbers are placeholders to be calibrated.
import type { CaseData } from "./model.ts";

/** Case A. A consumer finance app whose sign-up funnel leaks at identity checks, with a regulator and a partner bank in the room. */
export const MARIGOLD: CaseData = {
  id: "marigold_leaky_funnel",
  title: "The Leaky Funnel",
  company: "Marigold Pay",
  stageNames: ["Registered", "Identity verified", "First payment"],
  segments: [
    { id: "new", name: "New-to-digital payers", inflow: 420000, stages: [0.70, 0.36, 0.52], churn: 0.20, arpu: 140, varCost: 38, customers: 290000, stageCost: 9 },
    { id: "sal", name: "Salaried urban users", inflow: 180000, stages: [0.78, 0.55, 0.66], churn: 0.18, arpu: 520, varCost: 70, customers: 270000, stageCost: 9 },
    { id: "mer", name: "Micro-merchants", inflow: 60000, stages: [0.64, 0.42, 0.48], churn: 0.18, arpu: 980, varCost: 210, customers: 46000, stageCost: 9 },
  ],
  inits: [
    { id: "kyc_camera", name: "Identity-check camera guidance and retry", area: "activation", eng: 6, design: 2, data: 0, clar: 0.6, debt: 1,
      effects: { new: { s2: 0.22 }, sal: { s2: 0.08 }, mer: { s2: 0.15 } }, scale: [{ v: "camera_share", ref: 0.65, keys: ["s2"] }], sponsor: "eng", serves: ["activate"] },
    { id: "kyc_defer", name: "Verify after the first payment", area: "activation", eng: 10, design: 3, data: 1, clar: 0.35, debt: 3,
      effects: { new: { s2: 0.45, s3: -0.08 }, sal: { s2: 0.30, s3: -0.05 }, mer: { s2: 0.40, s3: -0.07 } },
      sideCost: { perQuarter: 70, v: "fraud_mult", ref: 1.2, cutBy: "fraud_v2", cut: 0.65 }, needs: { trust: ["ext", 50], orDone: "fraud_v2" },
      sponsor: "lead", serves: ["activate", "grow"], risky: true, big: true },
    { id: "first_reward", name: "First-payment reward", area: "activation", eng: 3, design: 1, data: 0, clar: 0.8, debt: 1,
      effects: { new: { s3: 0.30, churn: -0.10 }, sal: { s3: 0.12, churn: -0.04 }, mer: { s3: 0.10, churn: -0.03 } }, scale: [{ v: "reward_hunters", ref: 0.4, keys: ["churn"] }],
      perNew: 45, sponsor: "biz", serves: ["activate", "grow"], risky: true },
    { id: "lang_onboard", name: "Regional-language onboarding", area: "activation", eng: 6, design: 4, data: 0, clar: 0.6, debt: 1,
      effects: { new: { s1: 0.10, s2: 0.12 }, sal: { s1: 0.02 }, mer: { s2: 0.04 } }, sponsor: "design", serves: ["grow", "activate"] },
    { id: "support_bot", name: "Support deflection assistant", area: "cost", eng: 6, design: 1, data: 0, clar: 0.7, debt: 2,
      effects: { new: { cost: -0.20, churn: 0.02 }, sal: { cost: -0.20, churn: 0.02 }, mer: { cost: -0.20, churn: 0.02 } }, sponsor: "biz", serves: ["quality", "monetise"] },
    { id: "salary_link", name: "Salary-account linking and credit offers", area: "monetise", eng: 8, design: 2, data: 0, clar: 0.5, debt: 2,
      effects: { sal: { arpu: 0.22, s3: 0.05 } }, needs: { trust: ["ext", 45] }, sponsor: "lead", serves: ["monetise"] },
    { id: "soundbox", name: "Merchant QR soundbox integration", area: "monetise", eng: 10, design: 2, data: 0, clar: 0.4, debt: 2,
      effects: { mer: { arpu: 0.18, churn: 0.15, s3: 0.10 } }, scale: [{ v: "merchant_pull", ref: 0.7, keys: ["arpu", "churn", "s3"] }], oneOff: 120,
      sponsor: "lead", serves: ["monetise", "retain"], big: true, fav: true },
    { id: "fraud_v2", name: "Fraud rules engine v2", area: "quality", eng: 6, design: 0, data: 3, clar: 0.5, debt: 0,
      effects: { sal: { s3: 0.04 }, mer: { s3: 0.04 } }, needs: { level: 1 }, sponsor: "ext", serves: ["quality"] },
    { id: "app_perf", name: "Low-end Android performance", area: "quality", eng: 4, design: 0, data: 0, clar: 0.8, debt: -2, quality: { rel: 4 },
      effects: { new: { s1: 0.06, churn: 0.04 }, sal: { churn: 0.02 } }, sponsor: "eng", serves: ["quality", "retain"] },
    { id: "nudges", name: "Smart nudges", area: "retention", eng: 2, design: 1, data: 0, clar: 0.8, debt: 1,
      effects: { new: { churn: 0.05, s3: 0.04 }, sal: { churn: 0.05, s3: 0.04 }, mer: { churn: 0.05, s3: 0.04 } }, sponsor: "biz", serves: ["retain"] },
    { id: "referral", name: "Referral programme", area: "growth", eng: 5, design: 2, data: 0, clar: 0.6, debt: 1,
      effects: { new: { inflow: 0.12 }, sal: { inflow: 0.06 } }, perNew: 60, perNewOn: "lift", sponsor: "biz", serves: ["grow"] },
    { id: "analytics_v2", name: "Funnel event instrumentation", area: "learning", eng: 3, design: 0, data: 2, clar: 0.9, debt: -1, enables: 2,
      effects: {}, sponsor: "eng", serves: ["learn"] },
    { id: "core_refactor", name: "Identity-service refactor", area: "debt", eng: 8, design: 0, data: 0, clar: 0.6, debt: -12, quality: { rel: 3 },
      effects: {}, sponsor: "eng", serves: ["debt", "quality"] },
  ],
  // The squad is the part of the company the PM works with; the rest of its cost sits in "fixed".
  team: { eng: 8, design: 3, data: 2, costEng: 8.75, costDesign: 8, costData: 8, pm: 12, fixed: 668.5, marketing: 800 },
  start: { D: 58, R: 62, U: 52, M: 68, trust: { eng: 62, design: 58, biz: 50, lead: 55, ext: 44 }, cash: 2500, level: 0 },
  hidden: { camera_share: [0.35, 0.75], fraud_mult: [0.9, 2.6], reward_hunters: [0.15, 0.85], merchant_pull: [0.15, 0.95] },
  brief: { camera_share: 0.65, fraud_mult: 1.2, reward_hunters: 0.4, merchant_pull: 0.7 },
  incidentBase: 0.55,
  designRef: 20,
  root: {
    options: [{ id: "camera_failures", label: "People fail the identity camera step" }, { id: "process_friction", label: "The identity flow asks too much" }, { id: "weak_reward", label: "There is no reason to make a first payment" }, { id: "reliability", label: "The app is too unreliable" }, { id: "need_more_data", label: "I need more data" }],
    dive: "camera_share", threshold: 0.55, high: "camera_failures", low: "process_friction",
  },
  events: [
    { id: "reg_tighten", name: "The regulator tightens identity rules", weight: 0.35, signal: "Verification completions fell across every segment in one week, and the compliance desk has a new circular.",
      body: "A new rule requires a second identity factor. Completion drops until the flow is rebuilt around it.",
      cause: "rule_change", direction: "comply_fast",
      causes: [{ id: "rule_change", label: "A rule changed" }, { id: "app_bug", label: "We shipped a bug" }, { id: "fraud_spike", label: "A fraud wave hit" }],
      directions: [{ id: "comply_fast", label: "Rebuild to the new rule at once" }, { id: "lobby_delay", label: "Ask the regulator for time" }, { id: "pause_deferral", label: "Pause any shortcut and wait" }],
      effects: { new: { s2: -0.15 }, sal: { s2: -0.15 }, mer: { s2: -0.15 } },
      mitigations: [{ live: "kyc_camera", by: 0.25 }, { trust: ["ext", 55], by: 0.2 }, { level: 1, by: 0.1 }] },
    { id: "bank_outage", name: "The partner bank has a bad week", weight: 0.35, signal: "Payments are timing out and support tickets say money left accounts and did not arrive.",
      body: "The partner bank's settlement rail fails twice. Users who were mid-payment lose trust in you, not in the bank.",
      cause: "partner_outage", direction: "failover_comms",
      causes: [{ id: "partner_outage", label: "The partner is failing" }, { id: "app_bug", label: "Our release broke payments" }, { id: "fraud_spike", label: "Fraud controls are blocking real payments" }],
      directions: [{ id: "failover_comms", label: "Fail over and tell users plainly" }, { id: "wait_it_out", label: "Wait for the bank" }, { id: "roll_back", label: "Roll back our last release" }],
      effects: { new: { s3: -0.08, churn: -0.08 }, sal: { s3: -0.10, churn: -0.08 }, mer: { s3: -0.10, churn: -0.10 } }, incident: 1.2,
      mitigations: [{ rel: 70, by: 0.35 }, { live: "app_perf", by: 0.1 }, { trust: ["eng", 60], by: 0.15 }] },
    { id: "cashback_war", name: "A rival starts a cashback war", weight: 0.30, signal: "New installs are cheaper for the rival and our newest users are leaving for it within weeks.",
      body: "A funded rival pays people to switch. The users you are least able to keep are the ones who leave first.",
      cause: "competitor_promo", direction: "targeted_retention",
      causes: [{ id: "competitor_promo", label: "A rival is paying to win users" }, { id: "app_bug", label: "Our app got worse" }, { id: "seasonal", label: "A seasonal dip" }],
      directions: [{ id: "targeted_retention", label: "Keep our best users, do not match the offer" }, { id: "match_offer", label: "Match the cashback" }, { id: "ignore", label: "Ignore it" }],
      effects: { new: { inflow: -0.20, churn: -0.15 }, sal: { inflow: -0.10, churn: -0.08 }, mer: { churn: -0.04 } },
      mitigations: [{ live: "nudges", by: 0.2 }, { live: "first_reward", by: 0.15 }, { live: "soundbox", by: 0.1 }] },
  ],
  plans: [
    { id: "acquire", name: "Acquire hard", pitch: "Spend heavily on installs next year and live with what it costs.", inflow: 1.35, arpu: 1.0, cost: 1.0, churn: 1.0, marketing: 1.4, needs: { use: 55, rel: 60 } },
    { id: "deepen", name: "Deepen the base", pitch: "Earn more from the people you already have: credit, merchants, fewer exits.", inflow: 1.0, arpu: 1.14, cost: 1.0, churn: 0.95, marketing: 1.0, needs: { use: 50, trust: ["ext", 50] } },
    { id: "profit", name: "Profit first", pitch: "Cut acquisition spend and cost to serve, and let the base run.", inflow: 0.88, arpu: 1.0, cost: 0.88, churn: 1.0, marketing: 0.7, needs: { debtBelow: 70 } },
  ],
};

/** Case B. A B2B tool for creative agencies whose growth has plateaued, with sales, billing debt and a pricing question. */
export const TALLYHOUSE: CaseData = {
  id: "tallyhouse_good_better_best",
  title: "Good, Better, Best",
  company: "Tallyhouse",
  stageNames: ["Trial activated", "Upgrade considered", "Paid"],
  segments: [
    { id: "solo", name: "Solo and small studios", inflow: 20000, stages: [0.45, 0.10, 0.55], churn: 0.09, arpu: 2100, varCost: 380, customers: 4800, stageCost: 40 },
    { id: "mid", name: "Mid-size agencies", inflow: 1800, stages: [0.60, 0.35, 0.40], churn: 0.05, arpu: 14000, varCost: 2100, customers: 2800, stageCost: 600 },
    { id: "ent", name: "Networks and enterprise", inflow: 140, stages: [0.70, 0.40, 0.30], churn: 0.04, arpu: 95000, varCost: 12000, customers: 250, stageCost: 9000 },
  ],
  inits: [
    { id: "onboarding_wizard", name: "Guided set-up", area: "activation", eng: 5, design: 3, data: 0, clar: 0.7, debt: 1,
      effects: { solo: { s1: 0.18, s2: 0.06 }, mid: { s1: 0.10 } }, sponsor: "design", serves: ["activate", "grow"] },
    { id: "tiering", name: "Three-tier packaging", area: "monetise", eng: 4, design: 3, data: 2, clar: 0.5, debt: 1,
      effects: { solo: { arpu: 0.12, s3: -0.06 }, mid: { arpu: 0.15, s3: -0.05 }, ent: { arpu: 0.10 } }, scale: [{ v: "elasticity", ref: 0.9, keys: ["s3"] }],
      needs: { level: 1 }, sponsor: "biz", serves: ["monetise"], risky: true },
    { id: "usage_addon", name: "Usage-based add-on", area: "monetise", eng: 8, design: 2, data: 2, clar: 0.4, debt: 2,
      effects: { mid: { arpu: 0.20, churn: 0.03 }, ent: { arpu: 0.18 } }, scale: [{ v: "addon_wtp", ref: 1.1, keys: ["arpu"] }], sideCost: { perQuarter: 25 },
      needs: { level: 1 }, sponsor: "biz", serves: ["monetise"], risky: true, big: true },
    { id: "annual_plan", name: "Annual-plan upsell", area: "retention", eng: 3, design: 1, data: 0, clar: 0.8, debt: 0,
      effects: { solo: { churn: 0.18, arpu: -0.04, s3: 0.04 }, mid: { churn: 0.12, arpu: -0.03 } }, sponsor: "biz", serves: ["retain"] },
    { id: "sso_audit", name: "Single sign-on and audit log", area: "enterprise", eng: 9, design: 2, data: 0, clar: 0.6, debt: 3,
      effects: { ent: { s3: 0.35, churn: 0.10 }, mid: { s3: 0.05 } }, scale: [{ v: "ent_pipeline", ref: 0.75, keys: ["s3", "churn"] }], sideCost: { perQuarter: 12 },
      sponsor: "biz", serves: ["grow", "monetise"], big: true, fav: true },
    { id: "billing_rewrite", name: "Billing module rewrite", area: "debt", eng: 12, design: 1, data: 1, clar: 0.4, debt: -14, quality: { rel: 6 },
      effects: { solo: { churn: 0.12 }, mid: { churn: 0.10 }, ent: { churn: 0.08 } }, scale: [{ v: "billing_share", ref: 0.25, keys: ["churn"] }], sponsor: "eng", serves: ["debt", "retain"], big: true },
    { id: "integrations", name: "Accounting integrations", area: "growth", eng: 8, design: 2, data: 0, clar: 0.6, debt: 2,
      effects: { mid: { s3: 0.10, churn: 0.06 }, solo: { s3: 0.06 } }, sponsor: "biz", serves: ["grow", "retain"] },
    { id: "mobile_time", name: "Mobile timesheets", area: "retention", eng: 7, design: 4, data: 0, clar: 0.6, debt: 2,
      effects: { solo: { s1: 0.05, churn: 0.04 }, mid: { churn: 0.05 } }, sponsor: "design", serves: ["retain"] },
    { id: "reporting", name: "Profitability dashboards", area: "monetise", eng: 6, design: 3, data: 0, clar: 0.6, debt: 1,
      effects: { mid: { arpu: 0.08, churn: 0.05 }, ent: { arpu: 0.06 } }, sponsor: "biz", serves: ["monetise", "retain"] },
    { id: "design_system", name: "Design system rollout", area: "quality", eng: 5, design: 6, data: 0, clar: 0.7, debt: -4, quality: { use: 10 },
      effects: { solo: { s1: 0.03 }, mid: { s1: 0.02 } }, sponsor: "design", serves: ["quality"] },
    { id: "perf_reliability", name: "Performance and reliability sprint", area: "quality", eng: 5, design: 0, data: 0, clar: 0.8, debt: -2, quality: { rel: 12 },
      effects: { solo: { churn: 0.03 }, mid: { churn: 0.03 }, ent: { churn: 0.03 } }, sponsor: "eng", serves: ["quality"] },
    { id: "upgrade_flow", name: "In-app upgrade flow", area: "monetise", eng: 4, design: 2, data: 0, clar: 0.7, debt: 1,
      effects: { solo: { s2: 0.25 }, mid: { s2: 0.12 } }, sponsor: "biz", serves: ["monetise", "grow"] },
    { id: "analytics_v2", name: "Product analytics pipeline", area: "learning", eng: 3, design: 0, data: 2, clar: 0.9, debt: -1, enables: 2, effects: {}, sponsor: "eng", serves: ["learn"] },
  ],
  team: { eng: 7, design: 2, data: 2, costEng: 8.75, costDesign: 8, costData: 8, pm: 12, fixed: 331.75, marketing: 230 },
  start: { D: 64, R: 66, U: 48, M: 64, trust: { eng: 58, design: 52, biz: 45, lead: 60, ext: 55 }, cash: 400, level: 1 },
  hidden: { elasticity: [0.6, 2.0], addon_wtp: [0.4, 1.4], billing_share: [0.15, 0.5], ent_pipeline: [0.15, 0.95] },
  brief: { elasticity: 0.9, addon_wtp: 1.1, billing_share: 0.25, ent_pipeline: 0.75 },
  incidentBase: 0.5,
  designRef: 18,
  root: {
    options: [{ id: "billing_quality", label: "Billing errors are driving people away" }, { id: "packaging", label: "The plans do not fit what people will pay" }, { id: "no_enterprise", label: "We lack what big buyers need" }, { id: "onboarding", label: "Trials are not getting started" }, { id: "need_more_data", label: "I need more data" }],
    dive: "billing_share", threshold: 0.38, high: "billing_quality", low: "packaging",
  },
  events: [
    { id: "network_leaves", name: "A network of agencies leaves for a rival", weight: 0.35, signal: "The largest customer group has gone quiet and asked for a call about security reviews.",
      body: "A network with forty offices says it cannot stay without single sign-on and an audit trail.",
      cause: "missing_enterprise_features", direction: "enterprise_rescue",
      causes: [{ id: "missing_enterprise_features", label: "We lack what large buyers need" }, { id: "price", label: "We are too expensive" }, { id: "bugs", label: "Billing errors upset them" }],
      directions: [{ id: "enterprise_rescue", label: "Commit to the missing features with dates" }, { id: "discount", label: "Offer a discount" }, { id: "wait", label: "Wait and see" }],
      effects: { ent: { churn: -0.25, s3: -0.10 }, mid: { churn: -0.03 } },
      mitigations: [{ live: "sso_audit", by: 0.35 }, { trust: ["biz", 55], by: 0.15 }, { live: "reporting", by: 0.1 }] },
    { id: "rival_undercut", name: "A rival undercuts the mid tier", weight: 0.35, signal: "Upgrades from trial are slipping and sales say prospects keep quoting a competitor's price.",
      body: "A funded rival halves its price for agencies of your size.",
      cause: "price_competition", direction: "repackage_not_discount",
      causes: [{ id: "price_competition", label: "A competitor is cutting price" }, { id: "onboarding", label: "Our onboarding got worse" }, { id: "seasonal", label: "A seasonal dip" }],
      directions: [{ id: "repackage_not_discount", label: "Repackage and sell value, do not match the price" }, { id: "match_price", label: "Match the price" }, { id: "ignore", label: "Ignore it" }],
      effects: { mid: { s3: -0.12, arpu: -0.05 }, solo: { s3: -0.08 } },
      mitigations: [{ live: "tiering", by: 0.25 }, { live: "annual_plan", by: 0.15 }, { level: 1, by: 0.1 }] },
    { id: "security_scare", name: "A security scare reaches the press", weight: 0.30, signal: "A researcher has posted about a flaw in file sharing, and trial sign-ups have dipped.",
      body: "The flaw is real and already patched in your head, but nobody outside knows that.",
      cause: "vulnerability", direction: "disclose_and_patch",
      causes: [{ id: "vulnerability", label: "A real flaw was found" }, { id: "rumour", label: "A rumour with nothing behind it" }, { id: "competitor_smear", label: "A rival is spreading it" }],
      directions: [{ id: "disclose_and_patch", label: "Disclose, patch, and tell customers" }, { id: "deny", label: "Deny it" }, { id: "quiet_fix", label: "Fix it quietly" }],
      effects: { solo: { s1: -0.05, churn: -0.06 }, mid: { s1: -0.05, churn: -0.06 }, ent: { churn: -0.06 } }, incident: 1.5,
      mitigations: [{ rel: 70, by: 0.3 }, { live: "perf_reliability", by: 0.15 }, { trust: ["eng", 60], by: 0.15 }] },
  ],
  plans: [
    { id: "upmarket", name: "Move up-market", pitch: "Build for large buyers: security, sign-on, support, longer deals.", inflow: 0.95, arpu: 1.18, cost: 1.05, churn: 0.9, marketing: 1.1, needs: { trust: ["biz", 55], rel: 65 } },
    { id: "selfserve", name: "Own self-serve", pitch: "Make buying frictionless and win on volume.", inflow: 1.3, arpu: 0.97, cost: 1.0, churn: 1.0, marketing: 1.3, needs: { use: 55 } },
    { id: "profit", name: "Reach profit", pitch: "Cut spend, simplify, and stop losing money.", inflow: 0.9, arpu: 1.05, cost: 0.85, churn: 1.0, marketing: 0.75, needs: { debtBelow: 65 } },
  ],
};

export { MARIGOLD as RAW_MARIGOLD, TALLYHOUSE as RAW_TALLYHOUSE };

/** What the squad can do in a year is about two thirds of the catalogue, so choosing matters: the effort written above is multiplied. */
export const EFFORT = { eng: 3, design: 2 };
const half = (x: number): number => Math.round(x * 2) / 2;

/**
 * Fitted effect sizes, so that items are worth a believable share of the company's profit (see fit.ts).
 * `a` multiplies an item's favourable effects. `c` multiplies the cost side named by `knob`: the running cost, the per-customer cost,
 * the one-off cost, or the unfavourable effects.
 */
export interface Fit { a: number; c?: number; knob?: "side" | "perNew" | "oneOff" | "loss" }
export const FIT: Record<string, Record<string, Fit>> = {
  marigold_leaky_funnel: {"kyc_camera":{"a":0.59},"lang_onboard":{"a":0.77},"support_bot":{"a":0.35},"salary_link":{"a":0.29},"fraud_v2":{"a":0.54},"app_perf":{"a":0.61},"nudges":{"a":0.2},"referral":{"a":0.79},"kyc_defer":{"a":1.084,"c":1.954,"knob":"side"},"first_reward":{"a":1.098,"c":1.141,"knob":"loss"},"soundbox":{"a":1.806,"c":6.806,"knob":"oneOff"}},
  tallyhouse_good_better_best: {"onboarding_wizard":{"a":1.1},"annual_plan":{"a":1.78},"integrations":{"a":1.66},"mobile_time":{"a":1.82},"reporting":{"a":0.38},"design_system":{"a":1.4},"perf_reliability":{"a":0.95},"upgrade_flow":{"a":0.87},"billing_rewrite":{"a":1.32},"tiering":{"a":0.395,"c":3.944,"knob":"loss"},"usage_addon":{"a":0.742,"c":1.887,"knob":"side"},"sso_audit":{"a":3.412,"c":2.432,"knob":"side"}},
};

export function calibrate(cs: CaseData, fit: Record<string, Fit> = FIT[cs.id] ?? {}): CaseData {
  const out = structuredClone(cs);
  for (const i of out.inits) {
    i.eng = half(i.eng * EFFORT.eng); i.design = half(i.design * EFFORT.design);
    const f = fit[i.id];
    if (!f) continue;
    for (const e of Object.values(i.effects)) for (const k of Object.keys(e) as (keyof typeof e)[]) {
      const v = e[k]!, good = k === "cost" ? v < 0 : v > 0;
      e[k] = good ? v * f.a : f.knob === "loss" ? v * (f.c ?? 1) : v;
    }
    if (f.knob === "side" && i.sideCost) i.sideCost.perQuarter *= f.c ?? 1;
    if (f.knob === "perNew" && i.perNew) i.perNew *= f.c ?? 1;
    if (f.knob === "oneOff" && i.oneOff) i.oneOff *= f.c ?? 1;
  }
  return out;
}
export const CASES = [calibrate(MARIGOLD), calibrate(TALLYHOUSE)];
