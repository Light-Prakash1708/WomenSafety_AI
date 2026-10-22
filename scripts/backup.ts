// Logical backup of the SAAHI database to one gzipped JSON-lines file.
// Complements Turso's own point-in-time restore; see docs/OPERATIONS.md.
//
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx scripts/backup.ts backups/saahi-2026-10-22.jsonl.gz
//
// The file contains personal data (contacts, locations, evidence). Store it encrypted, with access
// limited to the people on the incident rota, and delete it on the retention schedule.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type * as DbModule from "../server/db";

export async function backup(outFile: string): Promise<Record<string, number>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { db } = require("../server/db") as typeof DbModule;
  const c = db();
  const objects = (await c.execute(`select type, name, tbl_name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 else 1 end, name`)).rows as unknown as {
    type: string;
    name: string;
    sql: string;
  }[];
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  const gz = zlib.createGzip();
  const out = fs.createWriteStream(outFile, { mode: 0o600 });
  gz.pipe(out);
  const write = (o: unknown) => gz.write(JSON.stringify(o) + "\n");
  write({ kind: "header", format: "saahi-backup-v1", at: new Date().toISOString() });
  for (const o of objects) write({ kind: "schema", type: o.type, name: o.name, sql: o.sql });
  // Parents before children, so a restore satisfies foreign keys row by row.
  const tables = objects.filter((o) => o.type === "table").map((o) => o.name);
  const deps = new Map<string, string[]>();
  for (const name of tables) {
    const fks = (await c.execute(`pragma foreign_key_list("${name}")`)).rows as unknown as { table: string }[];
    deps.set(name, fks.map((f) => f.table).filter((p) => p !== name && tables.includes(p)));
  }
  const ordered: string[] = [];
  const visit = (n: string, seen: Set<string>) => {
    if (ordered.includes(n) || seen.has(n)) return;
    seen.add(n);
    for (const p of deps.get(n) ?? []) visit(p, seen);
    ordered.push(n);
  };
  for (const n of tables) visit(n, new Set());

  const counts: Record<string, number> = {};
  for (const t of ordered.map((name) => ({ name }))) {
    counts[t.name] = 0;
    // rowid paging keeps memory flat for large vault tables.
    let last = -1;
    for (;;) {
      const rows = (await c.execute({ sql: `select rowid as __rowid, * from "${t.name}" where rowid > ? order by rowid limit 200`, args: [last] })).rows;
      if (!rows.length) break;
      for (const r of rows) {
        const row: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (k === "__rowid") continue;
          row[k] = v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? { $b64: Buffer.from(v as ArrayBuffer).toString("base64") } : typeof v === "bigint" ? Number(v) : v;
        }
        write({ kind: "row", table: t.name, row });
        counts[t.name]++;
      }
      last = Number((rows[rows.length - 1] as unknown as { __rowid: number }).__rowid);
    }
  }
  write({ kind: "footer", counts });
  await new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
    gz.end();
  });
  return counts;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npx tsx scripts/backup.ts <output.jsonl.gz>");
    process.exit(2);
  }
  backup(file)
    .then((counts) => console.log(JSON.stringify({ event: "backup_complete", file, counts })))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
