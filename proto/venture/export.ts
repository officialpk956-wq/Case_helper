// PROTOTYPE, run once. Writes the two product-manager cases as scenario files from the calibrated prototype data plus their text.
// The files in scenarios/ are the source of truth from here on; edit them, not this.
// Usage: node proto/venture/export.ts
import { writeFileSync } from "node:fs";
import { CASES } from "./cases.ts";
import type { CaseData } from "./model.ts";
import { ABOUT, HIDDEN, HIDDEN_LABEL } from "./text.ts";

const round = (v: unknown): unknown => {
  if (typeof v === "number") return Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 100000) / 100000;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
};
const json = (o: unknown): string => JSON.stringify(round(o), null, 2).replace(/\[\n\s+([^[\]{}]+?)\n\s+\]/g, (_m, inner: string) => `[${inner.split(/,\n\s+/).join(", ")}]`) + "\n";

const RANGES = {
  do_nothing: [0, 5], random: [30, 40], feature_factory: [20, 40], debt_first: [45, 55], textbook: [40, 60], evidence_led: [90, 95],
} as const;
const REVISED = {
  random: { min: 15, max: 35, why: "Written as 15-35 before the first run. The mean over 40 games was 31.2 to 36.7, so the range was revised to 30-40 after seeing results, at the owner's instruction. It was set to fit what was observed, so landing inside it shows nothing about the original expectation." },
  debt_first: { min: 25, max: 45, why: "Written as 25-45 before the first run. The first run put it at 60-65, the dimension weights were then changed, and the range was revised to 45-55 after seeing results, at the owner's instruction." },
  evidence_led: { min: 65, max: 90, why: "Written as 65-90 before the first run. The mean over 40 games was 91.6 to 92.9, so the range was revised to 90-95 after seeing results, at the owner's instruction. It was set to fit what was observed." },
} as const;

const RUBRIC = {
  dimensions: [
    { id: "strategy", name: "Strategy and focus", weight: 20 },
    { id: "evidence", name: "Customer and evidence", weight: 20 },
    { id: "delivery", name: "Delivery and execution", weight: 15 },
    { id: "stewardship", name: "Quality and technical stewardship", weight: 10 },
    { id: "leadership", name: "Cross-team leadership", weight: 10 },
    { id: "adapt", name: "Adaptability", weight: 10 },
    { id: "value", name: "Business value", weight: 15 },
  ],
  doubled: ["priority_alignment", "diagnosis", "learned_before_bets", "delivered_vs_best", "value_created", "plan_choice"],
  bands: [{ min: 90, label: "Exceptional" }, { min: 75, label: "Strong" }, { min: 60, label: "Competent" }, { min: 40, label: "Weak" }, { min: 0, label: "Poor" }],
};
const CALIBRATION = {
  seeds: 40,
  bots: Object.entries(RANGES).map(([id, [min, max]]) => ({ id, expected_final: { min, max }, ...(id in REVISED ? { revised: REVISED[id as keyof typeof REVISED] } : {}) })),
};

interface Words {
  slug: string; domain: string; company: Record<string, unknown>; segments: Record<string, string>; measurement: unknown[]; rootPrompt: string; quarters: unknown[];
}

