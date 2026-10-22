// Turso (libSQL) access and schema. The schema is created on first use, so a new
// Turso database needs no manual setup.
import { createClient as createWebClient, type Client, type InArgs, type InStatement, type Row } from "@libsql/client/web";

let client: Client | null = null;
let migrated: Promise<void> | null = null;

function connect(): Client {
  const raw = process.env.TURSO_DATABASE_URL;
  if (!raw) throw new HttpError(500, "The database isn't configured: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  if (raw.startsWith("file:")) {
    // Local testing only. Loaded indirectly so the native driver isn't bundled into the Vercel function.
    const req = eval("require") as NodeRequire;
    const { createClient } = req("@libsql/client") as typeof import("@libsql/client");
    return createClient({ url: raw });
  }
  // HTTP suits serverless better than a long-lived WebSocket.
  const url = raw.replace(/^libsql:\/\//, "https://");
  return createWebClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

export function db(): Client {
  if (!client) client = connect();
  return client;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const SCHEMA = [
  `create table if not exists users (
    id text primary key,
    email text not null unique collate nocase,
    password_hash text not null,
    recovery_hash text not null,
    token_version integer not null default 0,
    created_at text not null
  )`,
  `create table if not exists profiles (
    id text primary key references users(id) on delete cascade,
    display_name text not null default '',
    phone text,
    language text not null default 'en',
    expo_push_token text,
    onboarded integer not null default 0,
    updated_at text not null
  )`,
  `create table if not exists login_attempts (email text not null, at integer not null)`,
  `create index if not exists login_attempts_email on login_attempts(email, at)`,
  `create table if not exists contacts (
    id text primary key,
    owner_id text not null,
    name text not null,
    phone text not null,
    relation text,
    priority integer not null default 1,
    invite_code text not null unique,
    linked_user_id text,
    created_at text not null
  )`,
  `create index if not exists contacts_owner on contacts(owner_id)`,
  `create index if not exists contacts_linked on contacts(linked_user_id)`,
  `create table if not exists alerts (
    id text primary key,
    owner_id text not null,
    status text not null default 'active',
    duress integer not null default 0,
    trigger text not null default 'hold',
    public_token text not null unique,
    last_lat real, last_lng real, last_accuracy real, last_seen_at text,
    battery real,
    started_at text not null,
    ended_at text
  )`,
  `create index if not exists alerts_owner on alerts(owner_id, started_at)`,
  `create table if not exists alert_locations (
    id integer primary key autoincrement,
    alert_id text not null,
    lat real not null, lng real not null, accuracy real,
    recorded_at text not null
  )`,
  `create index if not exists alert_locations_alert on alert_locations(alert_id, recorded_at)`,
  `create table if not exists alert_recipients (
    id text primary key,
    alert_id text not null,
    contact_id text,
    name text not null,
    channel text not null default 'sms',
    status text not null default 'queued',
    message text,
    updated_at text not null
  )`,
  `create index if not exists alert_recipients_alert on alert_recipients(alert_id)`,
  `create table if not exists journeys (
    id text primary key,
    owner_id text not null,
    destination text not null,
    interval_minutes integer not null,
    status text not null default 'active',
    next_checkin_at text not null,
    alert_id text,
    last_lat real, last_lng real,
    started_at text not null,
    ended_at text
  )`,
  `create index if not exists journeys_due on journeys(status, next_checkin_at)`,
  `create table if not exists threads (id text primary key, owner_id text not null, title text not null, created_at text not null)`,
  `create table if not exists entries (
    id text primary key,
    owner_id text not null,
    thread_id text not null,
    kind text not null,
    occurred_at text not null,
    channel text, handle text, note text,
    vault_item_id text,
    created_at text not null
  )`,
  `create index if not exists entries_thread on entries(thread_id, occurred_at)`,
  `create table if not exists summaries (
    id text primary key, owner_id text not null, thread_id text not null,
    body text not null, source text not null, edited integer not null default 0, created_at text not null
  )`,
  `create table if not exists vault_items (
    id text primary key,
    owner_id text not null,
    kind text not null,
    label text not null default '',
    sha256 text not null,
    size_bytes integer not null,
    mime text not null,
    source text not null default 'upload',
    alert_id text,
    chunks integer not null,
    complete integer not null default 0,
    captured_at text not null,
    created_at text not null
  )`,
  `create index if not exists vault_owner on vault_items(owner_id, captured_at)`,
  `create table if not exists vault_chunks (item_id text not null, idx integer not null, data blob not null, primary key (item_id, idx))`,
  `create table if not exists vault_log (id integer primary key autoincrement, owner_id text not null, item_id text, action text not null, at text not null)`,
  `create table if not exists reports (
    id text primary key, reporter_id text not null, geohash6 text not null, area_label text,
    category text not null, time_band text not null, created_at text not null
  )`,
  `create index if not exists reports_cell on reports(geohash6)`,
  `create table if not exists meta (key text primary key, value text)`,
];

// ---------------------------------------------------------------------------
// Versioned migrations. Each runs once and is recorded in schema_migrations.
// Steps are idempotent so overlapping cold starts can't break a deploy:
// ADD COLUMN checks the table first and tolerates "duplicate column".
// Version 1 is the original schema, so existing databases upgrade in place.
// ---------------------------------------------------------------------------
type Step = string | { addColumn: [table: string, column: string, definition: string] };
type Migration = { version: number; name: string; steps: Step[] };

export const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial schema", steps: SCHEMA },
  {
    version: 2,
    name: "P0 safety: idempotent SOS, truthful delivery states, location freshness, invite expiry, audit log, rate limits",
    steps: [
      { addColumn: ["alerts", "client_ref", "text"] },
      { addColumn: ["alerts", "end_reason", "text"] },
      { addColumn: ["alerts", "heartbeat_at", "text"] },
      { addColumn: ["alerts", "last_received_at", "text"] },
      { addColumn: ["alerts", "token_rotated_at", "text"] },
      { addColumn: ["alert_locations", "received_at", "text"] },
      { addColumn: ["alert_recipients", "attempts", "integer not null default 0"] },
      { addColumn: ["alert_recipients", "last_attempt_at", "text"] },
      { addColumn: ["alert_recipients", "error", "text"] },
      { addColumn: ["alert_recipients", "provider", "text"] },
      { addColumn: ["alert_recipients", "provider_ref", "text"] },
      { addColumn: ["contacts", "invite_expires_at", "text"] },
      { addColumn: ["contacts", "linked_at", "text"] },
      // Old rows: "sent" only ever came from her own Messages app (or an accepted push ticket).
      `update alert_recipients set status = 'device_compose' where status = 'sent' and channel = 'sms'`,
      `update alert_recipients set status = 'provider_accepted' where status = 'sent' and channel = 'push'`,
      `update alert_recipients set status = 'link_opened' where status = 'opened'`,
      // At most one active alert per person. Resolve any historical duplicates first, keeping the newest.
      `update alerts set status = 'resolved', end_reason = 'superseded', ended_at = coalesce(ended_at, started_at)
         where status = 'active' and exists (
           select 1 from alerts newer where newer.owner_id = alerts.owner_id and newer.status = 'active'
              and (newer.started_at > alerts.started_at or (newer.started_at = alerts.started_at and newer.id > alerts.id)))`,
      `create unique index if not exists alerts_one_active on alerts(owner_id) where status = 'active'`,
      `create unique index if not exists alerts_client_ref on alerts(owner_id, client_ref) where client_ref is not null`,
      `update contacts set invite_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days') where invite_expires_at is null and linked_user_id is null`,
      `update contacts set linked_at = created_at where linked_user_id is not null and linked_at is null`,
      `create table if not exists rate_limits (key text not null, bucket integer not null, count integer not null default 0, expires integer not null default 0, primary key (key, bucket))`,
      `create table if not exists audit_log (
        id integer primary key autoincrement,
        owner_id text not null,
        actor_id text,
        action text not null,
        target_type text,
        target_id text,
        meta text,
        at text not null
      )`,
      `create index if not exists audit_owner on audit_log(owner_id, at)`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

async function columnExists(table: string, column: string): Promise<boolean> {
  const r = await db().execute(`pragma table_info(${table})`);
  return r.rows.some((row) => (row as unknown as { name: string }).name === column);
}

async function runStep(step: Step) {
  if (typeof step === "string") {
    await db().execute(step);
    return;
  }
  const [table, column, definition] = step.addColumn;
  if (await columnExists(table, column)) return;
  try {
    await db().execute(`alter table ${table} add column ${column} ${definition}`);
  } catch (e) {
    if (!/duplicate column/i.test(String((e as Error).message))) throw e;
  }
}

async function runMigrations(): Promise<void> {
  await db().execute(`create table if not exists schema_migrations (version integer primary key, name text not null, applied_at text not null)`);
  const done = new Set(
    (await db().execute(`select version from schema_migrations`)).rows.map((r) => Number((r as unknown as { version: number }).version)),
  );
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    for (const step of m.steps) await runStep(step);
    await db().execute({ sql: `insert or ignore into schema_migrations (version, name, applied_at) values (?, ?, ?)`, args: [m.version, m.name, new Date().toISOString()] });
    console.log(JSON.stringify({ event: "migration_applied", version: m.version, name: m.name }));
  }
}

// Two instances cold-starting together can collide on the write lock (SQLITE_BUSY / "database is locked").
// Every step is idempotent, so the loser waits briefly and runs again instead of failing a request.
async function runMigrationsWithRetry(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runMigrations();
    } catch (e) {
      const busy = /SQLITE_BUSY|database is locked|locked/i.test(String((e as Error)?.message ?? e) + String((e as { code?: string })?.code ?? ""));
      if (!busy || attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, 100 * attempt + Math.random() * 100));
    }
  }
}

export function migrate(): Promise<void> {
  if (!migrated) {
    migrated = runMigrationsWithRetry().catch((e) => {
      migrated = null;
      throw e;
    });
  }
  return migrated;
}

type Val = string | number | null | bigint | Uint8Array | boolean;

export async function all<T = Row>(sql: string, args: Val[] = []): Promise<T[]> {
  const r = await db().execute({ sql, args: args as InArgs });
  return r.rows.map((row) => ({ ...row }) as unknown as T);
}

export async function one<T = Row>(sql: string, args: Val[] = []): Promise<T | null> {
  return (await all<T>(sql, args))[0] ?? null;
}

export async function run(sql: string, args: Val[] = []): Promise<number> {
  const r = await db().execute({ sql, args: args as InArgs });
  return r.rowsAffected;
}

export async function batch(stmts: { sql: string; args?: Val[] }[]): Promise<void> {
  if (!stmts.length) return;
  await db().batch(stmts.map((s) => ({ sql: s.sql, args: (s.args ?? []) as InArgs }) as InStatement), "write");
}

export const now = () => new Date().toISOString();
