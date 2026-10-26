// Fits every case in tools/venture/cases/ and writes scenarios/<slug>.venture.json.
// Usage: node tools/venture/build.ts [slug ...]
// A case module exports `slug`, `raw` (a scenario with rough effect sizes) and `plan` (a FitPlan). The scenario file is the source of truth
// once written; run this again only to refit after changing the model or a case's raw numbers.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fitScenario } from "./fit.ts";
import type { FitPlan } from "./fit.ts";
import type { VentureScenario } from "../../src/venture/types.ts";

/** JSON, with short arrays of plain values kept on one line. */
const json = (o: unknown): string => JSON.stringify(o, null, 2).replace(/\[\n\s+([^[\]{}]+?)\n\s+\]/g, (_m, inner: string) => `[${inner.split(/,\n\s+/).join(", ")}]`) + "\n";

const dir = join(import.meta.dirname, "cases");
const only = process.argv.slice(2);
for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()) {
  const mod = (await import(pathToFileURL(join(dir, file)).href)) as { slug: string; raw: VentureScenario; plan: FitPlan };
  if (only.length && !only.includes(mod.slug)) continue;
  const { scenario, notes } = fitScenario(mod.raw, mod.plan);
  writeFileSync(join(import.meta.dirname, "..", "..", "scenarios", `${mod.slug}.venture.json`), json(scenario));
  console.log(`\n${mod.slug}`);
  for (const n of notes) console.log("  " + n);
}
