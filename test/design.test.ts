import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// The look the web app keeps to: flat surfaces with hairline borders, no gradients, no glass, no colored side stripes,
// and no em dashes in the words a player reads. These fail loudly if someone adds one back.
const here = (p: string): URL => new URL(`../${p}`, import.meta.url);

test("the stylesheet has no shadows, gradients, glass or colored side stripes", () => {
  const css = readFileSync(here("web/style.css"), "utf8");
  for (const [what, re] of [["a shadow", /(box|drop|text)-shadow/], ["a gradient", /gradient\(/], ["glass", /backdrop-filter/], ["a side stripe", /border-(left|right):\s*\d+px\s+solid/]] as const) {
    assert.doesNotMatch(css, re, what);
  }
});

test("no em dash in the text of any case or in the engine's own wording", () => {
  const files = [...readdirSync(here("scenarios")).map((f) => `scenarios/${f}`), ...readdirSync(here("src/venture")).map((f) => `src/venture/${f}`), ...readdirSync(here("src")).filter((f) => f.endsWith(".ts")).map((f) => `src/${f}`)];
  for (const f of files) if (/\.(json|ts)$/.test(f)) assert.ok(!readFileSync(here(f), "utf8").includes("—"), `${f} has an em dash`);
});
