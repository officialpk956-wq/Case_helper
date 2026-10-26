// Checks that hold for every case in scenarios/: a case brings its own playbook, so a new one is covered by adding a file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOTS } from "../src/bots.ts";
import { lever as leverOf, maxBets } from "../src/model.ts";
import { loadScenario, playRun } from "../src/play.ts";
import { IMPLEMENTED } from "../src/rules.ts";
import { runScore } from "../src/score.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "scenarios");
const cases = readdirSync(dir).filter((f) => f.endsWith(".scenario.json")).sort().map((f) => loadScenario(join(dir, f)));
const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

test("there is more than one case, and each has its own id", () => {
  assert.ok(cases.length >= 2);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
});

for (const sc of cases) {
  test(`${sc.id}: every rule it names is implemented, and every implemented rule is used`, () => {
    const used = new Set<string>([
      ...sc.rubric.traits.flatMap((t) => t.subcriteria.map((s) => s.rule.fn)),
      ...sc.rubric.modifiers.map((m) => m.rule.fn),
      ...sc.events.pool.flatMap((e) => e.mitigations.map((m) => m.when.fn)),
      ...sc.endgame.options.map((o) => o.value_model.fn),
    ]);
    for (const f of used) assert.ok(IMPLEMENTED.has(f), `missing implementation: ${f}`);
    for (const f of IMPLEMENTED) assert.ok(used.has(f), `implemented but unused: ${f}`);
  });

  test(`${sc.id}: its playbook plays every bot to the end, the same way every time, with a score from 0 to 100`, () => {
    for (const name of Object.keys(BOTS)) {
      for (const seed of [1, 2, 3]) {
        const a = playRun(sc, seed, BOTS[name]!), b = playRun(sc, seed, BOTS[name]!);
        assert.ok(a.done, `${name} did not finish seed ${seed}`);
        assert.equal(runScore(a), runScore(b), `${name} is not deterministic`);
        assert.ok(runScore(a) >= 0 && runScore(a) <= 100);
      }
    }
  });

  test(`${sc.id}: every bot scores inside the range the case gives it`, () => {
    for (const b of sc.calibration.bots) {
      const m = mean(SEEDS.map((s) => runScore(playRun(sc, s, BOTS[b.id]!))));
      assert.ok(m >= b.expected_final.min && m <= b.expected_final.max, `${b.id} averaged ${m.toFixed(1)}, outside ${b.expected_final.min}-${b.expected_final.max}`);
    }
  });

  test(`${sc.id}: evidence beats the textbook plan by at least 15 points, and a recital by a clear margin`, () => {
    const score = (name: string): number => mean(SEEDS.map((s) => runScore(playRun(sc, s, BOTS[name]!))));
    assert.ok(score("insight_first") - score("framework_first") >= 15);
    assert.ok(score("insight_first") - score("answer_key_guesser") >= 10);
    assert.ok(score("insight_first") > score("cautious_researcher"));
  });

  test(`${sc.id}: the bots that read answers learn how many bets will be backed and never start more builds than that`, () => {
    for (const seed of SEEDS.slice(0, 20)) {
      for (const name of ["insight_first", "insight_by_reach"]) {
        const r = playRun(sc, seed, BOTS[name]!);
        assert.equal(r.known.bets, String(maxBets(r)), `${name} was not told the number in seed ${seed}`);
        assert.ok(Object.keys(r.started).filter((id) => leverOf(r, id).kind === "build").length <= maxBets(r));
      }
    }
  });

  test(`${sc.id}: every stage a lever or a scope option names is declared, so a player reads a label and never an id`, () => {
    const ids = new Set(sc.stages.map((s) => s.id));
    for (const l of sc.levers) for (const s of l.stages) assert.ok(ids.has(s), `${l.id} names stage ${s}`);
    for (const o of sc.case_facts.scope) for (const s of o.stages) assert.ok(ids.has(s));
    assert.ok(sc.stages.every((s) => s.label.trim().length > 0));
  });
}
