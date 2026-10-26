import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";
import { signIn } from "./signin.ts";

// Faults found by a dry run of the whole app. Each test fails against the code as it was when the fault was found.
const dir = mkdtempSync(join(tmpdir(), "pm-sim-hardening-"));
after(() => rmSync(dir, { recursive: true, force: true }));

async function serve(usersFile?: string): Promise<{ base: string }> {
  const app = createApp({ usersFile });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  after(() => app.server.close());
  return { base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` };
}
const send = (base: string, method: string, path: string, body?: unknown, cookie?: string, type = "application/json"): Promise<Response> =>
  fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": type } : {}) }, body: typeof body === "string" ? body : body !== undefined ? JSON.stringify(body) : undefined });
const PASSWORD = "correct horse battery";
const idle = { roadmap: [], reserve: { rel: 0.05, debt: 0.05 }, pace: "steady", research: 0.5, instrument: 0.5 };

const { base } = await serve();
const cookie = await signIn(base);
const start = async (scenario: string, seed = 1): Promise<any> => (await send(base, "POST", "/api/runs", { scenario, seed }, cookie)).json();

test("a drop that names no running lever is refused, and a preview cannot write to the objects every run shares", async () => {
  const run = await start("retention_after_the_search", 3);
  for (const id of ["__proto__", "constructor", "toString"]) {
    const pre = await (await send(base, "POST", `/api/runs/${run.ref}/preview`, { decision: { drop: [id] } }, cookie)).json();
    assert.equal(pre.ok, false, id);
    assert.match(pre.error, /it is not running/, id);
  }
  assert.equal(({} as any).dropped, undefined, "Object.prototype was written to");
});

test("a retention preview that starts a lever that does not exist says so, with the locks it can still work out", async () => {
  const run = await start("retention_after_the_search", 2);
  for (const start of [["not_a_lever"], ["__proto__"], ["instrumentation_v1", "not_a_lever"]]) {
    const res = await send(base, "POST", `/api/runs/${run.ref}/preview`, { decision: { start } }, cookie);
    assert.equal(res.status, 200, start.join());
    const pre = await res.json();
    assert.equal(pre.ok, false, start.join());
    assert.match(pre.error, /unknown lever/, start.join());
    assert.equal(typeof pre.locks, "object", start.join());
  }
});

test("a promise that names no item is refused with a reason, and the wording of a refusal follows the case", async () => {
  const run = await start("marigold_leaky_funnel");
  for (const id of ["not_an_item", "__proto__"]) {
    const res = await send(base, "POST", `/api/runs/${run.ref}/preview`, { decision: { ...idle, commit: [id] } }, cookie);
    assert.equal(res.status, 200, id);
    const pre = await res.json();
    assert.equal(pre.ok, false, id);
    assert.match(pre.error, /the promises names/, id);
  }
  const ceo = await start("harbour_loom_eighteen_months");
  const split = { decision: { ...idle, research: -0.01 } };
  assert.match((await (await send(base, "POST", `/api/runs/${ceo.ref}/preview`, split, cookie)).json()).error, /merchandising and analytics/);
  assert.match((await (await send(base, "POST", `/api/runs/${run.ref}/preview`, split, cookie)).json()).error, /design and analyst/);
});

test("a body one byte over the limit gets its 413, and only application/json itself passes the JSON guard", async () => {
  const padded = (bytes: number): string => `${" ".repeat(bytes - 2)}{}`;
  assert.equal((await send(base, "POST", "/api/auth/logout", padded(64 * 1024))).status, 200);
  assert.equal((await send(base, "POST", "/api/auth/logout", padded(64 * 1024 + 1))).status, 413);
  for (const type of ["application/json; charset=utf-8", "Application/JSON"]) assert.equal((await send(base, "POST", "/api/auth/logout", "{}", undefined, type)).status, 200, type);
  for (const type of ["application/jsonx", "text/plain", "application/json-seq"]) assert.equal((await send(base, "POST", "/api/auth/logout", "{}", undefined, type)).status, 415, type);
});

test("a server started a moment after another hands out run numbers the first never used", async () => {
  const newRun = async (b: string, c: string): Promise<number> => (await (await send(b, "POST", "/api/runs", { scenario: "retention_after_the_search", seed: 1 }, c)).json()).ref;
  const first = await serve(), firstCookie = await signIn(first.base);
  const before = new Set<number>();
  for (let i = 0; i < 20; i++) before.add(await newRun(first.base, firstCookie));
  const second = await serve();
  const again = await newRun(second.base, await signIn(second.base));
  assert.ok(!before.has(again), `run ${again} was already in use before the restart`);
});

test("five wrong passwords sent at once still lock the name", async () => {
  const { base: b } = await serve(join(dir, "burst.json"));
  await send(b, "POST", "/api/auth/register", { username: "burst.one", password: PASSWORD });
  const wrong = await Promise.all(Array.from({ length: 5 }, () => send(b, "POST", "/api/auth/login", { username: "burst.one", password: "not the password" })));
  assert.deepEqual(wrong.map((r) => r.status), [401, 401, 401, 401, 401]);
  assert.equal((await send(b, "POST", "/api/auth/login", { username: "burst.one", password: PASSWORD })).status, 429);
});

test("an account that could not be written down does not exist afterwards either", async () => {
  const blocker = join(dir, "not-a-folder");
  writeFileSync(blocker, "a file where the accounts folder should be");
  const { base: b } = await serve(join(blocker, "users.json"));
  const quiet = console.error;
  console.error = () => {}; // the server logs the failure it is about to answer with a 500
  try { assert.equal((await send(b, "POST", "/api/auth/register", { username: "unsaved", password: PASSWORD })).status, 500); } finally { console.error = quiet; }
  assert.equal((await send(b, "POST", "/api/auth/login", { username: "unsaved", password: PASSWORD })).status, 401);
});

test("a save that fails at its last step leaves no copy of the account hashes behind", async () => {
  const file = join(dir, "late.json");
  const { base: b } = await serve(file);
  mkdirSync(file); // the accounts file turns into a folder after the server has started, so the final rename cannot succeed
  const quiet = console.error;
  console.error = () => {};
  try { assert.equal((await send(b, "POST", "/api/auth/register", { username: "late.one", password: PASSWORD })).status, 500); } finally { console.error = quiet; }
  assert.equal(existsSync(`${file}.tmp`), false);
  assert.equal((await send(b, "POST", "/api/auth/login", { username: "late.one", password: PASSWORD })).status, 401);
});

test("invalid experiment policies are rejected without advancing either retention case", async () => {
  for (const [scenario, lever, segment] of [["retention_after_the_search", "notification_policy", "active_applicants"], ["learning_in_the_middle", "reminder_policy", "deadline_driven"]]) {
    const run = await start(scenario!);
    const experiment = { lever, segment, samplePct: 25, weeks: 4, volume: 3, targeting: "rules" };
    const path = `/api/runs/${run.ref}`;
    const before = await (await send(base, "GET", path, undefined, cookie)).json();
    for (const variant of [{ volume: -1 }, { volume: 1e308 }, { targeting: "unknown" }, { targeting: "__proto__" }, { targeting: "constructor" }]) {
      const body = { decision: { experiments: [{ ...experiment, ...variant }] } };
      const preview = await (await send(base, "POST", path + "/preview", body, cookie)).json();
      assert.equal(preview.ok, false, JSON.stringify(variant));
      assert.equal((await send(base, "POST", path + "/lock", body, cookie)).status, 422);
      assert.deepEqual(await (await send(base, "GET", path, undefined, cookie)).json(), before);
    }
    assert.equal((await send(base, "POST", path + "/lock", { decision: { experiments: [{ ...experiment, stoppedEarly: "true" }] } }, cookie)).status, 400);
    assert.equal((await send(base, "POST", path + "/lock", { decision: { experiments: [experiment] } }, cookie)).status, 200);
  }
});

test("duplicate content types are refused in either order", async () => {
  const { request } = await import("node:http");
  for (const values of [["application/json", "text/plain"], ["text/plain", "application/json"], ["application/json", "application/json"]]) {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(base + "/api/auth/logout", { method: "POST", headers: { "Content-Type": values } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject); req.end("{}");
    });
    assert.equal(status, 415, values.join(", "));
  }
});
