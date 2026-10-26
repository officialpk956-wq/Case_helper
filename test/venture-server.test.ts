import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";
import { doNothing, evidenceLed, oracle } from "../src/venture/bots.ts";
import { replay, playPolicy } from "../src/venture/run.ts";
import { scoreRun } from "../src/venture/score.ts";
import type { Decision } from "../src/venture/model.ts";
import { signIn } from "./signin.ts";

const app = createApp();
await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const cookie = await signIn(base);
after(() => app.server.close());

const CASE = "marigold_leaky_funnel";
const sc = app.ventures.find((s) => s.id === CASE)!;
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, { method, headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const start = async (seed: number, scenario = CASE): Promise<any> => (await call("POST", "/api/runs", { scenario, seed })).json;
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
};
const idle = (): Decision => ({ roadmap: [], reserve: { rel: 0.05, debt: 0.05 }, pace: "steady", research: 0.5, instrument: 0.5 });
/** What a browser must never hold while a game is on. (The final report shows the truth, once the game is over.) */
const SECRET = ["hidden", "mult", "z", "truth", "absorbed", "range", "mitigations", "hit", "lambda", "workDone", "carried"];

test("the case list carries both kinds of case, and the venture cases are shown to a player without their secrets", async () => {
  const list = (await call("GET", "/api/cases")).json;
  assert.equal(list.length, app.scenarios.length + app.ventures.length);
  const ventures = list.filter((c: any) => c.kind === "venture");
  assert.deepEqual(ventures.map((c: any) => c.id).sort(), app.ventures.map((s) => s.id).sort());
  assert.ok(ventures.every((c: any) => c.cycles === 4 && c.cycle_weeks === 12 && c.traits.length === 7));
  assert.deepEqual(ventures.map((c: any) => c.meta.order), [3, 4, 5, 6, 7, 8, 9, 10], "the cases are listed in the order the scenarios give them");
  assert.deepEqual([...new Set(ventures.map((c: any) => c.meta.seat))], ["product_manager", "chief_executive", "growth_strategy", "developer", "designer"], "all five seats are playable");
  const pub = (await call("GET", `/api/cases/${CASE}`)).json;
  assert.equal(pub.kind, "venture");
  const keys = keysOf(pub);
  for (const forbidden of ["range", "events", "mitigations", "calibration", "threshold", "scale", "incident_base"]) assert.ok(!keys.has(forbidden), `the public case leaks "${forbidden}"`);
  assert.equal((await call("GET", "/api/cases/no_such_case")).status, 404);
});

test("a game played through the API ends with the same score as the same decisions played directly", async () => {
  const seed = 2;
  const direct = playPolicy(sc, seed, evidenceLed, "evidence_led");
  const run = await start(seed);
  assert.equal(run.kind, "venture");
  assert.equal(run.quarter, 1);
  assert.equal(run.event, null);
  assert.equal((await call("GET", `/api/runs/${run.ref}/final`)).status, 409);
  for (const [k, q] of direct.qs.entries()) {
    const view = (await call("GET", `/api/runs/${run.ref}`)).json;
    assert.equal(view.quarter, k + 1);
    assert.equal(view.event === null, k + 1 !== 3, "the market event is shown in the third quarter and not before");
    for (const forbidden of SECRET) assert.ok(!keysOf(view).has(forbidden), `the run state leaks "${forbidden}" in quarter ${k + 1}`);
    const pre = (await call("POST", `/api/runs/${run.ref}/preview`, { decision: q.d })).json;
    assert.equal(pre.ok, true, pre.error);
    assert.ok(pre.preview.money.low <= pre.preview.money.high);
    const res = (await call("POST", `/api/runs/${run.ref}/lock`, { decision: q.d })).json;
    assert.equal(res.report.q, k + 1);
    for (const forbidden of SECRET) assert.ok(!keysOf(res).has(forbidden), `a locked quarter leaks "${forbidden}"`);
    assert.equal(res.state.quarter, Math.min(4, k + 2));
  }
  const done = (await call("GET", `/api/runs/${run.ref}`)).json;
  assert.equal(done.phase, "final");
  const rep = (await call("GET", `/api/runs/${run.ref}/final`)).json;
  assert.equal(rep.score, scoreRun(direct, playPolicy(sc, seed, doNothing, "do_nothing"), playPolicy(sc, seed, oracle, "oracle")).total);
  assert.equal(rep.dimensions.length, 7);
  assert.equal(rep.truth.facts.length, sc.hidden.length);
  assert.equal((await call("POST", `/api/runs/${run.ref}/lock`, { decision: idle() })).status, 422, "a finished game takes no more decisions");
});

