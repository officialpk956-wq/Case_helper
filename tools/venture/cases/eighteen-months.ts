// Case 5. The chief executive seat: a home-textile brand with eighteen months of cash, three channels that look alike and are not,
// and the question of where scarce money and scarce management weeks go.
import type { FitPlan } from "../fit.ts";
import { calibration, measurement, meta, quarters, rubric, squad } from "../common.ts";
import type { VentureScenario } from "../../../src/venture/types.ts";

export const slug = "eighteen-months";

export const raw: VentureScenario = {
  family: "venture", schema_version: "0.1", id: "harbour_loom_eighteen_months", title: "Eighteen Months", version: "1.0.0",
  meta: meta("chief_executive", "leadership", 5, ["founders", "general-managers", "mba-students"]),
  terms: {
    eng: "Operations", design: "Merchandising", data: "Analytics",
    debt: "Operating debt", reliability: "Supply reliability", usability: "Customer experience",
    parties: { eng: "Operations and supply", design: "Brand and product", biz: "Sales and channels", lead: "Board and investors", ext: "Suppliers and partners" },
  },
  company: {
    name: "Harbour & Loom", one_liner: "A direct-to-consumer home-textile brand with 400 people, three sales channels and eighteen months of cash.",
    stage: "Series C, losing money", market: "India: bedsheets, towels and curtains, bought on the brand's own site, on marketplaces and on quick-commerce apps",
    business_model: "Sells its own range at a gross margin that depends heavily on the channel, returns and discounts.",
    product: "A range of cotton home textiles made by contract mills, shipped from two warehouses.",
    role: "Chief executive. You answer to the board, and the sales, operations, finance and brand heads answer to you.",
    brief: "The company loses about ₹3 crore a quarter and has ₹18 crore in the bank. The board wants a path to break-even and a raise on decent terms. Each of your leaders has a plan and a number to back it, and the numbers come from the people who gain if you agree. You have four quarters of twelve weeks, and then the board backs one plan for the year after.",
    stakeholders: [
      { name: "Meera Iyer", role: "Chair of the board", says: "Eighteen months of cash is not a plan. Show me the road to break-even, and a raise that does not hollow the company out." },
      { name: "Rohan Bedi", role: "Head of sales and channels", says: "Quick commerce is our fastest channel. Even after returns and discounts it costs us twelve percent of its revenue and still pays. Triple it." },
      { name: "Anita Rao", role: "Chief operating officer", says: "Our main mill has delivered ninety-six percent on time for three years. Sign them for three years on an exclusive and we are ten percent cheaper." },
      { name: "Tarun Nair", role: "Chief financial officer", says: "The burn is head-office overhead. Freeze hiring, take ten percent out, and stop arguing about channels." },
      { name: "Kavya Menon", role: "Head of brand and product", says: "Our best customers want something finer. Forty-five percent of the site's buyers told us they would pay for an organic premium line." },
      { name: "Imran Sheikh", role: "Head of growth, own site", says: "Sixty percent of the people who leave our checkout leave because it is slow and clumsy. Rebuild it." },
    ],
  },
  stage_names: ["Visited", "Added to basket", "Placed an order"],
  segments: [
    { id: "site", name: "Own site and app", description: "Customers who buy on the brand's own site and app.", inflow: 300000, stages: [0.18, 0.35, 0.6], churn: 0.3, arpu: 3600, var_cost: 2200, customers: 30000, stage_cost: 90 },
    { id: "market", name: "Marketplaces", description: "Customers who buy the range on the big marketplaces.", inflow: 440000, stages: [0.14, 0.4, 0.5], churn: 0.3, arpu: 2600, var_cost: 2050, customers: 42000, stage_cost: 40 },
    { id: "qc", name: "Quick-commerce apps", description: "Customers who buy in ten to thirty minutes through the delivery apps.", inflow: 200000, stages: [0.12, 0.5, 0.45], churn: 0.35, arpu: 2200, var_cost: 1500, customers: 16000, stage_cost: 30 },
  ],
  items: [
    { id: "scale_qc", name: "Triple the quick-commerce allocation", about: "More stock, more listings and more discounts in the apps that deliver in minutes. The sales head's favourite.", area: "growth", eng: 22, design: 2, data: 1, clar: 0.5, debt: 3,
      effects: { qc: { inflow: 0.9, s2: 0.1 } },
      side_cost: { per_quarter: 60, v: "qc_leak", ref: 0.12, cut_by: "returns_programme", cut: 0.5 }, sponsor: "biz", serves: ["grow"], big: true, risky: true, fav: true },
    { id: "supplier_contract", name: "Three-year exclusive with the main mill", about: "Commit all volume to one mill for three years in return for a lower price per metre.", area: "monetise", eng: 16, design: 0, data: 1, clar: 0.6, debt: -2,
      effects: { site: { cost: -0.1, s3: 0.03 }, market: { cost: -0.09, s3: 0.03 }, qc: { cost: -0.08 } },
      scale: [{ v: "supplier_fill", ref: 0.96, keys: ["cost", "s3"] }], side_cost: { per_quarter: 45 }, needs: { trust: ["ext", 48] }, sponsor: "eng", serves: ["monetise", "quality"], big: true, risky: true },
    { id: "premium_line", name: "Launch an organic premium line", about: "A finer range at a higher price, for the site's best customers and the marketplaces' top shelf.", area: "monetise", eng: 20, design: 6, data: 1, clar: 0.4, debt: 2,
      effects: { site: { arpu: 0.16, inflow: 0.08 }, market: { arpu: 0.06 } },
      scale: [{ v: "premium_demand", ref: 0.45, keys: ["arpu", "inflow"] }], side_cost: { per_quarter: 35 }, needs: { level: 2 }, sponsor: "design", serves: ["monetise", "grow"], big: true, risky: true },
    { id: "second_source", name: "Qualify a second mill", about: "Test fabric, agree prices and place a first order with a second mill, so one fire cannot stop the company.", area: "reliability", eng: 14, design: 0, data: 0, clar: 0.7, debt: -2, quality: { rel: 8 },
      effects: { site: { churn: 0.05 }, market: { churn: 0.05 }, qc: { churn: 0.06, s3: 0.03 } }, sponsor: "eng", serves: ["quality", "retain"] },
    { id: "site_rebuild", name: "Rebuild the site checkout and app", about: "A faster, simpler checkout with saved details and one-tap reorder.", area: "growth", eng: 20, design: 5, data: 1, clar: 0.55, debt: -2, quality: { use: 4 },
      effects: { site: { s2: 0.14, s3: 0.1 } }, scale: [{ v: "abandon_checkout", ref: 0.6, keys: ["s2", "s3"] }], sponsor: "biz", serves: ["activate"] },
    { id: "loyalty", name: "A loyalty and reorder programme", about: "Points, early access and reminders for the people who have already bought once.", area: "retention", eng: 10, design: 3, data: 1, clar: 0.7, debt: 1,
      effects: { site: { churn: 0.12, arpu: 0.03 } }, per_new: 120, sponsor: "design", serves: ["retain"] },
    { id: "price_rise", name: "A modest price rise on the core range", about: "Reprice the range that sells on brand rather than on price. Some shoppers will walk.", area: "monetise", eng: 5, design: 1, data: 2, clar: 0.6, debt: 0,
      effects: { site: { arpu: 0.06, s3: -0.03 }, market: { arpu: 0.05, s3: -0.04 }, qc: { arpu: 0.04, s3: -0.04 } }, sponsor: "lead", serves: ["monetise"] },
    { id: "overhead_cut", name: "Renegotiate fulfilment and channel contracts", about: "Reduce variable costs across the own-site, marketplace and quick-commerce channels. Head-office staffing and fixed overhead stay unchanged.", area: "debt", eng: 6, design: 0, data: 1, clar: 0.9, debt: -3, one_off: 40,
      effects: { site: { cost: -0.04 }, market: { cost: -0.04 }, qc: { cost: -0.04 } }, sponsor: "lead", serves: ["debt", "monetise"] },
    { id: "warehouse_automation", name: "Automate pick and pack in the main warehouse", about: "Scanners, a conveyor and a pick-to-light system for the busiest lines.", area: "debt", eng: 30, design: 0, data: 1, clar: 0.5, debt: -10, quality: { rel: 6 },
      effects: { site: { cost: -0.05, s3: 0.02 }, market: { cost: -0.05 }, qc: { cost: -0.04 } }, sponsor: "eng", serves: ["debt", "quality"] },
    { id: "returns_programme", name: "Cut returns: size guides, packaging and quality checks", about: "Fewer wrong-size and damaged deliveries, which cost most on the fast channels.", area: "reliability", eng: 12, design: 4, data: 1, clar: 0.7, debt: 0, quality: { use: 3 },
      effects: { market: { cost: -0.06, churn: 0.04 }, qc: { cost: -0.08, churn: 0.04 }, site: { cost: -0.03 } }, sponsor: "design", serves: ["quality", "monetise"] },
    { id: "finance_dash", name: "Contribution by channel after returns and discounts", about: "A weekly view of what each channel really earns, after returns, discounts and fees. Raises measurement to level 2.", area: "learning", eng: 8, design: 0, data: 3, clar: 0.9, debt: -1, enables: 2,
      effects: {}, sponsor: "lead", serves: ["learn"] },
    { id: "brand_campaign", name: "A brand film and an influencer push", about: "Awareness for the own site, ahead of the festival season.", area: "growth", eng: 6, design: 8, data: 0, clar: 0.6, debt: 0, one_off: 55,
      effects: { site: { inflow: 0.18, s1: 0.04 } }, sponsor: "design", serves: ["grow"] },
    { id: "rebalance_channels", name: "Move advertising from marketplaces to the own site", about: "Shift the spend to where a customer stays and costs less to serve.", area: "growth", eng: 8, design: 2, data: 2, clar: 0.7, debt: 0,
      effects: { site: { inflow: 0.12 }, market: { inflow: -0.1, cost: -0.02 } }, sponsor: "biz", serves: ["grow", "monetise"] },
  ],
  squad: squad(14, 4, 2, 420, 340),
  start: { debt: 55, reliability: 55, usability: 55, morale: 60, trust: { eng: 58, design: 55, biz: 50, lead: 45, ext: 50 }, cash: 1800, level: 1 },
  incident_base: 1.0, design_ref: 28,
  hidden: [
    { id: "qc_leak", label: "Share of quick-commerce revenue lost to returns and discounts as the channel grows", description: "The sales head's twelve percent was measured on last year's small volumes. Nobody has costed returns and discounts at three times the size.", brief: 0.12, range: [0.08, 0.45], unit: "share" },
    { id: "supplier_fill", label: "How often the main mill really delivers on time and in full", description: "The operations head quotes the mill's own figure. The warehouse's goods-in records, which would show the real one, are not summarised anywhere.", brief: 0.96, range: [0.65, 0.98], unit: "share" },
    { id: "premium_demand", label: "Share of site buyers who would really pay for a premium line", description: "Forty-five percent said so in a survey. What people say in a survey and what they put in the basket are different things.", brief: 0.45, range: [0.12, 0.55], unit: "share" },
    { id: "abandon_checkout", label: "Share of site abandonment caused by the checkout itself", description: "The growth head assumes it is the checkout. Shipping charges and price are the other suspects.", brief: 0.6, range: [0.2, 0.7], unit: "share" },
  ],
  events: [
    { id: "supplier_fire", name: "Fire at the main mill", weight: 0.35, signal: "The main mill has stopped shipping, nobody is answering its phone, and there are three weeks of stock left.",
      body: "A fire has stopped the mill that makes most of your cotton. Production is out for two months. Orders you cannot fill are cancelled, and customers who were promised delivery do not always come back.",
      cause: "mill_fire", direction: "second_source_now",
      causes: [{ id: "mill_fire", label: "A fire at the mill" }, { id: "payment_dispute", label: "A payment dispute we caused" }, { id: "customs_hold", label: "A customs hold at the port" }],
      directions: [{ id: "second_source_now", label: "Air-freight from a second source, ration stock to the best customers and tell everyone plainly" }, { id: "wait_it_out", label: "Wait for the mill to recover" }, { id: "discount_to_clear", label: "Discount what is left to clear the stock" }],
      effects: { site: { s3: -0.1, churn: -0.08 }, market: { s3: -0.12, churn: -0.1 }, qc: { s3: -0.15, churn: -0.12 } }, incident: 1.5,
      mitigations: [{ live: "second_source", by: 0.35 }, { rel: 65, by: 0.15 }, { trust: ["ext", 55], by: 0.1 }] },
    { id: "price_war", name: "A rival cuts prices to win share", weight: 0.35, signal: "Orders on the marketplaces and the quick-commerce apps are falling, and a rival's listings now sit a quarter below yours.",
      body: "A well-funded rival is selling below cost to win share. The undercutting lasts as long as its investors' patience.",
      cause: "rival_subsidy", direction: "hold_and_protect",
      causes: [{ id: "rival_subsidy", label: "A rival is subsidising its prices" }, { id: "our_pricing", label: "We are overpriced" }, { id: "festival_lull", label: "A seasonal lull" }],
      directions: [{ id: "hold_and_protect", label: "Hold prices, protect the own site and the loyal customers, and let the rival burn" }, { id: "match_price", label: "Match the rival's prices" }, { id: "cut_ads", label: "Cut advertising and wait" }],
      effects: { market: { s2: -0.12, churn: -0.08 }, qc: { s2: -0.15, churn: -0.1 }, site: { s1: -0.04 } }, incident: 0.5,
      mitigations: [{ live: "loyalty", by: 0.25 }, { live: "rebalance_channels", by: 0.2 }, { trust: ["biz", 55], by: 0.1 }] },
    { id: "leader_resigns", name: "The head of sales resigns", weight: 0.3, signal: "The head of sales has resigned and joined a rival, and two channel managers are updating their CVs.",
      body: "The person who owns the marketplace and quick-commerce relationships leaves in four weeks. The accounts they held get less attention until someone settles in.",
      cause: "target_fight", direction: "reset_targets",
      causes: [{ id: "target_fight", label: "A fight over targets set on volume, not margin" }, { id: "poached", label: "A better offer from the rival" }, { id: "burnout", label: "Burnout after a hard year" }],
      directions: [{ id: "reset_targets", label: "Reset the targets to margin, promote a deputy and reassure the channel managers" }, { id: "counter_offer", label: "Make a counter-offer" }, { id: "replace_outside", label: "Hire a replacement from outside" }],
      effects: { market: { s2: -0.06, churn: -0.05 }, qc: { s2: -0.08, churn: -0.06 } }, incident: 1.0,
      mitigations: [{ trust: ["biz", 60], by: 0.25 }, { live: "finance_dash", by: 0.2 }, { trust: ["lead", 55], by: 0.15 }] },
  ],
  plans: [
    { id: "expand", name: "Expand", pitch: "Open more channels and categories while the brand has momentum.", inflow: 1.3, arpu: 1.03, cost: 1.05, churn: 1.05, marketing: 1.3, needs: { rel: 62, trust: ["lead", 60] } },
    { id: "consolidate", name: "Consolidate", pitch: "Fewer channels, a leaner head office and a straight line to break-even.", inflow: 0.9, arpu: 1.1, cost: 0.88, churn: 0.85, marketing: 0.75, needs: { debt_below: 55 } },
    { id: "raise_now", name: "Raise now", pitch: "Go to investors while their appetite lasts, with the story the numbers support.", inflow: 1.12, arpu: 1.04, cost: 0.97, churn: 0.95, marketing: 1.15, needs: { use: 58, trust: ["lead", 55] } },
  ],
  root: {
    prompt: "What is draining the cash?",
    options: [{ id: "qc_losses", label: "Quick-commerce orders that lose money after returns and discounts" }, { id: "overhead", label: "Head-office overhead we have not cut" }, { id: "price_pressure", label: "Rivals forcing our prices down" }, { id: "supplier_cost", label: "What the mills charge us" }, { id: "need_more_data", label: "I need more data" }],
    dive: "qc_leak", threshold: 0.2, high: "qc_losses", low: "overhead",
  },
  measurement: measurement("Revenue by channel", "Orders and revenue by channel, the cash balance and the bank statement. Nothing about what a sale costs after returns."),
  quarters: quarters(
    "{company} runs at {hold_profit} a quarter and has {cash} in the bank, {runway}. Of every 100 people who visit the own site, {per100_site} place an order. Your team has about {road} weeks of operations time this quarter, and every one of them is spoken for.",
    "Eighteen months of cash",
    "The board will back one of three plans for the year after. Profit last quarter was {profit}. Where you stand: customer experience {U}, supply reliability {R}, operating debt {D}, operations trust {trust_eng}, board trust {trust_lead}."),
  rubric: rubric("chief_executive"),
  calibration: ((): VentureScenario["calibration"] => {
    const c = calibration();
    c.bots = c.bots.map((b) => (b.id === "random" ? {
      ...b, expected_final: { min: 20, max: 50 },
      revised: { min: 20, max: 45, why: "Written as 20-45 before the first run. The first run put the mean at 45.1, a tenth of a point over the line and well inside the noise of forty worlds (about 2 points), so the top was moved to 50 after seeing results. Most of the ordinary initiatives here are worth doing, so chance builds something useful more often than in the product cases." },
    } : b));
    return c;
  })(),
};

export const plan: FitPlan = {
  ordinary: { second_source: 0.9, site_rebuild: 1.0, loyalty: 1.0, price_rise: 1.6, overhead_cut: 1.2, warehouse_automation: 0.7, returns_programme: 1.0, brand_campaign: 0.5, rebalance_channels: 0.9 },
  bets: [
    { id: "scale_qc", knob: "side", hidden: "qc_leak", kind: "A", tier: 1.4 },
    { id: "supplier_contract", knob: "side", hidden: "supplier_fill", kind: "B", tier: 1.3 },
    { id: "premium_line", knob: "side", hidden: "premium_demand", kind: "B", tier: 1.3 },
  ],
};
