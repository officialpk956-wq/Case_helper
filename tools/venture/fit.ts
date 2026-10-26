// Fits a venture case to the engine's economy. An author writes a scenario with rough effect sizes; this scales them so that
//   - an ordinary item is worth a stated multiple (its tier) of a believable value per engineering week, at the briefing's figures, and
//   - a bet is worth its tier at the briefing's figure, and crosses zero where about three worlds in ten are on the losing side
//     (so a manager who trusts the sponsor's number is caught out about that often, and one who looks into it is not).
// The value of an item is the engine's own (valueOf, over the year played and the year after), so the fit is only as good as the model.
// Usage: through tools/venture/build.ts.
import { idleDecision, newState, newWorld, playQuarter, valueOf } from "../../src/venture/model.ts";
import type { Effect, VentureScenario } from "../../src/venture/types.ts";

/** kind A: the cost grows with the hidden fact. kind B: the benefit grows with it. `knob` is the cost side the fit scales. */
export interface Bet { id: string; knob: "side" | "per_new" | "one_off" | "loss"; hidden: string; kind: "A" | "B"; tier: number }
export interface FitPlan { ordinary: Record<string, number>; bets: Bet[]; losing?: number }
interface F { a: number; c?: number; knob?: Bet["knob"] }

/** The scenario with each fitted item's favourable effects times `a`, and its cost side times `c`. */
export function applyFit(raw: VentureScenario, fits: Record<string, F>): VentureScenario {
  const out = structuredClone(raw);
  for (const i of out.items) {
    const f = fits[i.id];
    if (!f) continue;
    for (const e of Object.values(i.effects)) for (const k of Object.keys(e) as (keyof Effect)[]) {
      const v = e[k]!, good = k === "cost" ? v < 0 : v > 0;
      e[k] = good ? v * f.a : f.knob === "loss" ? v * (f.c ?? 1) : v;
    }
    if (f.knob === "side" && i.side_cost) i.side_cost.per_quarter *= f.c ?? 1;
    if (f.knob === "per_new" && i.per_new) i.per_new *= f.c ?? 1;
    if (f.knob === "one_off" && i.one_off) i.one_off *= f.c ?? 1;
  }
  return out;
}

const round = (x: number, d: number): number => Math.round(x * 10 ** d) / 10 ** d;

export function fitScenario(raw: VentureScenario, plan: FitPlan): { scenario: VentureScenario; notes: string[] } {
  const notes: string[] = [];
  const fits: Record<string, F> = {};
  const probe = structuredClone(raw);
  const revenueQ = playQuarter({ ...newWorld(probe, 1, { vary: false }), expected: { effect: 1, overrun: 1 } }, newState(probe), idleDecision(), { evQ: 99 }).r.revenue;
  const tpw = revenueQ / 125;
  const engOf = (id: string): number => raw.items.find((i) => i.id === id)!.eng;
  const V = (id: string, f: F, h?: Record<string, number>): number => {
    const cs = applyFit(raw, { ...fits, [id]: f });
    return valueOf({ ...newWorld(cs, 1, { vary: false }), expected: { effect: 1, overrun: 1, hidden: h } }, newState(cs), id);
  };
  for (const [id, tier] of Object.entries(plan.ordinary)) {
    const T = tier * tpw * engOf(id);
    let a = 1;
    for (let k = 0; k < 6; k++) { const v0 = V(id, { a: 0 }), v1 = V(id, { a: 1 }); a = Math.max(0.01, (T - v0) / (v1 - v0)); fits[id] = { a }; if (Math.abs(V(id, { a }) - T) < 0.01 * T) break; }
    fits[id] = { a: round(a, 3) };
    notes.push(`${id}: worth ${V(id, fits[id]!).toFixed(0)} L at the briefing (target ${T.toFixed(0)})`);
  }
  const LOSING = plan.losing ?? 0.3;
  for (const b of plan.bets) {
    const fact = raw.hidden.find((h) => h.id === b.hidden)!, [lo, hi] = fact.range, brief = fact.brief;
    const star = b.kind === "A" ? hi - LOSING * (hi - lo) : lo + LOSING * (hi - lo);
    const T = b.tier * tpw * engOf(b.id), G = T / (1 - (b.kind === "A" ? brief / star : star / brief));
    const hid = (x: number): Record<string, number> => ({ [b.hidden]: x });
    let a = 1;
    for (let k = 0; k < 6; k++) { const v0 = V(b.id, { a: 0, c: 0, knob: b.knob }, hid(brief)), v1 = V(b.id, { a: 1, c: 0, knob: b.knob }, hid(brief)); a = Math.max(0.01, (G - v0) / (v1 - v0)); fits[b.id] = { a, c: 0, knob: b.knob }; if (Math.abs(V(b.id, fits[b.id]!, hid(brief)) - G) < 0.01 * G) break; }
    const c1 = V(b.id, { a, c: 0, knob: b.knob }, hid(brief)) - V(b.id, { a, c: 1, knob: b.knob }, hid(brief));
    let c = (G - T) / c1;
    const f = (a2: number, c2: number): [number, number] => { const ff: F = { a: a2, c: c2, knob: b.knob }; return [V(b.id, ff, hid(brief)) - T, V(b.id, ff, hid(star))]; };
    for (let k = 0; k < 8; k++) {
      const [f1, f2] = f(a, c);
      if (Math.abs(f1) < 0.01 * T && Math.abs(f2) < 0.01 * T) break;
      const da = 0.02 * a, dc = 0.02 * c, [g1, g2] = f(a + da, c), [h1, h2] = f(a, c + dc);
      const j11 = (g1 - f1) / da, j21 = (g2 - f2) / da, j12 = (h1 - f1) / dc, j22 = (h2 - f2) / dc, det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-12) break;
      a = Math.max(0.02, a - (j22 * f1 - j12 * f2) / det); c = Math.max(0.02, c - (-j21 * f1 + j11 * f2) / det);
    }
    fits[b.id] = { a: round(a, 3), c: round(c, 3), knob: b.knob };
    const ff = fits[b.id]!;
    let neg = 0; const N = 40;
    for (let k = 0; k <= N; k++) if (V(b.id, ff, hid(lo + ((hi - lo) * k) / N)) < 0) neg++;
    notes.push(`${b.id}: ${V(b.id, ff, hid(brief)).toFixed(0)} L at the briefing (${b.hidden} ${brief}; target ${T.toFixed(0)}), ${V(b.id, ff, hid(star)).toFixed(0)} at ${star.toFixed(2)}, loses money in ${Math.round((neg / (N + 1)) * 100)}% of the range ${lo}-${hi}`);
  }
  const scenario = applyFit(raw, fits);
  for (const i of scenario.items) {
    for (const e of Object.values(i.effects)) for (const k of Object.keys(e) as (keyof Effect)[]) e[k] = round(e[k]!, 4);
    if (i.side_cost) i.side_cost.per_quarter = round(i.side_cost.per_quarter, 2);
    if (i.per_new !== undefined) i.per_new = round(i.per_new, 2);
    if (i.one_off !== undefined) i.one_off = round(i.one_off, 1);
  }
  notes.push(`revenue a quarter ${revenueQ.toFixed(0)} L; value per engineering week at tier 1: ${tpw.toFixed(1)} L`);
  return { scenario, notes };
}
