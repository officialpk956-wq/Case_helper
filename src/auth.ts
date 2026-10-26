// Accounts and sign-in for the local or single-instance hosted server.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";

const hashOf = promisify(scrypt);
const COOKIE = "pm_session";
const SESSION_S = 7 * 24 * 3600;
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const NAME = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

interface Account { salt: string; hash: string }
/** The user and the whole Set-Cookie value that signs the browser in as them. */
export interface SignedIn { user: string; cookie: string }

export function createAuth(file?: string, secure = false) {
  const saved = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const accounts = new Map<string, Account>(Object.entries(saved.accounts ?? saved));
  const sessions = new Map<string, { user: string; expires: number }>(Object.entries(saved.accounts ? saved.sessions ?? {} : {}));
  const fails = new Map<string, { n: number; until: number }>();

  const save = (): void => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ accounts: Object.fromEntries(accounts), sessions: Object.fromEntries(sessions) }), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (e) { rmSync(tmp, { force: true }); throw e; } // no half-written copy of the hashes left lying about
  };
  const derive = async (password: string, salt: Buffer): Promise<Buffer> => (await hashOf(password, salt, 64)) as Buffer;
  const name = (v: unknown): string | null => (typeof v === "string" && NAME.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);
  const word = (v: unknown): v is string => typeof v === "string" && v.length >= 8 && v.length <= 128;
  const cookieFor = (token: string, seconds: number): string => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
  const tokenOf = (header: string | undefined): string | undefined => header?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const open = (user: string): SignedIn => {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { user, expires: Date.now() + SESSION_S * 1000 });
    try { save(); } catch (e) { sessions.delete(token); throw e; }
    return { user, cookie: cookieFor(token, SESSION_S) };
  };

  return {
    async register(username: unknown, password: unknown): Promise<SignedIn> {
      const user = name(username);
      if (!user) throw new AuthError(400, "the username needs 3 to 32 letters, digits, dots, dashes or underscores");
      if (!word(password)) throw new AuthError(400, "the password needs 8 to 128 characters");
      const salt = randomBytes(16);
      const hash = await derive(password, salt);
      if (accounts.has(user)) throw new AuthError(409, "that username is taken");
      accounts.set(user, { salt: salt.toString("hex"), hash: hash.toString("hex") });
      // An account that could not be written down would vanish at the next restart, so it must not exist now either.
      try { save(); } catch (e) { accounts.delete(user); throw e; }
      return open(user);
    },

    async login(username: unknown, password: unknown): Promise<SignedIn> {
      const user = name(username), account = user ? accounts.get(user) : undefined;
      // Only real accounts are counted, so the table cannot grow with made-up names.
      if (user && account) {
        let failed = fails.get(user);
        if (failed && failed.until && failed.until <= Date.now()) { fails.delete(user); failed = undefined; } // the lock has run out: count afresh
        if (failed?.until) throw new AuthError(429, "too many wrong passwords; wait a minute and try again");
        // The try is counted before the slow hash, so a burst of tries at once cannot all slip under the limit. A right password clears it.
        const n = (failed?.n ?? 0) + 1;
        fails.set(user, { n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
      }
      const right = account !== undefined && word(password) && timingSafeEqual(await derive(password, Buffer.from(account.salt, "hex")), Buffer.from(account.hash, "hex"));
      if (!right) throw new AuthError(401, "wrong username or password");
      fails.delete(user!);
      return open(user!);
    },

    /** The signed-in user a Cookie header stands for, or null. */
    userOf(header: string | undefined): string | null {
      const token = tokenOf(header), s = token ? sessions.get(token) : undefined;
      if (!s) return null;
      if (s.expires < Date.now()) { sessions.delete(token!); save(); return null; }
      return s.user;
    },

    /** Ends the session and returns the Set-Cookie value that clears the browser's copy. */
    logout(header: string | undefined): string {
      const token = tokenOf(header);
      if (token) { sessions.delete(token); save(); }
      return cookieFor("", 0);
    },
    deleteAccount(header: string | undefined): string {
      const user = this.userOf(header);
      if (!user) throw new AuthError(401, "sign in first");
      accounts.delete(user);
      for (const [token, session] of sessions) if (session.user === user) sessions.delete(token);
      save();
      return cookieFor("", 0);
    },
  };
}
