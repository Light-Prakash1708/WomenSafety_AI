// Upgrade test: a database in the shape production had before versioned migrations (v1, no
// schema_migrations table) with legacy rows, upgraded by two server instances starting at once.
// Run: npx tsx tests/migration.test.ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mode = process.argv[2];

async function main() {

  if (mode === "child") {
    // One cold-starting server instance.
    const { migrate } = await import("../server/db");
    await migrate();
    process.exit(0);
  }
  
  const { createClient } = await import("@libsql/client");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "saahi-mig-")), "v1.db");
  process.env.TURSO_DATABASE_URL = `file:${file}`;
  const raw = createClient({ url: `file:${file}` });
  const { MIGRATIONS, LATEST_VERSION } = await import("../server/db");
  
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  -> " + detail : ""}`);
  };
  const q = async (sql: string, args: (string | number | null)[] = []) => (await raw.execute({ sql, args })).rows as unknown as Record<string, any>[];
  
  // 1. The v1 schema exactly as the first release created it, plus synthetic legacy data.
  for (const s of MIGRATIONS[0].steps) await raw.execute(s as string);
  const t = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();
  await raw.batch([
    { sql: `insert into users (id, email, password_hash, recovery_hash, created_at) values ('u1', 'legacy@example.test', 'x', 'y', ?)`, args: [t(500)] },
    { sql: `insert into profiles (id, display_name, updated_at) values ('u1', 'Legacy L', ?)`, args: [t(500)] },
    { sql: `insert into contacts (id, owner_id, name, phone, priority, invite_code, created_at) values ('c1', 'u1', 'Unlinked', '+919800000010', 1, 'AAAABBBB', ?)`, args: [t(400)] },
    { sql: `insert into contacts (id, owner_id, name, phone, priority, invite_code, linked_user_id, created_at) values ('c2', 'u1', 'Linked', '+919800000011', 2, 'CCCCDDDD', 'u1', ?)`, args: [t(400)] },
    // Two active alerts for one person: the old code allowed this.
    { sql: `insert into alerts (id, owner_id, status, trigger, public_token, started_at) values ('a-old', 'u1', 'active', 'hold', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ?)`, args: [t(60)] },
    { sql: `insert into alerts (id, owner_id, status, trigger, public_token, started_at) values ('a-new', 'u1', 'active', 'hold', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', ?)`, args: [t(30)] },
    { sql: `insert into alert_recipients (id, alert_id, contact_id, name, channel, status, updated_at) values ('r1', 'a-new', 'c1', 'Unlinked', 'sms', 'sent', ?)`, args: [t(30)] },
    { sql: `insert into alert_recipients (id, alert_id, contact_id, name, channel, status, updated_at) values ('r2', 'a-new', 'c2', 'Linked', 'push', 'sent', ?)`, args: [t(30)] },
    { sql: `insert into alert_recipients (id, alert_id, contact_id, name, channel, status, updated_at) values ('r3', 'a-old', 'c2', 'Linked', 'sms', 'opened', ?)`, args: [t(60)] },
  ]);
  const before = { users: (await q(`select count(*) as n from users`))[0].n, recipients: (await q(`select count(*) as n from alert_recipients`))[0].n };
  
  // 2. Two instances cold-start against it at the same moment.
  const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
  const runChild = () =>
    new Promise<number>((resolve) => {
      const p = spawn(process.execPath, [tsx, "tests/migration.test.ts", "child"], { env: { ...process.env }, stdio: ["ignore", "ignore", "inherit"] });
      p.on("exit", (code) => resolve(code ?? 1));
    });
  const codes = await Promise.all([runChild(), runChild()]);
  check("two instances migrating at once both succeed", codes.every((c) => c === 0), codes.join(","));
  
  // 3. The upgraded database.
  const versions = (await q(`select version from schema_migrations order by version`)).map((r) => Number(r.version));
  check("every migration recorded exactly once", versions.join(",") === MIGRATIONS.map((m) => m.version).join(","), versions.join(","));
  check("schema is at the latest version", Math.max(...versions) === LATEST_VERSION);
  check("no rows lost", (await q(`select count(*) as n from users`))[0].n === before.users && (await q(`select count(*) as n from alert_recipients`))[0].n === before.recipients);
  const alerts = Object.fromEntries((await q(`select id, status, end_reason from alerts`)).map((r) => [r.id, r]));
  check("duplicate active alerts: newest kept active", alerts["a-new"].status === "active");
  check("duplicate active alerts: older one closed as superseded, not deleted", alerts["a-old"].status === "resolved" && alerts["a-old"].end_reason === "superseded");
  const rs = Object.fromEntries((await q(`select id, status, attempts from alert_recipients`)).map((r) => [r.id, r]));
  check("old SMS 'sent' becomes 'opened in her Messages app' (it was never confirmed)", rs.r1.status === "device_compose");
  check("old push 'sent' becomes 'accepted by provider'", rs.r2.status === "provider_accepted");
  check("old 'opened' becomes 'link_opened'", rs.r3.status === "link_opened");
  check("new attempts column defaults to 0 on old rows", Number(rs.r1.attempts) === 0);
  const cs = Object.fromEntries((await q(`select id, invite_expires_at, linked_at from contacts`)).map((r) => [r.id, r]));
  check("unlinked old invites get a 7-day expiry", Boolean(cs.c1.invite_expires_at) && +new Date(cs.c1.invite_expires_at) > Date.now() + 6 * 86400e3);
  check("linked guardians keep working and get a linked_at", cs.c2.invite_expires_at == null && Boolean(cs.c2.linked_at));
  let blocked = false;
  try {
    await raw.execute(`insert into alerts (id, owner_id, status, trigger, public_token, started_at) values ('a-dup', 'u1', 'active', 'hold', 'cccccccccccccccccccccccccccccccccccc', '${t(1)}')`);
  } catch {
    blocked = true;
  }
  check("database now refuses a second active alert for the same person", blocked);
  
  // 4. Running again is a no-op.
  check("re-running migrations changes nothing", (await runChild()) === 0 && (await q(`select count(*) as n from schema_migrations`))[0].n === versions.length);
  
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
