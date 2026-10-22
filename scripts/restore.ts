// Restores a backup made by scripts/backup.ts into an EMPTY database, then checks row counts.
//
//   TURSO_DATABASE_URL=<new empty db> TURSO_AUTH_TOKEN=... npx tsx scripts/restore.ts backups/saahi-....jsonl.gz
//
// Refuses to write into a database that already has SAAHI tables, so it can't overwrite production
// by mistake. Restore into a new database, verify, then point the deployment at it (docs/OPERATIONS.md).
import fs from "node:fs";
import readline from "node:readline";
import zlib from "node:zlib";
import type * as DbModule from "../server/db";

type Line =
  | { kind: "header"; format: string }
  | { kind: "schema"; type: string; name: string; sql: string }
  | { kind: "row"; table: string; row: Record<string, unknown> }
  | { kind: "footer"; counts: Record<string, number> };

export async function restore(inFile: string): Promise<Record<string, number>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { db } = require("../server/db") as typeof DbModule;
  const c = db();
  const existing = (await c.execute(`select count(*) as n from sqlite_master where type = 'table' and name in ('users', 'alerts', 'schema_migrations')`)).rows[0] as unknown as { n: number };
  if (Number(existing.n) > 0) throw new Error("Target database is not empty. Restore into a new, empty database.");

  const rl = readline.createInterface({ input: fs.createReadStream(inFile).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const indexes: string[] = [];
  const counts: Record<string, number> = {};
  let expected: Record<string, number> | null = null;
  let pending: { sql: string; args: (string | number | null | Uint8Array)[] }[] = [];
  const flush = async () => {
    if (pending.length) await c.batch(pending, "write");
    pending = [];
  };
  let first = true;
  for await (const text of rl) {
    if (!text.trim()) continue;
    const l = JSON.parse(text) as Line;
    if (first) {
      if (l.kind !== "header" || l.format !== "saahi-backup-v1") throw new Error("Not a SAAHI backup file.");
      first = false;
      continue;
    }
    if (l.kind === "schema") {
      // Tables first; indexes after the data so unique indexes are checked once against the full set.
      if (l.type === "table") await c.execute(l.sql);
      else indexes.push(l.sql);
    } else if (l.kind === "row") {
      const cols = Object.keys(l.row);
      const args = cols.map((k) => {
        const v = l.row[k] as unknown;
        if (v && typeof v === "object" && "$b64" in (v as object)) return new Uint8Array(Buffer.from((v as { $b64: string }).$b64, "base64"));
        return v as string | number | null;
      });
      pending.push({ sql: `insert into "${l.table}" (${cols.map((k) => `"${k}"`).join(", ")}) values (${cols.map(() => "?").join(", ")})`, args });
      counts[l.table] = (counts[l.table] ?? 0) + 1;
      if (pending.length >= 100) await flush();
    } else if (l.kind === "footer") {
      expected = l.counts;
    }
  }
  await flush();
  for (const sql of indexes) await c.execute(sql);
  if (!expected) throw new Error("Backup file is truncated (no footer). Do not use this restore.");
  for (const [t, n] of Object.entries(expected)) {
    const got = Number(((await c.execute(`select count(*) as n from "${t}"`)).rows[0] as unknown as { n: number }).n);
    if (got !== n) throw new Error(`Row count mismatch in ${t}: backup has ${n}, restored ${got}.`);
  }
  return expected;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/restore.ts <backup.jsonl.gz>");
    process.exit(2);
  }
  restore(file)
    .then((counts) => console.log(JSON.stringify({ event: "restore_verified", file, counts })))
    .catch((e) => {
      console.error(String(e?.message ?? e));
      process.exit(1);
    });
}
