import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import { createApp } from "../src/server.ts";

test("hosted origin, durable sessions and both run types across a cold restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-public-"));
  const opts = { usersFile: join(dir, "users.json"), runsFile: join(dir, "runs.json"), publicOrigin: "https://public.example", contactEmail: "owner@example.com" };
  let app = createApp(opts);
  const start = async () => {
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  };
  let base = await start();
  const call = (method: string, path: string, body?: unknown, cookie?: string, origin = "https://public.example"): Promise<{ status: number; json: any; cookie: string | null }> => new Promise((resolve, reject) => {
    const target = new URL(base);
    const req = request({ hostname: target.hostname, port: target.port, path, method, headers: { Host: "public.example", Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => { let json: any = null; try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch {} resolve({ status: res.statusCode!, json, cookie: res.headers["set-cookie"]?.[0] ?? null }); });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    assert.equal((await call("GET", "/api/auth/me", undefined, undefined, "https://evil.example")).status, 403);
    const signup = await call("POST", "/api/auth/register", { username: "public.user", password: "long unique password" });
    assert.equal(signup.status, 200);
    assert.match(signup.cookie!, /; Secure$/);
    const cookie = signup.cookie!.split(";")[0]!;
    const other = (await call("POST", "/api/auth/register", { username: "other.user", password: "other password" })).cookie!.split(";")[0]!;
    const retention = await call("POST", "/api/runs", { scenario: "retention_after_the_search", seed: 13 }, cookie);
    const venture = await call("POST", "/api/runs", { scenario: "marigold_leaky_funnel", seed: 42 }, cookie);
    assert.equal(retention.status, 200);
    assert.equal(venture.status, 200);
    const ref1 = retention.json.ref, ref2 = venture.json.ref;
    assert.equal((await call("POST", `/api/runs/${ref2}/lock`, { decision: { roadmap: [], reserve: { rel: 0.05, debt: 0.05 }, pace: "steady", research: 0.5, instrument: 0.5 } }, cookie)).status, 200);
    const before = await call("GET", `/api/runs/${ref2}`, undefined, cookie);
    assert.equal((await call("GET", `/api/runs/${ref1}`, undefined, other)).status, 404);
    assert.ok(readFileSync(opts.runsFile, "utf8").includes("marigold_leaky_funnel"));
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app = createApp(opts);
    base = await start();
    assert.equal((await call("GET", "/api/auth/me", undefined, cookie)).json.user, "public.user");
    assert.equal((await call("GET", `/api/runs/${ref1}`, undefined, cookie)).status, 200);
    assert.deepEqual((await call("GET", `/api/runs/${ref2}`, undefined, cookie)).json, before.json);
    assert.equal((await call("GET", `/api/runs/${ref2}`, undefined, other)).status, 404);
    const idle = { roadmap: [], reserve: { rel: 0.05, debt: 0.05 }, pace: "steady", research: 0.5, instrument: 0.5 };
    for (let q = 2; q <= 4; q++) assert.equal((await call("POST", `/api/runs/${ref2}/lock`, { decision: idle }, cookie)).status, 200);
    const final = await call("GET", `/api/runs/${ref2}/final`, undefined, cookie);
    assert.equal(final.status, 200);
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app = createApp(opts);
    base = await start();
    assert.deepEqual((await call("GET", `/api/runs/${ref2}/final`, undefined, cookie)).json, final.json);
    assert.equal((await call("POST", "/api/auth/delete", {}, cookie)).status, 200);
    assert.equal((await call("GET", "/api/auth/me", undefined, cookie)).status, 401);
    assert.equal((await call("GET", `/api/runs/${ref1}`, undefined, other)).status, 404);
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
