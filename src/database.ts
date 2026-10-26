// A single-process durable snapshot for the free hosted build. Postgres owns the state;
// local files are working copies and are repopulated from Postgres on every boot.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

export interface QueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export async function openDatabase(usersFile: string, runsFile: string, connectionString?: string, client?: QueryClient) {
  const pool = client ? null : new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000 });
  const db = client ?? pool!;
  try {
    await db.query("CREATE TABLE IF NOT EXISTS pm_sim_state (id integer PRIMARY KEY, users jsonb NOT NULL, runs jsonb NOT NULL)");
    await db.query("INSERT INTO pm_sim_state (id, users, runs) VALUES (1, '{}'::jsonb, '{\"version\":1,\"runs\":[]}'::jsonb) ON CONFLICT (id) DO NOTHING");
    const row = (await db.query("SELECT users, runs FROM pm_sim_state WHERE id = 1")).rows[0];
    if (!row) throw new Error("database state row is missing");
    // The files are under /tmp on Render Free. Never treat an older ephemeral copy as authoritative.
    writeFileSync(usersFile, JSON.stringify(row.users), { mode: 0o600 });
    writeFileSync(runsFile, JSON.stringify(row.runs), { mode: 0o600 });
    const persist = async (): Promise<void> => {
      const users = existsSync(usersFile) ? readFileSync(usersFile, "utf8") : "{}";
      const runs = existsSync(runsFile) ? readFileSync(runsFile, "utf8") : '{"version":1,"runs":[]}';
      const result = await db.query("UPDATE pm_sim_state SET users = $1::jsonb, runs = $2::jsonb WHERE id = 1 RETURNING id", [users, runs]);
      if (result.rows.length !== 1) throw new Error("database state row was not updated");
    };
    return { persist, close: async () => { if (pool) await pool.end(); } };
  } catch (e) { if (pool) await pool.end(); throw e; }
}
