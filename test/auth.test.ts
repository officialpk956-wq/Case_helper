import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";

const dir = mkdtempSync(join(tmpdir(), "pm-sim-auth-"));
const file = join(dir, "users.json");
after(() => rmSync(dir, { recursive: true, force: true }));

async function serve(): Promise<{ base: string; stop: () => void }> {
  const app = createApp({ usersFile: file });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  after(() => app.server.close());
  return { base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, stop: () => app.server.close() };
}
const { base } = await serve();

async function call(method: string, path: string, body?: unknown, cookie?: string): Promise<{ status: number; json: any; cookie: string | null }> {
  const res = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.getSetCookie()[0] ?? null;
  return { status: res.status, json: await res.json().catch(() => null), cookie: set };
}
const PASSWORD = "correct horse battery";
const crumb = (setCookie: string | null): string => setCookie!.split(";")[0]!;

test("nothing but the sign-in routes and the page files is open without an account", async () => {
  assert.equal((await call("GET", "/api/cases")).status, 401);
  assert.equal((await call("POST", "/api/runs", { scenario: "marigold_leaky_funnel" })).status, 401);
  assert.equal((await call("GET", "/api/auth/me")).status, 401);
  assert.equal((await call("GET", "/api/cases", undefined, "pm_session=not-a-real-token")).status, 401, "a made-up session is no session");
  for (const page of ["/", "/login.html", "/login.js", "/legal.html", "/legal.js", "/style.css"]) assert.equal((await fetch(base + page)).status, 200, page);
});

test("creating an account checks the username and password, signs you in, and sets a cookie scripts cannot read", async () => {
  for (const username of ["ab", "has space", "UPPER!", "", 7, null]) assert.equal((await call("POST", "/api/auth/register", { username, password: PASSWORD })).status, 400, String(username));
  for (const password of ["short", "x".repeat(129), 12345678, undefined]) assert.equal((await call("POST", "/api/auth/register", { username: "someone", password })).status, 400, String(password));
  const made = await call("POST", "/api/auth/register", { username: "  Asha.K  ", password: PASSWORD });
  assert.equal(made.status, 200);
  assert.equal(made.json.user, "asha.k", "names are trimmed and lower-cased");
  assert.match(made.cookie!, /^pm_session=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\//);
  assert.equal((await call("GET", "/api/auth/me", undefined, crumb(made.cookie))).json.user, "asha.k");
  assert.equal((await call("POST", "/api/auth/register", { username: "ASHA.k", password: PASSWORD })).status, 409, "a taken name is taken whatever its case");
});

test("signing in fails the same way for a wrong password and an unknown name, and too many wrong passwords lock the name for a minute", async () => {
  await call("POST", "/api/auth/register", { username: "lockme", password: PASSWORD });
  const wrong = await call("POST", "/api/auth/login", { username: "lockme", password: "not the password" });
  const nobody = await call("POST", "/api/auth/login", { username: "nobody.here", password: "not the password" });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, nobody.json);
  assert.equal(wrong.cookie, null);
  for (let i = 0; i < 4; i++) assert.equal((await call("POST", "/api/auth/login", { username: "lockme", password: "still wrong" })).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { username: "lockme", password: PASSWORD })).status, 429, "locked even for the right password");
  assert.equal((await call("POST", "/api/auth/login", { username: "asha.k", password: PASSWORD })).status, 200, "other accounts are not affected");
  assert.equal((await call("POST", "/api/auth/login", { username: "ASHA.K", password: PASSWORD })).status, 200, "sign-in ignores case");
});

test("a run belongs to the account that started it, and signing out ends the session", async () => {
  const a = crumb((await call("POST", "/api/auth/register", { username: "owner.a", password: PASSWORD })).cookie);
  const b = crumb((await call("POST", "/api/auth/register", { username: "owner.b", password: PASSWORD })).cookie);
  const run = (await call("POST", "/api/runs", { scenario: "marigold_leaky_funnel", seed: 5 }, a)).json;
  assert.equal((await call("GET", `/api/runs/${run.ref}`, undefined, a)).status, 200);
  for (const action of ["", "/final", "/preview", "/lock", "/rewind"]) {
    const res = await call(action === "" || action === "/final" ? "GET" : "POST", `/api/runs/${run.ref}${action}`, action === "" || action === "/final" ? undefined : { decision: {}, target: 1 }, b);
    assert.equal(res.status, 404, `${action || "view"}: someone else's run is the same 404 as a missing one`);
  }
  const out = await call("POST", "/api/auth/logout", {}, a);
  assert.equal(out.status, 200);
  assert.match(out.cookie!, /Max-Age=0/);
  assert.equal((await call("GET", `/api/runs/${run.ref}`, undefined, a)).status, 401, "the old cookie is dead on the server, not just in the browser");
});

test("accounts and sessions survive a restart without storing passwords", async () => {
  const text = readFileSync(file, "utf8");
  const saved = JSON.parse(text);
  assert.ok(saved.accounts["asha.k"] && saved.accounts["owner.a"] && saved.accounts["lockme"]);
  assert.ok(!text.includes(PASSWORD), "the password is not in the file");
  for (const account of Object.values<any>(saved.accounts)) assert.deepEqual(Object.keys(account).sort(), ["hash", "salt"]);
  assert.notEqual(saved.accounts["asha.k"].hash, saved.accounts["owner.a"].hash, "the same password hashes differently for two accounts");
  const second = await serve();
  const res = await fetch(second.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "owner.b", password: PASSWORD }) });
  assert.equal(res.status, 200);
  second.stop();
});