const WORDS: Words[] = [
  {
    slug: "the-leaky-funnel", domain: "product",
    company: {
      name: "Marigold Pay", one_liner: "A three-year-old payments app in India with about 6 lakh active users and a sign-up funnel that leaks at identity checks.",
      stage: "Series B, making about ₹2 crore a quarter", market: "India: mobile-first, price-sensitive, with a regulator that reviews identity checks every year",
      business_model: "A fee on merchant payments, a share of credit arranged with a partner bank, and small charges on some transfers.",
      product: "The consumer app: sign-up, identity verification, payments and bill pay, and a QR code for small shops.",
      role: "Product manager for sign-up and activation. Your squad is eight engineers, three designers and two analysts.",
      brief: "You report to the Head of Product and the chief executive sits in your quarterly reviews. Of every hundred people who start signing up, only a handful make a first payment, and the biggest leak is identity verification. The board wants the funnel fixed in a year without hurting the profit. Nobody can say exactly where people drop out, because the app records installs and payments and little in between. You have four quarters of twelve weeks.",
      stakeholders: [
        { name: "Meera Joshi", role: "Head of Product, your manager", says: "Show me what you learned before you show me what you built. In every review I will ask which cause you believe is behind the leak, and why." },
        { name: "Arjun Bhatt", role: "Chief Executive", says: "Merchants will love the soundbox. I met three of them at a fair and they did not want to give it back." },
        { name: "Kavya Rao", role: "Head of Growth", says: "Rivals pay people to join. A first-payment reward and a referral programme will move the number this quarter." },
        { name: "Sameer Qureshi", role: "Head of Risk and Compliance", says: "If people pay before they are verified, fraud will rise. By how much depends on how many we let through." },
        { name: "Tanvi Desai", role: "Engineering Lead", says: "Every change to the identity service takes twice as long as it should. Give us time to clean it." },
        { name: "Rohan Iyer", role: "Support Lead", says: "Most verification complaints are people who could not get the camera to read the card." },
        { name: "The partner bank and the regulator", role: "Outside parties", says: "We watch your failure rate. The regulator reviews identity every year." },
      ],
    },
    segments: {
      new: "People new to digital payments, often on cheap phones and in regional languages.",
      sal: "Salaried people in cities who already pay bills online.",
      mer: "Small shop owners who take payments through a QR code.",
    },
    measurement: [
      { level: 0, label: "Installs and payments", shows: "Arrivals, first payments, customers and the money. Nothing in between." },
      { level: 1, label: "Core events", shows: "Also sign-ups and the share of customers lost each quarter." },
      { level: 2, label: "The full funnel", shows: "Also every step and every conversion rate, by segment." },
    ],
    rootPrompt: "Which of these do you believe is behind the leak?",
    quarters: [
      { n: 1, title: "The review", opening: "{company} is making {hold_profit} a quarter and has {cash} in the bank. Of every 100 people who start signing up, {per100_new} new-to-digital users, {per100_sal} salaried users and {per100_mer} merchants make a first payment. Your squad has about {road} weeks of engineering this quarter. Right now you can see installs and payments, and nothing in between." },
      { n: 2, title: "First results", opening: "Last quarter {shipped} shipped. Profit was {profit}, {delta} on the quarter before. {learned} {pleased}" },
      { n: 3, title: "The shock", opening: "Last quarter {shipped} shipped and profit was {profit}. Something has changed outside the product. Read the signal below, say what you think is behind it and whether you checked, and decide how to answer." },
      { n: 4, title: "The term sheet", opening: "The board will back one of three plans for next year. Profit last quarter was {profit}. Where you stand: usability {U}, reliability {R}, technical debt {D}, engineering trust {trust_eng}, outside trust {trust_ext}." },
    ],
  },
  {
    slug: "good-better-best", domain: "product",
    company: {
      name: "Tallyhouse", one_liner: "A B2B time-tracking and project-profitability tool for creative agencies whose growth has plateaued on one plan at one price.",
      stage: "Seed-plus, losing about ₹60 lakh a quarter, with about six quarters of cash", market: "Creative agencies in India and Southeast Asia: design studios, advertising shops, web agencies",
      business_model: "A monthly subscription per account, one plan at one price.",
      product: "The core product: time tracking, project budgets, invoicing and reports.",
      role: "Product manager for the core product. Your squad is seven engineers, two designers and two analysts.",
      brief: "The chief executive has to show a route to profit within four quarters or the next round is gone. Growth has plateaued on one plan at one price, and every team has a theory. You can see trial starts and payments, but not what happens between. You have four quarters of twelve weeks.",
      stakeholders: [
        { name: "Farah Siddiqui", role: "Chief Executive", says: "I need a route to profit I can show the board in four quarters. Tell me what gets us there." },
        { name: "Vikram Nair", role: "Head of Sales", says: "Three network deals died on security reviews. Give me single sign-on and an audit log and I will close them." },
        { name: "Anjali Menon", role: "Finance Lead", says: "Billing complaints are a quarter of the tickets. It is not the problem." },
        { name: "Imran Sheikh", role: "Customer Success", says: "Heavy users keep asking to pay for more. A usage add-on will sell itself." },
        { name: "Sunita Rao", role: "Chair of the board", says: "One price for everybody leaves money on the table." },
        { name: "Prakash Hegde", role: "Head of Engineering", says: "The billing module has caused every outage this year and nobody wants to touch it." },
        { name: "Divya Rao", role: "Design Lead", says: "Trials get lost in the first session." },
      ],
    },
    segments: {
      solo: "Freelancers and studios of one to five people.",
      mid: "Agencies of six to eighty people.",
      ent: "Networks and holding companies with many offices.",
    },
    measurement: [
      { level: 0, label: "Trial starts and payments", shows: "Arrivals, payments, customers and the money. Nothing in between." },
      { level: 1, label: "Core events", shows: "Also activated trials and the share of customers lost each quarter." },
      { level: 2, label: "The full funnel", shows: "Also every step and every conversion rate, by segment." },
    ],
    rootPrompt: "Which of these do you believe is behind the plateau?",
    quarters: [
      { n: 1, title: "The runway", opening: "{company} has {cash} in the bank and {hold_profit} a quarter if nothing changes: {runway}. Only {per100_solo} of every 100 solo trials end up paying, and {per100_mid} of every 100 mid-size ones. Your squad has about {road} weeks of engineering this quarter. You can see trial starts and payments, but not what happens between." },
      { n: 2, title: "First results", opening: "Last quarter {shipped} shipped. Profit was {profit}, {delta} on the quarter before. {learned} {pleased}" },
      { n: 3, title: "The shock", opening: "Last quarter {shipped} shipped and profit was {profit}. Something has changed outside the product. Read the signal below, say what you think is behind it and whether you checked, and decide how to answer." },
      { n: 4, title: "The term sheet", opening: "The board will back one of three plans for next year. Profit last quarter was {profit}. Where you stand: usability {U}, reliability {R}, technical debt {D}, engineering trust {trust_eng}, business trust {trust_biz}." },
    ],
  },
];

