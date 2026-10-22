// Restore drill: back up a database with real-shaped synthetic data, restore it into an empty one,
// and prove nothing was lost (including evidence bytes). Also proves the safety refusals.
// Run: node tests/backup-drill.test.mjs
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createClient } from "@libsql/client";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saahi-drill-"));
const src = path.join(dir, "source.db");
const dst = path.join(dir, "restored.db");
const file = path.join(dir, "backup.jsonl.gz");
const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  -> " + detail : ""}`); };
const runTs = (script, dbFile, ...args) =>
  spawnSync(process.execPath, [tsx, script, ...args], { env: { ...process.env, TURSO_DATABASE_URL: `file:${dbFile}` }, encoding: "utf8" });

// Source database at the latest schema, via the real migration code.
const m = spawnSync(process.execPath, [tsx, "tests/migration.test.ts", "child"], { env: { ...process.env, TURSO_DATABASE_URL: `file:${src}` }, encoding: "utf8" });
check("source database created by migrations", m.status === 0, m.stderr);
const s = createClient({ url: `file:${src}` });
const blob = crypto.randomBytes(300_000);
const t = new Date().toISOString();
await s.batch([
  { sql: `insert into users (id, email, password_hash, recovery_hash, created_at) values ('u1', 'drill@example.test', 'h', 'r', ?)`, args: [t] },
  { sql: `insert into profiles (id, display_name, updated_at) values ('u1', 'Drill D', ?)`, args: [t] },
  { sql: `insert into alerts (id, owner_id, status, trigger, public_token, client_ref, started_at) values ('a1', 'u1', 'active', 'hold', ?, 'drill-ref-0001', ?)`, args: ["d".repeat(36), t] },
  ...Array.from({ length: 450 }, (_, i) => ({ sql: `insert into alert_locations (alert_id, lat, lng, recorded_at) values ('a1', ?, ?, ?)`, args: [22.5 + i / 1e4, 88.3, t] })),
  { sql: `insert into vault_items (id, owner_id, kind, label, sha256, size_bytes, mime, chunks, complete, captured_at, created_at) values ('v1', 'u1', 'photo', 'x', ?, ?, 'image/jpeg', 1, 1, ?, ?)`, args: [crypto.createHash("sha256").update(blob).digest("hex"), blob.length, t, t] },
  { sql: `insert into vault_chunks (item_id, idx, data) values ('v1', 0, ?)`, args: [new Uint8Array(blob)] },
  { sql: `insert into audit_log (owner_id, actor_id, action, at) values ('u1', 'u1', 'alert.created', ?)`, args: [t] },
]);

const b = runTs("scripts/backup.ts", src, file);
check("backup completes", b.status === 0, b.stderr);
check("backup file is only readable by its owner", (fs.statSync(file).mode & 0o077) === 0, (fs.statSync(file).mode & 0o777).toString(8));
const r = runTs("scripts/restore.ts", dst, file);
check("restore completes and verifies row counts", r.status === 0 && /restore_verified/.test(r.stdout), r.stderr || r.stdout);

const d = createClient({ url: `file:${dst}` });
const count = async (c, tbl) => Number((await c.execute(`select count(*) as n from ${tbl}`)).rows[0].n);
for (const tbl of ["users", "profiles", "alerts", "alert_locations", "vault_items", "vault_chunks", "audit_log", "schema_migrations"]) {
  check(`${tbl}: same row count`, (await count(s, tbl)) === (await count(d, tbl)));
}
const restoredBlob = Buffer.from((await d.execute(`select data from vault_chunks where item_id = 'v1'`)).rows[0].data);
check("evidence bytes are identical after restore", restoredBlob.equals(blob));
let uniqueHeld = false;
try {
  await d.execute(`insert into alerts (id, owner_id, status, trigger, public_token, started_at) values ('a2', 'u1', 'active', 'hold', '${"e".repeat(36)}', '${t}')`);
} catch {
  uniqueHeld = true;
}
check("safety indexes are restored (still one active alert per person)", uniqueHeld);

const again = runTs("scripts/restore.ts", dst, file);
check("restore refuses to write into a database that isn't empty", again.status !== 0 && /not empty/.test(again.stderr), again.stderr);
const lines = zlib.gunzipSync(fs.readFileSync(file)).toString().trim().split("\n");
const cut = path.join(dir, "truncated.jsonl.gz");
fs.writeFileSync(cut, zlib.gzipSync(lines.slice(0, -1).join("\n") + "\n"));
const tr = runTs("scripts/restore.ts", path.join(dir, "empty2.db"), cut);
check("a truncated backup is detected and rejected", tr.status !== 0 && /truncated/.test(tr.stderr), tr.stderr);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
