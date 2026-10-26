// PROTOTYPE. Fits each item's effect size so that it is worth a believable share of the company's profit at what the briefing
// says, and, for the bets, so that its value crosses zero where about three worlds in ten are on the losing side.
// Usage: node proto/venture/fit.ts   (prints the FIT table to paste into cases.ts)
import { calibrate, RAW_MARIGOLD, RAW_TALLYHOUSE } from "./cases.ts";
import type { Fit } from "./cases.ts";
import { idleDecision, newState, newWorld, playQuarter, valueOf } from "./model.ts";
import type { CaseData } from "./model.ts";

/** kind A: the cost grows with the hidden fact. kind B: the benefit grows with it. */
interface Bet { id: string; knob: NonNullable<Fit["knob"]>; hidden: string; kind: "A" | "B"; tier: number }
interface Plan { raw: CaseData; ordinary: Record<string, number>; bets: Bet[] }
const LOSING = 0.3;

const PLANS: Plan[] = [
  { raw: RAW_MARIGOLD,
    ordinary: { kyc_camera: 1.3, lang_onboard: 0.8, support_bot: 0.7, salary_link: 1.5, fraud_v2: 0.35, app_perf: 0.5, nudges: 1.1, referral: 0.9 },
    bets: [
      { id: "kyc_defer", knob: "side", hidden: "fraud_mult", kind: "A", tier: 1.4 },
      { id: "first_reward", knob: "loss", hidden: "reward_hunters", kind: "A", tier: 1.3 },
      { id: "soundbox", knob: "oneOff", hidden: "merchant_pull", kind: "B", tier: 1.4 },
    ] },
  { raw: RAW_TALLYHOUSE,
    ordinary: { onboarding_wizard: 1.0, annual_plan: 0.9, integrations: 0.9, mobile_time: 0.5, reporting: 1.1, design_system: 0.2, perf_reliability: 0.25, upgrade_flow: 1.2, billing_rewrite: 0.45 },
    bets: [
      { id: "tiering", knob: "loss", hidden: "elasticity", kind: "A", tier: 1.4 },
      { id: "usage_addon", knob: "side", hidden: "addon_wtp", kind: "B", tier: 1.4 },
      { id: "sso_audit", knob: "side", hidden: "ent_pipeline", kind: "B", tier: 1.3 },
    ] },
];

for (const plan of PLANS) {
  const raw = plan.raw, fit: Record<string, Fit> = {};
  const probe = calibrate(raw, {});
  const revenueQ = playQuarter({ ...newWorld(probe, 1, { vary: false }), expected: { effect: 1, overrun: 1 } }, newState(probe), idleDecision(), { evQ: 99 }).r.revenue;
  const tpw = revenueQ / 125;
  const engOf = (id: string): number => probe.inits.find((i) => i.id === id)!.eng;
  const V = (id: string, f: Fit, h?: Record<string, number>): number => {
    const cs = calibrate(raw, { ...fit, [id]: f });
    return valueOf({ ...newWorld(cs, 1, { vary: false }), expected: { effect: 1, overrun: 1, hidden: h } }, newState(cs), id);
  };
  for (const [id, tier] of Object.entries(plan.ordinary)) {
    const T = tier * tpw * engOf(id);
    let a = 1;
    for (let k = 0; k < 6; k++) { const v0 = V(id, { a: 0 }), v1 = V(id, { a: 1 }); a = Math.max(0.01, (T - v0) / (v1 - v0)); fit[id] = { a }; if (Math.abs(V(id, { a }) - T) < 0.01 * T) break; }
    fit[id] = { a: Math.round(a * 100) / 100 };
  }
  for (const b of plan.bets) {
    const [lo, hi] = raw.hidden[b.hidden]!, brief = raw.brief[b.hidden]!;
    const star = b.kind === "A" ? hi - LOSING * (hi - lo) : lo + LOSING * (hi - lo);
    const T = b.tier * tpw * engOf(b.id), G = T / (1 - (b.kind === "A" ? brief / star : star / brief));
    const hid = (x: number): Record<string, number> => ({ [b.hidden]: x });
    // gross: with the cost removed, the item is worth G at the briefing
    let a = 1;
    for (let k = 0; k < 6; k++) { const v0 = V(b.id, { a: 0, c: 0, knob: b.knob }, hid(brief)), v1 = V(b.id, { a: 1, c: 0, knob: b.knob }, hid(brief)); a = Math.max(0.01, (G - v0) / (v1 - v0)); fit[b.id] = { a, c: 0, knob: b.knob }; if (Math.abs(V(b.id, fit[b.id]!, hid(brief)) - G) < 0.01 * G) break; }
    // cost: what is left at the briefing is T
    const c1 = V(b.id, { a, c: 0, knob: b.knob }, hid(brief)) - V(b.id, { a, c: 1, knob: b.knob }, hid(brief));
    let c = (G - T) / c1;
    // refine both together against the two conditions
    const f = (a2: number, c2: number): [number, number] => { const ff: Fit = { a: a2, c: c2, knob: b.knob }; return [V(b.id, ff, hid(brief)) - T, V(b.id, ff, hid(star))]; };
    for (let k = 0; k < 8; k++) {
      const [f1, f2] = f(a, c);
      if (Math.abs(f1) < 0.01 * T && Math.abs(f2) < 0.01 * T) break;
      const da = 0.02 * a, dc = 0.02 * c, [g1, g2] = f(a + da, c), [h1, h2] = f(a, c + dc);
      const j11 = (g1 - f1) / da, j21 = (g2 - f2) / da, j12 = (h1 - f1) / dc, j22 = (h2 - f2) / dc, det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-12) break;
      a = Math.max(0.02, a - (j22 * f1 - j12 * f2) / det); c = Math.max(0.02, c - (-j21 * f1 + j11 * f2) / det);
    }
    fit[b.id] = { a: Math.round(a * 1000) / 1000, c: Math.round(c * 1000) / 1000, knob: b.knob };
    const ff = fit[b.id]!;
    let neg = 0; const N = 40;
    for (let k = 0; k <= N; k++) if (V(b.id, ff, hid(lo + ((hi - lo) * k) / N)) < 0) neg++;
    console.log(`// ${b.id}: ${V(b.id, ff, hid(brief)).toFixed(0)} L at the briefing (${b.hidden} ${brief}; target ${T.toFixed(0)}), ${V(b.id, ff, hid(star)).toFixed(0)} at ${star.toFixed(2)}, loses money in ${Math.round((neg / (N + 1)) * 100)}% of the range ${lo}-${hi}`);
  }
  console.log(`// ${raw.title}: revenue a quarter ${revenueQ.toFixed(0)}, value per engineering week at tier 1: ${tpw.toFixed(1)}`);
  console.log(`  ${raw.id}: ${JSON.stringify(fit)},`);
}
