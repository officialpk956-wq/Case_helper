// Reading venture scenario files. Retention scenarios are *.scenario.json; venture scenarios are *.venture.json.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { VentureScenario } from "./types.ts";

export const VENTURE_SUFFIX = ".venture.json";
export const loadVenture = (path: string): VentureScenario => JSON.parse(readFileSync(path, "utf8")) as VentureScenario;
export const ventureFiles = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith(VENTURE_SUFFIX)).sort().map((f) => join(dir, f));
export const loadVentureDir = (dir: string): VentureScenario[] => ventureFiles(dir).map(loadVenture);