CASES.forEach((cs: CaseData, k) => {
  const words = WORDS[k]!;
  const out = {
    family: "venture", schema_version: "0.1", id: cs.id, title: cs.title, version: "1.0.0",
    meta: {
      domain: words.domain, seat: "product_manager", audience: ["product-managers", "apm", "product-students"], est_minutes: 75, locale: "en-IN",
      inspiration: "A product manager's year in a company with a problem: four quarters, a squad, hidden facts that sponsors state wrongly, one market event and a plan for the year after.",
      rights_note: "Original scenario. The company, the people, the product and every number are invented.",
    },
    company: words.company,
    stage_names: cs.stageNames,
    segments: cs.segments.map((s) => ({
      id: s.id, name: s.name, description: words.segments[s.id]!, inflow: s.inflow, stages: s.stages, churn: s.churn, arpu: s.arpu, var_cost: s.varCost, customers: s.customers, stage_cost: s.stageCost,
    })),
    items: cs.inits.map((i) => ({
      id: i.id, name: i.name, about: ABOUT[i.id]!, area: i.area, eng: i.eng, design: i.design, data: i.data, clar: i.clar, debt: i.debt,
      ...(i.quality ? { quality: i.quality } : {}),
      effects: i.effects,
      ...(i.scale ? { scale: i.scale } : {}),
      ...(i.perNew !== undefined ? { per_new: i.perNew } : {}), ...(i.perNewOn ? { per_new_on: i.perNewOn } : {}), ...(i.oneOff !== undefined ? { one_off: i.oneOff } : {}),
      ...(i.sideCost ? { side_cost: { per_quarter: i.sideCost.perQuarter, ...(i.sideCost.v ? { v: i.sideCost.v } : {}), ...(i.sideCost.ref !== undefined ? { ref: i.sideCost.ref } : {}), ...(i.sideCost.cutBy ? { cut_by: i.sideCost.cutBy } : {}), ...(i.sideCost.cut !== undefined ? { cut: i.sideCost.cut } : {}) } } : {}),
      sponsor: i.sponsor, serves: i.serves,
      ...(i.needs ? { needs: { ...(i.needs.done ? { done: i.needs.done } : {}), ...(i.needs.level !== undefined ? { level: i.needs.level } : {}), ...(i.needs.trust ? { trust: i.needs.trust } : {}), ...(i.needs.orDone ? { or_done: i.needs.orDone } : {}) } } : {}),
      ...(i.risky ? { risky: true } : {}), ...(i.big ? { big: true } : {}), ...(i.fav ? { fav: true } : {}), ...(i.enables ? { enables: i.enables } : {}),
    })),
    squad: { eng: cs.team.eng, design: cs.team.design, data: cs.team.data, cost_eng: cs.team.costEng, cost_design: cs.team.costDesign, cost_data: cs.team.costData, pm: cs.team.pm, fixed: cs.team.fixed, marketing: cs.team.marketing },
    start: { debt: cs.start.D, reliability: cs.start.R, usability: cs.start.U, morale: cs.start.M, trust: cs.start.trust, cash: cs.start.cash, level: cs.start.level },
    incident_base: cs.incidentBase,
    design_ref: cs.designRef,
    hidden: Object.entries(cs.hidden).map(([id, range]) => ({ id, label: HIDDEN_LABEL[id]!.label, description: HIDDEN[id]!, brief: cs.brief[id]!, range, unit: HIDDEN_LABEL[id]!.unit })),
    events: cs.events,
    plans: cs.plans.map((p) => ({ id: p.id, name: p.name, pitch: p.pitch, inflow: p.inflow, arpu: p.arpu, cost: p.cost, churn: p.churn, marketing: p.marketing, needs: { ...(p.needs.use !== undefined ? { use: p.needs.use } : {}), ...(p.needs.rel !== undefined ? { rel: p.needs.rel } : {}), ...(p.needs.debtBelow !== undefined ? { debt_below: p.needs.debtBelow } : {}), ...(p.needs.trust ? { trust: p.needs.trust } : {}) } })),
    root: { prompt: words.rootPrompt, options: cs.root.options, dive: cs.root.dive, threshold: cs.root.threshold, high: cs.root.high, low: cs.root.low },
    measurement: words.measurement,
    quarters: words.quarters,
    rubric: RUBRIC,
    calibration: CALIBRATION,
  };
  writeFileSync(`scenarios/${words.slug}.venture.json`, json(out));
  console.log("wrote", `scenarios/${words.slug}.venture.json`);
});
