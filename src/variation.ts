// Per-seed variation of the hidden world. An answer key learned in one world must not work in another, so
// effect sizes, fatigue ceilings and the pricing and attribution truths are redrawn for every seed.
//
// What the player can observe or is told never moves: segment baselines, lever costs and lead times, names,
// the shape of the rubric. A lever that does nothing for a segment still does nothing for it, and a lever's
// sign never flips; only magnitudes change, so "which lever or segment responds most" really does differ
// between worlds while the story still makes sense.
import type { Scenario } from "./types.ts";
import { normal } from "./rng.ts";

const EFFECT_KEYS = ["weekly_sessions_rel", "session_seconds_rel", "return_30d_rel"] as const;

/** Fill hidden truths that are defined by other parts of the world, so they always agree with it. Mutates and returns `sc`. */
export function fillDerived(sc: Scenario): Scenario {
  const levers = sc.levers.filter((l) => l.kind === "build" && l.effects);
  for (const h of sc.hidden_variables) {
    if ((h.truth as { derived_from?: string } | null)?.derived_from === "lever_effects") {
      h.truth = Object.fromEntries(sc.segments.map((s) => [s.id, Object.fromEntries(levers.map((l) => [l.id, l.effects![s.id]?.return_30d_rel ?? 0]))]));
    }
  }
  return sc;
}

export function vary(sc: Scenario, seed: number): Scenario {
  const v = sc.engine.variation;
  const out = structuredClone(sc);
  // Lognormal with mean 1: variation moves the world around the file's values instead of biasing it.
  const mult = (sd: number, ...label: (string | number)[]): number => Math.exp(sd * normal(seed, "vary", ...label) - (sd * sd) / 2);

  for (const l of out.levers) {
    for (const [seg, ef] of Object.entries(l.effects ?? {})) {
      const k = mult(v.effect_sd, "effect", l.id, seg);
      for (const key of EFFECT_KEYS) if (ef[key] !== undefined) ef[key] = ef[key]! * k;
    }
    const gain = l.params?.model?.gain_weekly_sessions_rel_per_vol_pow_0_6 as Record<string, number> | undefined;
    if (gain) for (const seg of Object.keys(gain)) gain[seg] = gain[seg]! * mult(v.effect_sd, "gain", seg);
  }

  for (const h of out.hidden_variables) {
    const rule = v.hidden[h.id];
    if (!rule) continue;
    const draw = (x: unknown, leaf: string): unknown => {
      if (typeof x === "number") {
        let y = x * mult(rule.sd, "hidden", h.id, leaf);
        if (rule.min_multiple_of_baseline_volume !== undefined) y = Math.max(y, rule.min_multiple_of_baseline_volume * (out.engine.notification_baseline.volume[leaf] ?? 0));
        if (rule.min !== undefined) y = Math.max(y, rule.min);
        if (rule.max !== undefined) y = Math.min(y, rule.max);
        return y;
      }
      if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, draw(val, k)]));
      return x;
    };
    h.truth = draw(h.truth, "");
  }
  return out;
}
