import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";
import { chooseEndgame } from "../src/engine.ts";
import { replay } from "../src/play.ts";
import { runScore } from "../src/score.ts";
import type { Decision } from "../src/types.ts";
import { signIn } from "./signin.ts";

const app = createApp();
await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const cookie = await signIn(base);
after(() => app.server.close());

const CASE = "retention_after_the_search";
/** A request with headers Node's fetch would not let a test set (Host, Origin). */
const raw = (method: string, path: string, headers: Record<string, string>): Promise<number> =>
  new Promise((resolve, reject) => {
    const u = new URL(base);
    const req = request({ host: u.hostname, port: u.port, method, path, headers }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, { method, headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const start = async (seed: number): Promise<any> => (await call("POST", "/api/runs", { scenario: CASE, seed })).json;
const REFLECTION = { root_cause: "need_more_data", primary_metric: "return_30d", guardrail_metric: "notif_opt_out", expected_movement: "flat" };
const decide = (extra: Decision): Decision => ({ focusSegment: "active_applicants", reflection: REFLECTION, status: { bet: "This cycle we do a little." }, ...extra });
const DECISIONS: Decision[] = [
  decide({ start: ["instrumentation_v1", "user_interviews"] }),
  decide({ start: ["application_tracker"] }),
  decide({}),
  decide({}),
];

/** Every key anywhere in a value. */
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
};

test("the case list has every case in scenarios/, each with its stages named for a player", async () => {
  const list = (await call("GET", "/api/cases")).json.filter((c: any) => c.kind === "retention");
  assert.equal(list.length, app.scenarios.length);
  assert.ok(list.length >= 2);
  assert.deepEqual(list.map((c: any) => c.id).sort(), app.scenarios.map((s) => s.id).sort());
  for (const c of list) {
    const pub = (await call("GET", `/api/cases/${c.id}`)).json;
    assert.equal(pub.stages.length, 2);
    const ids = new Set(pub.stages.map((s: any) => s.id));
    assert.ok(pub.levers.every((l: any) => l.stages.every((s: string) => ids.has(s))), "a lever names a stage that is not declared");
    assert.ok(pub.stages.every((s: any) => s.label.length > 0));
  }
});

test("what the browser is sent about any case holds none of what the engine keeps back", async () => {
  for (const sc of app.scenarios) {
    const pub = (await call("GET", `/api/cases/${sc.id}`)).json;
    const keys = keysOf(pub);
    for (const forbidden of ["playbook", "calibration", "rubric", "truth", "effects", "hidden_variables", "value_model", "events", "case_facts", "relevance", "answer", "learns", "signal_for", "noise_scale"]) {
      assert.ok(!keys.has(forbidden), `${sc.id} leaks "${forbidden}"`);
    }
    const text = JSON.stringify(pub);
    const answers = sc.clarify.questions.flatMap((q) => (typeof q.answer === "string" ? [q.answer] : Object.values(q.answer.cases).map((c) => c.text)));
    for (const a of answers) assert.ok(!text.includes(a), `${sc.id}: an answer leaked: ${a.slice(0, 50)}`);
    for (const h of sc.hidden_variables) assert.ok(!text.includes((h as any).description), `${sc.id}: the description of ${h.id} leaked`);
    assert.equal(pub.questions.length, sc.clarify.questions.length);
    assert.ok(!text.includes("vanity"), `${sc.id}: metric kinds leaked`);
  }
});

test("what the browser is sent about the first case also holds the parts a player needs, and no lever effects", async () => {
  const pub = (await call("GET", `/api/cases/${CASE}`)).json;
  const keys = keysOf(pub);
  for (const forbidden of ["effects", "truth", "hidden_variables", "value_model", "calibration", "rubric", "engine", "events", "mitigations", "reveals_hidden", "soft_requires", "noise_scale", "relevance", "answer", "learns", "signal_for", "case_facts", "measurement", "correct", "trap", "acceptable", "model"]) {
    assert.ok(!keys.has(forbidden), `the public case leaks "${forbidden}"`);
  }
  // No question's answer, and no metric's kind (which would name the vanity metric), is in it.
  const text = JSON.stringify(pub);
  assert.ok(!text.includes("Recruiters renew when seekers keep showing up"), "an answer text leaked");
  assert.ok(!text.includes("vanity"), "metric kinds leaked");
  assert.equal(pub.questions.length, 14);
  assert.ok(pub.levers.every((l: any) => !("effects" in l)));
  assert.ok(pub.levers.some((l: any) => l.kind === "dial" && l.params.volume_per_week_range));
});

test("a run's state shows only what the player has been told or has seen", async () => {
  const run = await start(11);
  const keys = keysOf(run);
  for (const forbidden of ["facts", "known", "eventId", "mitigation", "true", "revealed", "values", "best", "ratio"]) assert.ok(!keys.has(forbidden), `the run state leaks "${forbidden}"`);
  assert.equal(run.phase, "play");
  assert.deepEqual(run.asked, []);
  const asked = (await call("POST", `/api/runs/${run.ref}/ask`, { ids: ["why_retention"] })).json;
  assert.equal(asked.asked.length, 1);
  assert.equal(asked.tokens.left, 5);
  assert.match(asked.asked[0].answer, /Recruiters renew/);
});

test("a preview says whether a plan stands and shows no results, and changes nothing", async () => {
  const run = await start(12);
  const before = JSON.stringify((await call("GET", `/api/runs/${run.ref}`)).json);
  const ok = (await call("POST", `/api/runs/${run.ref}/preview`, { decision: { start: ["instrumentation_v1"] } })).json;
  assert.deepEqual(Object.keys(ok).sort(), ["error", "locks", "ok", "spend"]);
  assert.equal(ok.ok, true);
  assert.equal(ok.spend, 2);
  assert.equal(ok.locks.in_session_interactions, "in_session_interactions is not available until cycle 2");
  assert.equal(ok.locks.article_feed, null, "tracking planned in the same decision unlocks the feed");
  const over = (await call("POST", `/api/runs/${run.ref}/preview`, { decision: { start: ["application_tracker", "peer_groups", "course_partnerships"] } })).json;
  assert.equal(over.ok, false);
  assert.match(over.error, /over capacity/);
  assert.equal(JSON.stringify((await call("GET", `/api/runs/${run.ref}`)).json), before);
});

test("a decision that does not stand is refused whole, and one that is badly shaped cannot damage the run", async () => {
  const run = await start(13);
  const tooMuch = await call("POST", `/api/runs/${run.ref}/lock`, { decision: { start: ["application_tracker", "peer_groups", "course_partnerships"] } });
  assert.equal(tooMuch.status, 422);
  assert.match(tooMuch.json.error, /over capacity/);
  for (const bad of [{ start: 5 }, { experiments: "x" }, { notifications: [1] }, { status: { bet: { x: 1 } } }, { focusSegment: 3 }, { start: ["a"], extra: true },
    { experiments: [{ lever: "ab_test", segment: "x", samplePct: "50", weeks: 2 }] }, { notifications: { active_applicants: { volume: "9" } } }, { reflection: { nonsense: "x" } }, { status: { bet: "x".repeat(3000) } }]) {
    const r = await call("POST", `/api/runs/${run.ref}/lock`, { decision: bad });
    assert.equal(r.status, 400, `${JSON.stringify(bad).slice(0, 60)} gave ${r.status}`);
  }
  const state = (await call("GET", `/api/runs/${run.ref}`)).json;
  assert.equal(state.cycle, 1);
  assert.equal(state.decisions, 0);
  assert.equal(state.reports.length, 0);
});

test("a run played through the API ends with the same score as the same decisions played directly", async () => {
  const seed = 21;
  const run = await start(seed);
  await call("POST", `/api/runs/${run.ref}/ask`, { ids: ["why_retention"] });
  for (const [i, d] of DECISIONS.entries()) {
    const res = (await call("POST", `/api/runs/${run.ref}/lock`, { decision: d })).json;
    assert.equal(res.report.cycle, i + 1);
    assert.ok(typeof res.score.final === "number" && res.score.traits.length === 7);
    assert.ok(!keysOf(res).has("true") && !keysOf(res).has("evidence"), "a locked cycle shows no hidden truth and holds the evidence back");
  }
  const state = (await call("GET", `/api/runs/${run.ref}`)).json;
  assert.equal(state.phase, "review");
  assert.equal((await call("GET", `/api/runs/${run.ref}/final`)).status, 409);
  const done = (await call("POST", `/api/runs/${run.ref}/endgame`, { option: "stay_free_invest", reasoning: "Retention first." })).json;
  assert.equal(done.phase, "final");
  const rep = (await call("GET", `/api/runs/${run.ref}/final`)).json;

  const direct = replay(app.scenarios.find((s) => s.id === CASE)!, seed, DECISIONS, { briefing: ["why_retention"] });
  chooseEndgame(direct, { option: "stay_free_invest", reasoning: "Retention first." });
  assert.equal(rep.score, runScore(direct));
  assert.equal(rep.cycles.length, 4);
  assert.ok(rep.cycles[0].traits.every((t: any) => t.subs.length > 0));
  assert.equal(rep.endgame.values.length, 4);
  assert.equal(rep.case.length, 4);
});

test("rewinding replays the same world, costs one of two rewinds, and a third is refused", async () => {
  const run = await start(31);
  const first: any[] = [];
  for (const d of DECISIONS.slice(0, 2)) first.push((await call("POST", `/api/runs/${run.ref}/lock`, { decision: d })).json);
  assert.equal((await call("POST", `/api/runs/${run.ref}/rewind`, { target: 9 })).status, 400, "there is no cycle 9 to go back to");
  const back = (await call("POST", `/api/runs/${run.ref}/rewind`, { target: 2 })).json;
  assert.equal(back.cycle, 2);
  assert.equal(back.decisions, 1);
  assert.equal(back.rewinds.used, 1);
  const again = (await call("POST", `/api/runs/${run.ref}/lock`, { decision: DECISIONS[1] })).json;
  assert.deepEqual(again.report, first[1].report, "the same world gives the same report");
  assert.equal((await call("POST", `/api/runs/${run.ref}/rewind`, { target: 1 })).json.rewinds.used, 2);
  const third = await call("POST", `/api/runs/${run.ref}/rewind`, { target: 1 });
  assert.equal(third.status, 409);
});

test("the server refuses other hosts and origins, other content types, and files outside the web folder", async () => {
  assert.equal(await raw("GET", "/api/cases", { Host: "evil.example" }), 403);
  assert.equal(await raw("POST", "/api/runs", { "Content-Type": "application/json", Origin: "http://evil.example" }), 403);
  assert.equal(await raw("GET", "/api/cases", { Cookie: cookie }), 200);
  assert.equal(await raw("GET", "/api/cases", {}), 401, "no session, no cases");
  const text = await fetch(base + "/api/runs", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" });
  assert.equal(text.status, 415);
  for (const path of ["/package.json", "/src/server.ts", "/..%2fpackage.json", "/scenarios/retention-after-the-search.scenario.json"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
});

test("the second case plays through the API as it does directly, and its readings and stages carry its own words", async () => {
  const second = app.scenarios.find((s) => s.id === "learning_in_the_middle")!;
  const seed = 17;
  const run = (await call("POST", "/api/runs", { scenario: second.id, seed })).json;
  await call("POST", `/api/runs/${run.ref}/ask`, { ids: ["why_completion"] });
  const refl = { root_cause: "need_more_data", primary_metric: "return_30d", guardrail_metric: "notif_opt_out", expected_movement: "flat" };
  const d = (extra: Decision): Decision => ({ focusSegment: "deadline_driven", reflection: refl, status: { bet: "This cycle we do a little." }, ...extra });
  const plan: Decision[] = [d({ start: ["lesson_tracking", "learner_interviews"] }), d({ start: ["weekly_goals"] }), d({}), d({})];
  for (const [i, decision] of plan.entries()) {
    const res = (await call("POST", `/api/runs/${run.ref}/lock`, { decision })).json;
    assert.equal(res.report.cycle, i + 1);
    assert.ok(Object.keys(res.report.observed).every((k) => second.metrics.some((m) => m.id === k)));
  }
  await call("POST", `/api/runs/${run.ref}/endgame`, { option: "stay_licence_invest", reasoning: "Completion first." });
  const rep = (await call("GET", `/api/runs/${run.ref}/final`)).json;
  const direct = replay(second, seed, plan, { briefing: ["why_completion"] });
  chooseEndgame(direct, { option: "stay_licence_invest", reasoning: "Completion first." });
  assert.equal(rep.score, runScore(direct));
  assert.equal(rep.endgame.optionName, "Keep licences and invest in completion");
  const stages = rep.case.find((c: any) => c.label.startsWith("Stages"))!.value as string;
  assert.ok(/programme|completion/i.test(stages) && !/search|placement/i.test(stages), `stage labels came out as: ${stages}`);
  const pub = (await call("GET", `/api/cases/${second.id}`)).json;
  assert.equal(pub.readings.deadline_pull.label, "How learners spread their effort");
});