test("a decision that does not stand is refused whole, a preview says why and changes nothing, and a badly shaped one cannot damage the run", async () => {
  const run = await start(13);
  const before = JSON.stringify((await call("GET", `/api/runs/${run.ref}`)).json);
  const bad = { ...idle(), roadmap: ["ghost"] };
  const pre = (await call("POST", `/api/runs/${run.ref}/preview`, { decision: bad })).json;
  assert.equal(pre.ok, false);
  assert.match(pre.error, /not an item in this case/);
  const lock = await call("POST", `/api/runs/${run.ref}/lock`, { decision: bad });
  assert.equal(lock.status, 422);
  assert.match(lock.json.error, /not an item in this case/);
  for (const shape of [{}, { roadmap: "x" }, { ...idle(), extra: 1 }, { ...idle(), reserve: { rel: "a", debt: 1 } }, { ...idle(), asks: { cash: 5 } }, { ...idle(), event: { evidence: "yes", reading: "x", direction: "y" } },
    { ...idle(), roadmap: Array.from({ length: 80 }, () => "x") }, { ...idle(), pace: 5 }, { ...idle(), reflection: { root_cause: "x" } }, [1], null]) {
    const r = await call("POST", `/api/runs/${run.ref}/lock`, { decision: shape });
    assert.equal(r.status, 400, `${JSON.stringify(shape).slice(0, 60)} gave ${r.status}`);
  }
  assert.equal(JSON.stringify((await call("GET", `/api/runs/${run.ref}`)).json), before);
  // a retention-only action does not exist on a venture run
  assert.equal((await call("POST", `/api/runs/${run.ref}/ask`, { ids: ["x"] })).status, 404);
  assert.equal((await call("POST", `/api/runs/${run.ref}/endgame`, { option: "x" })).status, 404);
});

test("the preview at the start of a game is the same for every player, whatever world they were dealt", async () => {
  const d = { ...idle(), roadmap: ["kyc_camera", "nudges"], dives: ["camera_share"] };
  const first = JSON.stringify((await call("POST", `/api/runs/${(await start(101)).ref}/preview`, { decision: d })).json);
  for (const seed of [102, 103, 104]) assert.equal(JSON.stringify((await call("POST", `/api/runs/${(await start(seed)).ref}/preview`, { decision: d })).json), first);
});

test("in the third quarter the player sees the signal and the options, and not which is right; the final report says", async () => {
  const run = await start(9);
  for (let q = 1; q <= 2; q++) await call("POST", `/api/runs/${run.ref}/lock`, { decision: idle() });
  const view = (await call("GET", `/api/runs/${run.ref}`)).json;
  assert.deepEqual(Object.keys(view.event).sort(), ["canCheck", "causes", "directions", "signal"]);
  assert.equal(view.event.causes.length, 3);
  const direct = replay(sc, 9, [idle(), idle()]);
  const right = direct.w.event;
  const lock = (await call("POST", `/api/runs/${run.ref}/lock`, { decision: { ...idle(), event: { evidence: true, reading: right.cause, direction: right.direction } } })).json;
  assert.equal(lock.report.event.name, right.name, "once the quarter is locked the event is named");
  assert.ok(!keysOf(lock).has("absorbed"), "how much was absorbed is for the review");
  await call("POST", `/api/runs/${run.ref}/lock`, { decision: { ...idle(), plan: sc.plans[0]!.id } });
  const rep = (await call("GET", `/api/runs/${run.ref}/final`)).json;
  assert.equal(rep.truth.event.name, right.name);
  assert.equal(rep.truth.event.readRight, true);
  assert.equal(rep.truth.event.answeredRight, true);
  assert.equal(rep.truth.event.checked, true);
});

test("rewinding replays the same world, costs one of two rewinds, and a third is refused", async () => {
  const run = await start(31);
  const first: any[] = [];
  const plan = [{ ...idle(), roadmap: ["kyc_camera"] }, { ...idle(), roadmap: ["nudges"], dives: ["fraud_mult"] }];
  for (const d of plan) first.push((await call("POST", `/api/runs/${run.ref}/lock`, { decision: d })).json);
  assert.equal((await call("POST", `/api/runs/${run.ref}/rewind`, { target: 9 })).status, 400);
  const back = (await call("POST", `/api/runs/${run.ref}/rewind`, { target: 2 })).json;
  assert.equal(back.quarter, 2);
  assert.equal(back.decisions, 1);
  assert.equal(back.rewinds.used, 1);
  assert.equal(back.learned.facts.length, 0, "what you learned in the quarter you rewound is gone");
  const again = (await call("POST", `/api/runs/${run.ref}/lock`, { decision: plan[1] })).json;
  assert.deepEqual(again.report, first[1].report, "the same world gives the same report");
  assert.equal((await call("POST", `/api/runs/${run.ref}/rewind`, { target: 1 })).json.rewinds.used, 2);
  assert.equal((await call("POST", `/api/runs/${run.ref}/rewind`, { target: 1 })).status, 409);
});

test("every venture case can be started and played a quarter over the API", async () => {
  for (const s of app.ventures) {
    const run = await start(5, s.id);
    assert.equal(run.scenarioId, s.id);
    const res = (await call("POST", `/api/runs/${run.ref}/lock`, { decision: { ...idle(), roadmap: [s.items.find((i) => !i.needs)!.id] } })).json;
    assert.equal(res.report.q, 1);
    assert.deepEqual(Object.keys(res.report.funnel), s.segments.map((x) => x.id));
  }
});
