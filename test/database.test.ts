import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { newDb } from "pg-mem";
import { openDatabase } from "../src/database.ts";
import { createApp } from "../src/server.ts";

test("database restores accounts, sessions, decisions and a final report after ephemeral files disappear", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-db-"));
  const usersFile = join(dir, "users.json"), runsFile = join(dir, "runs.json");
  const adapter = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  const pool = new adapter.Pool();
  let store = await openDatabase(usersFile, runsFile, undefined, pool);
  let app = createApp({ usersFile, runsFile, persist: store.persist });
  const start = async () => {
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  };
  let base = await start();
  const call = async (method: string, path: string, body?: unknown, cookie?: string) => {
    const res = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null), cookie: res.headers.get("set-cookie") };
  };
  try {
    const signup = await call("POST", "/api/auth/register", { username: "db.user", password: "long unique password" });
    assert.equal(signup.status, 200);
    const cookie = signup.cookie!.split(";")[0]!;
    const started = await call("POST", "/api/runs", { scenario: "marigold_leaky_funnel", seed: 42 }, cookie);
    assert.equal(started.status, 200);
    const ref = started.json.ref;
    const idle = { roadmap: [], reserve: { rel: 0.05, debt: 0.05 }, pace: "steady", research: 0.5, instrument: 0.5 };
    for (let q = 0; q < 4; q++) assert.equal((await call("POST", `/api/runs/${ref}/lock`, { decision: idle }, cookie)).status, 200);
    const final = await call("GET", `/api/runs/${ref}/final`, undefined, cookie);
    assert.equal(final.status, 200);
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    rmSync(usersFile); rmSync(runsFile);
    store = await openDatabase(usersFile, runsFile, undefined, pool);
    app = createApp({ usersFile, runsFile, persist: store.persist });
    base = await start();
    assert.equal((await call("GET", "/api/auth/me", undefined, cookie)).json.user, "db.user");
    assert.deepEqual((await call("GET", `/api/runs/${ref}/final`, undefined, cookie)).json, final.json);
    assert.equal((await call("POST", "/api/auth/delete", {}, cookie)).status, 200);
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    rmSync(usersFile); rmSync(runsFile);
    store = await openDatabase(usersFile, runsFile, undefined, pool);
    app = createApp({ usersFile, runsFile, persist: store.persist });
    base = await start();
    assert.equal((await call("GET", "/api/auth/me", undefined, cookie)).status, 401);
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed database write does not create an account or leave an unresumable run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-db-fail-"));
  const usersFile = join(dir, "users.json"), runsFile = join(dir, "runs.json");
  const adapter = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  const pool = new adapter.Pool();
  const store = await openDatabase(usersFile, runsFile, undefined, pool);
  let failing = true;
  const app = createApp({ usersFile, runsFile, persist: async () => { if (failing) throw new Error("database unavailable"); await store.persist(); } });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const call = async (path: string, body: unknown, cookie?: string) => {
    const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json(), cookie: res.headers.get("set-cookie") };
  };
  try {
    assert.equal((await call("/api/auth/register", { username: "retry.user", password: "long unique password" })).status, 500);
    failing = false;
    const made = await call("/api/auth/register", { username: "retry.user", password: "long unique password" });
    assert.equal(made.status, 200, "a failed registration was rolled back");
    const cookie = made.cookie!.split(";")[0]!;
    failing = true;
    assert.equal((await call("/api/runs", { scenario: "marigold_leaky_funnel", seed: 42 }, cookie)).status, 500);
    assert.equal(app.sessions.size, 0, "a failed run save was rolled back");
    failing = false;
    assert.equal((await call("/api/runs", { scenario: "marigold_leaky_funnel", seed: 42 }, cookie)).status, 200);
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  }
});
