// Turns the rubric in the scenario file into a score for one cycle.
//
//   sub-criterion  -> full | part | none | na            (rules.ts)
//   points         =  trait.weight / number of sub-criteria in the trait * level factor
//   trait_total    =  100 * points earned / points that could be earned this cycle
//   final          =  clamp(trait_total + modifier_total, 0, 100)
//
// A sub-criterion with `backed_by` can earn full only if the player had learned something relevant by then.
//
// `na` sub-criteria drop out of both sides, so a cycle is never marked down for a question that cannot be
// asked yet. Each remaining sub-criterion keeps its own fixed worth, so one live question never inherits
// the weight of the ones that are not live.
import type { CycleScore, Run, SubScore, TraitScore } from "./types.ts";
import { MOD, SUB, learnedFrom } from "./rules.ts";
import { clamp } from "./model.ts";

const fill = (tpl: string, f: Record<string, string | number>): string => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(f[k] ?? `{${k}}`));

export const bandOf = (run: Run, final: number): string => [...run.sc.rubric.bands].sort((a, b) => b.min - a.min).find((b) => final >= b.min)!.label;

export function scoreCycle(run: Run, c: number): CycleScore {
  const rb = run.sc.rubric;
  const x = { run, c };

  const traits: TraitScore[] = rb.traits.map((t) => {
    const results = t.subcriteria.map((s) => {
      const fn = SUB[s.rule.fn];
      if (!fn) throw new Error(`no implementation for rule ${s.rule.fn}`);
      const r = fn(x, s.rule.params);
      // A claim with nothing learned behind it is a guess, however right: credit in part.
      const unbacked = s.backed_by && r.level === "full" && !learnedFrom(x, s.backed_by.any_of);
      return { s, r: unbacked ? { level: "part" as const, f: r.f, text: s.backed_by!.missing } : r };
    });
    const each = t.weight / t.subcriteria.length;
    const subs: SubScore[] = results.map(({ s, r }) => ({
      id: s.id,
      label: s.label,
      level: r.level,
      maxPoints: r.level === "na" ? 0 : each,
      points: r.level === "na" ? 0 : each * rb.level_factors[r.level],
      evidence: r.level === "na" ? "" : (r.text ?? fill(s.evidence[r.level], r.f)),
    }));
    return { id: t.id, name: t.name, weight: t.weight, applicableWeight: subs.reduce((a, b) => a + b.maxPoints, 0), points: subs.reduce((a, b) => a + b.points, 0), subs };
  });

  const earnable = traits.reduce((a, t) => a + t.applicableWeight, 0);
  const traitTotal = earnable ? (100 * traits.reduce((a, t) => a + t.points, 0)) / earnable : 0;

  const modifiers = rb.modifiers.filter((m) => MOD[m.rule.fn]?.(x, m.rule.params)).map((m) => ({ id: m.id, points: m.points, why: m.why }));
  const modifierTotal = modifiers.reduce((a, m) => a + m.points, 0);
  const final = clamp(traitTotal + modifierTotal, 0, 100);
  return { cycle: c, traits, traitTotal, modifiers, modifierTotal, final, band: bandOf(run, final) };
}

/** A run's score is the mean of its cycle scores. */
export const runScore = (run: Run): number => (run.scores.length ? run.scores.reduce((a, s) => a + s.final, 0) / run.scores.length : 0);
