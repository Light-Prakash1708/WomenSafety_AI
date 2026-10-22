// SAAHI API. One handler for every route, so the whole backend is a single Vercel function.
// Every query is scoped to the signed-in user explicitly (SQLite has no row-level security).
// Safety-critical rules (see docs/AUDIT.md):
//   - at most one active alert per person (enforced by a unique index), creation is idempotent by client_ref
//   - a cancel can arrive before the create it cancels and still wins (tombstone by client_ref)
//   - recipient states only move forward and only claim what a provider or person confirmed
//   - locations keep the time the fix was taken, never the time it arrived
import { guide, summarize, type Entry } from "./ai";
import { all, batch, HttpError, LATEST_VERSION, migrate, now, one, run } from "./db";
import { advanceRecipient, audit, clientIp, log, rateLimit, rateLimitHit, rateLimitPeek } from "./guard";
import { dispatchAlert, notifySelf, retryAndReceipts } from "./notify";
import {
  hashPassword,
  normalizeCode,
  randomCode,
  randomHex,
  recoveryCode,
  sha256Hex,
  signToken,
  uuid,
  verifyPassword,
  verifyPasswordOrDummy,
  verifyToken,
} from "./security";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
const SESSION_DAYS = 60;
const MAX_CONTACTS = 8;
const CHUNK_BYTES = 1_500_000; // raw bytes per vault chunk; base64 stays under Vercel's 4.5 MB body limit
const MAX_FILE_BYTES = 25_000_000;
const VAULT_QUOTA_BYTES = 500_000_000;
const WATCHDOG_GRACE_MS = 2 * 60 * 1000;
const INVITE_DAYS = 7;
const LINK_AFTER_END_DAYS = 7; // ended alerts: tracking link says "ended" for 7 days, then 410
const ALERT_SILENCE_HOURS = 24; // active alert with no location or heartbeat for this long expires
const STALE_LOCATION_SECONDS = 120;
const MAX_FIX_AGE_HOURS = 24;
const MAX_PASSWORD = 200;
const REPORT_DEDUPE_DAYS = 30; // the same person reporting the same thing in the same cell refreshes, never adds
const REPORT_VISIBLE_DAYS = 90; // reports older than this stop counting
const REPORT_RETAIN_DAYS = 180; // and are deleted after this
const FLAGS_TO_HIDE = 3; // distinct people flagging an area entry hides it until reviewed
const FLAG_REASONS = ["names_a_person", "wrong_place", "outdated", "other"];
const ENTRY_KINDS = ["message", "new_account", "call", "in_person", "blocked", "threat", "other"];
const VAULT_KINDS = ["photo", "audio", "screenshot", "document", "note"];
const VAULT_SOURCES = ["upload", "sos_recording", "pattern"];
const REPORT_CATEGORIES = ["poor_lighting", "harassment", "unsafe_transport", "no_security", "isolated"];
const TIME_BANDS = ["morning", "afternoon", "evening", "night"];
const TRIGGERS = ["hold", "shake", "walk", "manual"];
const LANGS = ["en", "hi", "bn"];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
type Ctx = { req: Request; url: URL; parts: string[]; body: Record<string, unknown>; origin: string; ip: string };
type User = { id: string; email: string; token_version: number };

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...headers },
  });

const str = (v: unknown, max = 500): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const need = <T>(v: T | null | undefined, message: string): T => {
  if (v === null || v === undefined || v === "") throw new HttpError(400, message);
  return v;
};
const iso = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d.toISOString();
};
const bool = (v: unknown) => (v ? 1 : 0);
const digits = (s: string) => s.replace(/\D/g, "");
const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const isConstraint = (e: unknown) => /UNIQUE constraint|SQLITE_CONSTRAINT/i.test(String((e as Error)?.message ?? e));
const CLIENT_REF = /^[A-Za-z0-9_-]{8,64}$/;

function siteOrigin(req: Request): string {
  const fixed = process.env.PUBLIC_SITE_URL;
  if (fixed) return fixed.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
const trackUrl = (origin: string, token: string) => `${origin}/track/?t=${token}`;

/** A location fix from the device. Keeps the time the fix was taken (clamped to now), rejects nonsense. */
function readFix(body: Record<string, unknown>, required: boolean): { lat: number; lng: number; accuracy: number | null; at: string } | null {
  const lat = num(body.lat);
  const lng = num(body.lng);
  if (lat == null || lng == null) {
    if (required) throw new HttpError(400, "A location needs lat and lng.");
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) throw new HttpError(400, "That location isn't valid.");
  const acc = num(body.accuracy);
  if (acc != null && (acc < 0 || acc > 100_000)) throw new HttpError(400, "That location accuracy isn't valid.");
  const fixAt = iso(body.fix_at);
  const nowMs = Date.now();
  // A fix can't be from the future; clock skew is clamped to "now".
  const at = fixAt && +new Date(fixAt) < nowMs ? fixAt : new Date(nowMs).toISOString();
  if (+new Date(at) < nowMs - MAX_FIX_AGE_HOURS * 3600_000) {
    if (required) throw new HttpError(400, "That location is more than a day old.");
    return null;
  }
  return { lat, lng, accuracy: acc, at };
}

async function currentUser(req: Request): Promise<User> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = token ? verifyToken<{ sub: string; tv: number; typ?: string }>(token) : null;
  if (!claims || claims.typ !== "session") throw new HttpError(401, "Your session has ended. Sign in again.");
  const user = await one<User>(`select id, email, token_version from users where id = ?`, [claims.sub]);
  if (!user || user.token_version !== claims.tv) throw new HttpError(401, "Your session has ended. Sign in again.");
  return user;
}

const sessionToken = (u: { id: string; token_version: number }) =>
  signToken({ sub: u.id, tv: u.token_version, typ: "session" }, SESSION_DAYS * 86400);

async function loadProfile(uid: string) {
  const p = await one<Record<string, unknown>>(`select * from profiles where id = ?`, [uid]);
  return p ? { ...p, onboarded: Boolean(p.onboarded) } : null;
}
async function loadContacts(uid: string) {
  return all<Record<string, unknown>>(
    `select c.id, c.owner_id, c.name, c.phone, c.relation, c.priority, c.invite_code, c.invite_expires_at, c.linked_user_id, c.linked_at, c.created_at,
            p.display_name as guardian_name
       from contacts c left join profiles p on p.id = c.linked_user_id
      where c.owner_id = ? order by c.priority, c.created_at`,
    [uid],
  );
}

async function ownedAlert(uid: string, id: string) {
  const a = await one<Record<string, any>>(`select * from alerts where id = ? and owner_id = ?`, [id, uid]);
  if (!a) throw new HttpError(404, "Alert not found.");
  return a;
}

/** Alerts I can see as a guardian: active ones from people whose circle I joined. */
async function guardianAlert(uid: string, id: string) {
  return one<Record<string, any>>(
    `select a.* from alerts a
      where a.id = ? and a.status = 'active'
        and exists (select 1 from contacts c where c.owner_id = a.owner_id and c.linked_user_id = ?)`,
    [id, uid],
  );
}

function freshness(a: Record<string, any>) {
  const at = a.last_seen_at ? +new Date(a.last_seen_at) : null;
  const age = at ? Math.max(0, Math.round((Date.now() - at) / 1000)) : null;
  return { location_age_seconds: age, location_stale: age == null ? null : age > STALE_LOCATION_SECONDS };
}

const alertView = (a: Record<string, any>) => ({ ...a, duress: Boolean(a.duress), ...freshness(a) });

const RECIPIENT_COLS = `id, alert_id, contact_id, name, channel, status, message, attempts, error, updated_at`;

async function alertPayload(a: Record<string, any>, origin: string, extra: Record<string, unknown> = {}) {
  const recipients = await all(`select ${RECIPIENT_COLS} from alert_recipients where alert_id = ? order by name`, [a.id]);
  return { alert: alertView(a), recipients, trackUrl: trackUrl(origin, a.public_token), ...extra };
}

/** Creates an alert, or returns the one that already exists for this ref or this person. Never two. */
async function createOrReuseAlert(
  uid: string,
  opts: { clientRef: string | null; trigger: string; fix: ReturnType<typeof readFix>; battery: number | null; duress: boolean },
): Promise<{ alert: Record<string, any>; created: boolean }> {
  const findExisting = async () =>
    (opts.clientRef ? await one<Record<string, any>>(`select * from alerts where owner_id = ? and client_ref = ?`, [uid, opts.clientRef]) : null) ??
    (await one<Record<string, any>>(`select * from alerts where owner_id = ? and status = 'active'`, [uid]));

  const existing = await findExisting();
  if (existing) return { alert: existing, created: false };

  const id = uuid();
  const t = now();
  const fix = opts.fix;
  const contacts = await all<{ id: string; name: string }>(`select id, name from contacts where owner_id = ? order by priority`, [uid]);
  try {
    await batch([
      {
        sql: `insert into alerts (id, owner_id, trigger, public_token, client_ref, duress, last_lat, last_lng, last_accuracy, last_seen_at, last_received_at, heartbeat_at, battery, started_at)
              values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, uid, opts.trigger, randomHex(18), opts.clientRef, bool(opts.duress), fix?.lat ?? null, fix?.lng ?? null, fix?.accuracy ?? null, fix?.at ?? null, fix ? t : null, t, opts.battery, t],
      },
      ...(fix ? [{ sql: `insert into alert_locations (alert_id, lat, lng, accuracy, recorded_at, received_at) values (?, ?, ?, ?, ?, ?)`, args: [id, fix.lat, fix.lng, fix.accuracy, fix.at, t] }] : []),
      ...contacts.map((ct) => ({
        sql: `insert into alert_recipients (id, alert_id, contact_id, name, channel, updated_at) values (?, ?, ?, ?, 'sms', ?)`,
        args: [uuid(), id, ct.id, ct.name, t],
      })),
    ]);
  } catch (e) {
    // A concurrent request won the race (same ref, or another active alert). Return that one.
    if (!isConstraint(e)) throw e;
    const winner = await findExisting();
    if (winner) return { alert: winner, created: false };
    throw e;
  }
  return { alert: (await one<Record<string, any>>(`select * from alerts where id = ?`, [id]))!, created: true };
}

async function endAlert(alertId: string, status: "cancelled" | "expired" | "resolved", reason: string) {
  const t = now();
  await batch([
    { sql: `update alerts set status = ?, end_reason = ?, ended_at = ? where id = ? and status = 'active'`, args: [status, reason, t, alertId] },
    { sql: `update journeys set status = 'cancelled', ended_at = coalesce(ended_at, ?) where alert_id = ? and status = 'active'`, args: [t, alertId] },
  ]);
}

/** Latest time any entry was added or corrected. */
function latestChange(entries: { created_at: string; updated_at?: string | null }[]): string | null {
  let latest: string | null = null;
  for (const x of entries) {
    const t = x.updated_at && x.updated_at > x.created_at ? x.updated_at : x.created_at;
    if (!latest || t > latest) latest = t;
  }
  return latest;
}

/** A summary is out of date once entries were added, removed or corrected after it was drafted. */
function summaryFreshness(summary: Record<string, any>, entries: Record<string, any>[]) {
  if (summary.basis_count == null) return { stale: null as boolean | null, basis_count: null, basis_latest: null };
  const latest = latestChange(entries as { created_at: string; updated_at?: string | null }[]);
  const stale = entries.length !== Number(summary.basis_count) || (latest != null && summary.basis_latest != null && latest > summary.basis_latest);
  return { stale, basis_count: Number(summary.basis_count), basis_latest: summary.basis_latest };
}

// ---------------------------------------------------------------------------
// Maintenance: SafeWalk watchdog, push retries and receipts, alert expiry, upload cleanup.
// Runs on the daily cron, on /api/cron/watchdog (point a pinger at it for minute-level checks),
// and opportunistically during normal API traffic.
// ---------------------------------------------------------------------------
export async function sweepJourneys(origin: string): Promise<{ checked: number; opened: number }> {
  const overdue = await all<{ id: string; owner_id: string; destination: string; last_lat: number | null; last_lng: number | null }>(
    `select id, owner_id, destination, last_lat, last_lng from journeys where status = 'active' and next_checkin_at < ? limit 50`,
    [ago(WATCHDOG_GRACE_MS)],
  );
  let opened = 0;
  for (const j of overdue) {
    // Claim first, so overlapping sweeps never double-alert.
    const claimed = await run(`update journeys set status = 'missed', ended_at = ? where id = ? and status = 'active'`, [now(), j.id]);
    if (!claimed) continue;
    const fix = j.last_lat != null && j.last_lng != null ? { lat: j.last_lat, lng: j.last_lng, accuracy: null, at: now() } : null;
    const { alert, created } = await createOrReuseAlert(j.owner_id, { clientRef: `watchdog-${j.id}`, trigger: "watchdog", fix, battery: null, duress: false });
    await run(`update journeys set alert_id = ? where id = ?`, [alert.id, j.id]);
    await audit(j.owner_id, null, "journey.missed", "journey", j.id, { alertId: alert.id, reusedActiveAlert: !created });
    log("watchdog_alert", { journeyId: j.id, alertId: alert.id, created });
    if (created) {
      const prof = await one<{ display_name: string; expo_push_token: string | null }>(`select display_name, expo_push_token from profiles where id = ?`, [j.owner_id]);
      await dispatchAlert(alert.id, prof?.display_name ?? "", trackUrl(origin, alert.public_token), {
        body: `She missed a check-in on her way to ${j.destination}. Tap to see her last location.`,
      });
      await notifySelf(prof?.expo_push_token ?? null, "You missed a check-in", `Your circle was alerted on your way to ${j.destination}. Open SAAHI to say you're safe.`, { alertId: alert.id });
      opened++;
    }
  }
  return { checked: overdue.length, opened };
}

export async function maintenance(origin: string) {
  const journeys = await sweepJourneys(origin);
  const pushes = await retryAndReceipts(origin);
  const silent = ago(ALERT_SILENCE_HOURS * 3600_000);
  const stale = await all<{ id: string; owner_id: string }>(
    `select id, owner_id from alerts where status = 'active'
        and max(coalesce(last_received_at, started_at), coalesce(heartbeat_at, started_at), started_at) < ?`,
    [silent],
  );
  for (const s of stale) {
    await endAlert(s.id, "expired", "no_contact_24h");
    await audit(s.owner_id, null, "alert.expired", "alert", s.id, { reason: "no location or heartbeat for 24 hours" });
  }
  const abandoned = await all<{ id: string }>(`select id from vault_items where complete = 0 and created_at < ?`, [ago(24 * 3600_000)]);
  await batch(abandoned.flatMap((i) => [
    { sql: `delete from vault_chunks where item_id = ?`, args: [i.id] },
    { sql: `delete from vault_items where id = ?`, args: [i.id] },
  ]));
  await batch([
    { sql: `delete from rate_limits where expires < ?`, args: [Date.now()] },
    { sql: `delete from login_attempts where at < ?`, args: [Date.now() - 86400_000] },
    { sql: `delete from audit_log where at < ?`, args: [ago(365 * 86400_000)] },
    { sql: `delete from reports where created_at < ?`, args: [ago(REPORT_RETAIN_DAYS * 86400_000)] },
  ]);
  return { ...journeys, ...pushes, expiredAlerts: stale.length, abandonedUploads: abandoned.length };
}

let lastSweep = 0;
async function maybeMaintain(origin: string) {
  if (Date.now() - lastSweep < 30_000) return;
  lastSweep = Date.now();
  try {
    await maintenance(origin);
  } catch (e) {
    log("maintenance_failed", { error: String((e as Error).message) });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function route(c: Ctx): Promise<Response> {
  const { req, parts, body, ip } = c;
  const m = req.method;
  const [a, b, d, e] = parts;

  // ----- public -----
  if (a === "health" && m === "GET") {
    await one(`select 1`);
    return json({ ok: true, time: now(), schema: LATEST_VERSION });
  }

  if (a === "cron" && b === "watchdog") {
    // Public on purpose (a free external pinger can call it), but throttled globally.
    const last = await one<{ value: string }>(`select value from meta where key = 'cron_last_run'`);
    if (last && Date.now() - Number(last.value) < 10_000) return json({ skipped: true, reason: "ran less than 10 seconds ago" });
    await run(`insert into meta (key, value) values ('cron_last_run', ?) on conflict(key) do update set value = excluded.value`, [String(Date.now())]);
    return json(await maintenance(c.origin));
  }

  if (a === "auth" && b === "signup" && m === "POST") {
    await rateLimit(`signup:ip:${ip}`, 10, 3600, "Too many new accounts from this network. Try again in an hour.");
    const email = need(str(body.email, 254), "Enter your email address.").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email address doesn't look right.");
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) throw new HttpError(400, "Use at least 8 characters for your password.");
    if (password.length > MAX_PASSWORD) throw new HttpError(400, "Use a password under 200 characters.");
    if (await one(`select 1 from users where email = ?`, [email])) throw new HttpError(409, "An account with this email already exists. Sign in instead.");
    const id = uuid();
    const code = recoveryCode();
    const t = now();
    await batch([
      { sql: `insert into users (id, email, password_hash, recovery_hash, created_at) values (?, ?, ?, ?, ?)`, args: [id, email, await hashPassword(password), sha256Hex(normalizeCode(code)), t] },
      { sql: `insert into profiles (id, display_name, updated_at) values (?, ?, ?)`, args: [id, str(body.name, 80) ?? "", t] },
    ]);
    return json({ token: sessionToken({ id, token_version: 0 }), recoveryCode: code, user: { id, email } }, 201);
  }

  if (a === "auth" && b === "login" && m === "POST") {
    await rateLimit(`login:ip:${ip}`, 60, 900, "Too many sign-in attempts from this network. Wait 15 minutes.");
    const email = (str(body.email, 254) ?? "").toLowerCase();
    const password = typeof body.password === "string" ? body.password.slice(0, MAX_PASSWORD) : "";
    const tries = await one<{ n: number }>(`select count(*) as n from login_attempts where email = ? and at > ?`, [email, Date.now() - 15 * 60 * 1000]);
    if ((tries?.n ?? 0) >= 10) throw new HttpError(429, "Too many attempts. Wait 15 minutes, or reset your password with your recovery code.");
    const u = await one<User & { password_hash: string }>(`select id, email, token_version, password_hash from users where email = ?`, [email]);
    if (!(await verifyPasswordOrDummy(password, u?.password_hash))) {
      await run(`insert into login_attempts (email, at) values (?, ?)`, [email, Date.now()]);
      throw new HttpError(401, "That email and password don't match.");
    }
    await run(`delete from login_attempts where email = ?`, [email]);
    return json({ token: sessionToken(u!), user: { id: u!.id, email: u!.email } });
  }

  if (a === "auth" && b === "recover" && m === "POST") {
    await rateLimit(`recover:ip:${ip}`, 20, 3600, "Too many reset attempts from this network. Try again in an hour.");
    const email = (str(body.email, 254) ?? "").toLowerCase();
    const code = normalizeCode(String(body.recoveryCode ?? ""));
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) throw new HttpError(400, "Use at least 8 characters for your new password.");
    if (password.length > MAX_PASSWORD) throw new HttpError(400, "Use a password under 200 characters.");
    const tries = await one<{ n: number }>(`select count(*) as n from login_attempts where email = ? and at > ?`, [email, Date.now() - 15 * 60 * 1000]);
    if ((tries?.n ?? 0) >= 10) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.");
    const u = await one<User & { recovery_hash: string }>(`select id, email, token_version, recovery_hash from users where email = ?`, [email]);
    if (!u || sha256Hex(code) !== u.recovery_hash) {
      await run(`insert into login_attempts (email, at) values (?, ?)`, [email, Date.now()]);
      throw new HttpError(401, "That email and recovery code don't match.");
    }
    const newCode = recoveryCode();
    const tv = u.token_version + 1; // signs out every other device
    await run(`update users set password_hash = ?, recovery_hash = ?, token_version = ? where id = ?`, [await hashPassword(password), sha256Hex(normalizeCode(newCode)), tv, u.id]);
    await run(`delete from login_attempts where email = ?`, [email]);
    await audit(u.id, u.id, "auth.recover");
    return json({ token: sessionToken({ id: u.id, token_version: tv }), recoveryCode: newCode, user: { id: u.id, email: u.email } });
  }

  if (a === "public" && b === "alert") {
    const token = m === "GET" ? (c.url.searchParams.get("t") ?? "") : String(body.t ?? "");
    if (!/^[a-f0-9]{36}$/.test(token)) throw new HttpError(400, "This link isn't valid.");
    await rateLimit(`public:ip:${ip}`, 600, 600, "Too many requests. Wait a few minutes.");
    const al = await one<Record<string, any>>(`select * from alerts where public_token = ?`, [token]);
    if (!al) throw new HttpError(404, "This alert doesn't exist or was deleted.");
    const live = al.status === "active";
    if (!live && al.ended_at && +new Date(al.ended_at) < Date.now() - LINK_AFTER_END_DAYS * 86400_000) {
      throw new HttpError(410, "This link has expired.");
    }
    if (m === "POST") {
      if (!live) throw new HttpError(409, "This alert has ended.");
      const rid = str(body.recipient_id, 64);
      if (rid) {
        const r = await one<{ id: string }>(`select id from alert_recipients where id = ? and alert_id = ?`, [rid, al.id]);
        if (!r) throw new HttpError(404, "Unknown responder.");
        if (body.action === "ack") {
          await advanceRecipient(r.id, "acknowledged", { message: str(body.message, 280) });
          await audit(al.owner_id, null, "alert.ack_by_link", "alert", al.id, { recipientId: r.id });
        } else {
          await advanceRecipient(r.id, "link_opened");
        }
      }
      return json({ ok: true });
    }
    if (!live) {
      // After it ends, the link reveals nothing about her beyond the fact that it ended.
      return json({ name: null, status: al.status, ended_at: al.ended_at, location: null, trail: [], battery: null, recipients: [], possibly_forced_cancel: false });
    }
    const [prof, recips, trail] = await Promise.all([
      one<{ display_name: string }>(`select display_name from profiles where id = ?`, [al.owner_id]),
      all<Record<string, any>>(`select id, name, status, message from alert_recipients where alert_id = ? order by name`, [al.id]),
      all(`select lat, lng, recorded_at from alert_locations where alert_id = ? order by recorded_at desc limit 20`, [al.id]),
    ]);
    const f = freshness(al);
    return json({
      name: (prof?.display_name ?? "").split(" ")[0] || "Your contact",
      status: "active",
      possibly_forced_cancel: Boolean(al.duress),
      started_at: al.started_at,
      ended_at: null,
      location: al.last_lat != null ? { lat: al.last_lat, lng: al.last_lng, accuracy: al.last_accuracy, at: al.last_seen_at, age_seconds: f.location_age_seconds, stale: f.location_stale } : null,
      phone_last_heard_at: al.heartbeat_at ?? al.last_received_at ?? al.started_at,
      trail,
      battery: al.battery,
      recipients: recips.map((r) => ({ id: r.id, name: String(r.name).split(" ")[0], status: r.status, message: r.message })),
    });
  }

  // ----- signed in from here -----
  const me = await currentUser(req);
  const uid = me.id;

  if (a === "me" && !b) {
    if (m === "GET") return json({ user: { id: uid, email: me.email }, profile: await loadProfile(uid), contacts: await loadContacts(uid) });
    if (m === "DELETE") {
      const items = await all<{ id: string }>(`select id from vault_items where owner_id = ?`, [uid]);
      const alerts = await all<{ id: string }>(`select id from alerts where owner_id = ?`, [uid]);
      await batch([
        ...items.map((i) => ({ sql: `delete from vault_chunks where item_id = ?`, args: [i.id] })),
        ...alerts.flatMap((x) => [
          { sql: `delete from alert_locations where alert_id = ?`, args: [x.id] },
          { sql: `delete from alert_recipients where alert_id = ?`, args: [x.id] },
        ]),
        ...["vault_items", "vault_log", "entries", "summaries", "threads", "journeys", "alerts", "contacts", "audit_log"].map((t) => ({ sql: `delete from ${t} where owner_id = ?`, args: [uid] })),
        { sql: `delete from reports where reporter_id = ?`, args: [uid] },
        { sql: `delete from report_flags where flagger_id = ?`, args: [uid] },
        { sql: `delete from entry_revisions where owner_id = ?`, args: [uid] },
        { sql: `update contacts set linked_user_id = null, linked_at = null where linked_user_id = ?`, args: [uid] },
        { sql: `update audit_log set actor_id = null where actor_id = ?`, args: [uid] },
        { sql: `delete from profiles where id = ?`, args: [uid] },
        { sql: `delete from users where id = ?`, args: [uid] },
      ]);
      log("account_deleted", { userId: uid });
      return json({ ok: true });
    }
  }

  if (a === "auth" && b === "logout-all" && m === "POST") {
    const tv = me.token_version + 1;
    await run(`update users set token_version = ? where id = ?`, [tv, uid]);
    await audit(uid, uid, "auth.logout_all");
    return json({ token: sessionToken({ id: uid, token_version: tv }) });
  }

  // Used to cancel an SOS on a device that has no PINs set up yet.
  if (a === "auth" && b === "verify-password" && m === "POST") {
    await rateLimitPeek(`verify:${uid}`, 10, 900, "Too many attempts. Wait 15 minutes, or call 112 if you need help.");
    const u = await one<{ password_hash: string }>(`select password_hash from users where id = ?`, [uid]);
    const ok = await verifyPassword(typeof body.password === "string" ? body.password.slice(0, MAX_PASSWORD) : "", u!.password_hash);
    if (!ok) {
      await rateLimitHit(`verify:${uid}`, 900);
      // 403, not 401: the session is fine, and clients sign out on 401.
      throw new HttpError(403, "That password isn't right.");
    }
    return json({ ok: true });
  }

  if (a === "audit" && m === "GET") {
    const rows = await all<Record<string, any>>(
      `select l.action, l.target_type, l.target_id, l.at, l.actor_id, p.display_name as actor_name
         from audit_log l left join profiles p on p.id = l.actor_id
        where l.owner_id = ? order by l.at desc, l.id desc limit 200`,
      [uid],
    );
    return json({
      events: rows.map((r) => ({
        action: r.action,
        target_type: r.target_type,
        target_id: r.target_id,
        at: r.at,
        actor: r.actor_id === uid ? "you" : r.actor_id ? (r.actor_name || "a guardian") : "SAAHI or someone with your tracking link",
      })),
    });
  }

  if (a === "profile" && m === "PATCH") {
    const sets: string[] = [];
    const args: (string | number | null)[] = [];
    if ("display_name" in body) sets.push("display_name = ?"), args.push(str(body.display_name, 80) ?? "");
    if ("phone" in body) sets.push("phone = ?"), args.push(str(body.phone, 20));
    if ("language" in body && LANGS.includes(String(body.language))) sets.push("language = ?"), args.push(String(body.language));
    if ("expo_push_token" in body) sets.push("expo_push_token = ?"), args.push(str(body.expo_push_token, 200));
    if ("onboarded" in body) sets.push("onboarded = ?"), args.push(bool(body.onboarded));
    if (sets.length) await run(`update profiles set ${sets.join(", ")}, updated_at = ? where id = ?`, [...args, now(), uid]);
    return json({ profile: await loadProfile(uid) });
  }

  if (a === "contacts") {
    if (m === "POST" && !b) {
      const name = need(str(body.name, 80), "Add a name.");
      const phone = need(str(body.phone, 20), "Add a mobile number.");
      if (digits(phone).length < 10) throw new HttpError(400, "Add a full mobile number, like +91 98300 12345.");
      const count = await one<{ n: number }>(`select count(*) as n from contacts where owner_id = ?`, [uid]);
      if ((count?.n ?? 0) >= MAX_CONTACTS) throw new HttpError(400, "Keep your circle to 8 people so alerts stay fast.");
      await run(
        `insert into contacts (id, owner_id, name, phone, relation, priority, invite_code, invite_expires_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), uid, name, phone, str(body.relation, 40), (count?.n ?? 0) + 1, randomCode(8), inDays(INVITE_DAYS), now()],
      );
      return json({ contacts: await loadContacts(uid) }, 201);
    }
    if (m === "DELETE" && b && !d) {
      const ct = await one<{ linked_user_id: string | null }>(`select linked_user_id from contacts where id = ? and owner_id = ?`, [b, uid]);
      await run(`delete from contacts where id = ? and owner_id = ?`, [b, uid]);
      if (ct?.linked_user_id) await audit(uid, uid, "guardian.removed", "contact", b);
      return json({ contacts: await loadContacts(uid) });
    }
    // New code: old code stops working and any linked guardian loses access at once.
    if (m === "POST" && b && (d === "new-code" || d === "unlink")) {
      const ct = await one<{ linked_user_id: string | null }>(`select linked_user_id from contacts where id = ? and owner_id = ?`, [b, uid]);
      if (!ct) throw new HttpError(404, "Contact not found.");
      await run(`update contacts set invite_code = ?, invite_expires_at = ?, linked_user_id = null, linked_at = null where id = ? and owner_id = ?`, [
        randomCode(8),
        inDays(INVITE_DAYS),
        b,
        uid,
      ]);
      await audit(uid, uid, ct.linked_user_id ? "guardian.revoked" : "invite.rotated", "contact", b);
      return json({ contacts: await loadContacts(uid) });
    }
  }

  // Someone gave me their invite code: I become their guardian in the app.
  if (a === "guardian" && b === "join" && m === "POST") {
    await rateLimitPeek(`join:${uid}`, 10, 3600, "Too many wrong codes. Wait an hour and check the code with her.");
    await rateLimitPeek(`join:ip:${ip}`, 30, 3600, "Too many wrong codes from this network. Wait an hour.");
    const fail = async (status: number, message: string): Promise<never> => {
      await rateLimitHit(`join:${uid}`, 3600);
      await rateLimitHit(`join:ip:${ip}`, 3600);
      throw new HttpError(status, message);
    };
    const code = normalizeCode(String(body.code ?? ""));
    if (code.length !== 8) await fail(400, "Guardian codes are 8 letters and numbers.");
    const ct = await one<{ id: string; owner_id: string; linked_user_id: string | null; invite_expires_at: string | null }>(
      `select id, owner_id, linked_user_id, invite_expires_at from contacts where invite_code = ?`,
      [code],
    );
    if (!ct) return await fail(404, "That code didn't match anyone's circle. Check it and try again.");
    if (ct.owner_id === uid) throw new HttpError(400, "That's your own code. Send it to the person you added.");
    if (ct.linked_user_id && ct.linked_user_id !== uid) await fail(409, "This code was already used. Ask her to send a new one.");
    if (!ct.linked_user_id && ct.invite_expires_at && +new Date(ct.invite_expires_at) < Date.now()) await fail(410, "This code has expired. Ask her to send a new one.");
    if (ct.linked_user_id !== uid) {
      await run(`update contacts set linked_user_id = ?, linked_at = ? where id = ? and linked_user_id is null`, [uid, now(), ct.id]);
      await audit(ct.owner_id, uid, "guardian.joined", "contact", ct.id);
    }
    const owner = await one<{ display_name: string }>(`select display_name from profiles where id = ?`, [ct.owner_id]);
    return json({ ok: true, name: (owner?.display_name ?? "").split(" ")[0] || "your contact" });
  }

  if (a === "guardian" && b === "alerts" && m === "GET") {
    const rows = await all<Record<string, any>>(
      `select a.id, a.owner_id, a.started_at, a.duress, a.last_seen_at, p.display_name as owner_name
         from alerts a join profiles p on p.id = a.owner_id
        where a.status = 'active' and a.owner_id <> ?
          and exists (select 1 from contacts c where c.owner_id = a.owner_id and c.linked_user_id = ?)
        order by a.started_at desc`,
      [uid, uid],
    );
    return json({ alerts: rows.map(alertView) });
  }

  // ----- alerts -----
  if (a === "alerts") {
    if (m === "POST" && !b) {
      const clientRef = str(body.client_ref, 64);
      if (clientRef && !CLIENT_REF.test(clientRef)) throw new HttpError(400, "client_ref is invalid.");
      await rateLimit(`sos:${uid}`, 30, 3600, "Too many alerts in the last hour. If you're in danger, call 112.");
      const { alert, created } = await createOrReuseAlert(uid, {
        clientRef,
        trigger: TRIGGERS.includes(String(body.trigger)) ? String(body.trigger) : "hold",
        fix: readFix(body, false),
        battery: num(body.battery),
        duress: Boolean(body.duress),
      });
      if (created) {
        await audit(uid, uid, "alert.created", "alert", alert.id, { trigger: alert.trigger });
        const prof = await one<{ display_name: string }>(`select display_name from profiles where id = ?`, [uid]);
        await dispatchAlert(alert.id, prof?.display_name ?? "", trackUrl(c.origin, alert.public_token));
      } else if (body.duress && alert.status === "active" && !alert.duress) {
        await run(`update alerts set duress = 1 where id = ?`, [alert.id]);
        alert.duress = 1;
      }
      log("alert_request", { alertId: alert.id, created, status: alert.status });
      return json(await alertPayload(alert, c.origin, { created }), created ? 201 : 200);
    }

    // Cancel or duress by the device's own reference: works even if the create never got a reply,
    // and even if this arrives before the create does (a cancelled placeholder wins the ref).
    if (b === "by-ref" && d && (e === "cancel" || e === "duress") && m === "POST") {
      if (!CLIENT_REF.test(d)) throw new HttpError(400, "client_ref is invalid.");
      const existing = await one<Record<string, any>>(`select * from alerts where owner_id = ? and client_ref = ?`, [uid, d]);
      if (e === "duress") {
        if (existing?.status === "active") {
          await run(`update alerts set duress = 1 where id = ?`, [existing.id]);
          await audit(uid, uid, "alert.duress", "alert", existing.id);
        }
        return json({ ok: true, found: Boolean(existing) });
      }
      if (existing) {
        if (existing.status === "active") {
          await endAlert(existing.id, "cancelled", "pin");
          await audit(uid, uid, "alert.cancelled", "alert", existing.id);
        }
        return json({ ok: true, status: existing.status === "active" ? "cancelled" : existing.status });
      }
      try {
        const t = now();
        await run(
          `insert into alerts (id, owner_id, status, trigger, public_token, client_ref, started_at, ended_at, end_reason) values (?, ?, 'cancelled', 'hold', ?, ?, ?, ?, 'cancelled_before_created')`,
          [uuid(), uid, randomHex(18), d, t, t],
        );
      } catch (err) {
        if (!isConstraint(err)) throw err;
        const raced = await one<Record<string, any>>(`select * from alerts where owner_id = ? and client_ref = ?`, [uid, d]);
        if (raced?.status === "active") await endAlert(raced.id, "cancelled", "pin");
      }
      await audit(uid, uid, "alert.cancelled_before_created", "alert", null, { clientRef: d });
      return json({ ok: true, status: "cancelled" });
    }

    // Her own active alert, so a reopened or reinstalled app can show it and let her end it.
    if (b === "active" && m === "GET" && !d) {
      const own = await one<Record<string, any>>(`select * from alerts where owner_id = ? and status = 'active'`, [uid]);
      return json(own ? await alertPayload(own, c.origin) : { alert: null });
    }

    if (b && m === "GET" && !d) {
      const own = await one<Record<string, any>>(`select * from alerts where id = ? and owner_id = ?`, [b, uid]);
      const al = own ?? (await guardianAlert(uid, b));
      if (!al) throw new HttpError(404, "This alert has ended or isn't shared with you.");
      return json({ ...(await alertPayload(al, c.origin)), mine: Boolean(own), ...(own ? {} : { trackUrl: undefined }) });
    }

    if (b && d === "locations" && m === "POST") {
      const al = await ownedAlert(uid, b);
      if (al.status !== "active") return json({ ok: true, status: al.status });
      const fix = readFix(body, true)!;
      const t = now();
      await batch([
        { sql: `insert into alert_locations (alert_id, lat, lng, accuracy, recorded_at, received_at) values (?, ?, ?, ?, ?, ?)`, args: [b, fix.lat, fix.lng, fix.accuracy, fix.at, t] },
        // Only move "last location" forward in time; late-arriving older fixes go into the trail only.
        {
          sql: `update alerts set last_lat = ?, last_lng = ?, last_accuracy = ?, last_seen_at = ? where id = ? and (last_seen_at is null or last_seen_at <= ?)`,
          args: [fix.lat, fix.lng, fix.accuracy, fix.at, b, fix.at],
        },
        { sql: `update alerts set last_received_at = ?, heartbeat_at = ?, battery = coalesce(?, battery) where id = ?`, args: [t, t, num(body.battery), b] },
      ]);
      return json({ ok: true, status: al.status });
    }

    if (b && d === "heartbeat" && m === "POST") {
      const al = await ownedAlert(uid, b);
      if (al.status === "active") await run(`update alerts set heartbeat_at = ?, battery = coalesce(?, battery) where id = ?`, [now(), num(body.battery), b]);
      return json({ ok: true, status: al.status });
    }

    // What her own phone did with the text: "sent" (iOS confirms she pressed Send), "unknown" (Android:
    // Messages opened, outcome not reported), "cancelled" (she backed out). Never marks delivery.
    if (b && (d === "device-sms" || d === "sms-sent") && m === "POST") {
      await ownedAlert(uid, b);
      const result = d === "sms-sent" ? "unknown" : String(body.result);
      if (result === "sent" || result === "unknown") {
        const next = result === "sent" ? "device_sent" : "device_compose";
        const rows = await all<{ id: string }>(`select id from alert_recipients where alert_id = ? and channel = 'sms'`, [b]);
        for (const r of rows) await advanceRecipient(r.id, next);
      }
      return json({ ok: true });
    }

    if (b && d === "duress" && m === "POST") {
      const al = await ownedAlert(uid, b);
      if (al.status === "active") {
        await run(`update alerts set duress = 1 where id = ?`, [b]);
        await audit(uid, uid, "alert.duress", "alert", b);
      }
      return json({ ok: true });
    }

    if (b && d === "cancel" && m === "POST") {
      const al = await ownedAlert(uid, b);
      if (al.status === "active") {
        await endAlert(b, "cancelled", "pin");
        await audit(uid, uid, "alert.cancelled", "alert", b);
      }
      return json({ ok: true });
    }

    // If the tracking link leaked, a new one replaces it at once; the old link stops working.
    if (b && d === "rotate-link" && m === "POST") {
      const al = await ownedAlert(uid, b);
      if (al.status !== "active") throw new HttpError(409, "This alert has ended.");
      const token = randomHex(18);
      await run(`update alerts set public_token = ?, token_rotated_at = ? where id = ?`, [token, now(), b]);
      await audit(uid, uid, "alert.link_rotated", "alert", b);
      return json({ trackUrl: trackUrl(c.origin, token), public_token: token });
    }

    if (b && d === "ack" && m === "POST") {
      const al = await guardianAlert(uid, b);
      if (!al) throw new HttpError(404, "This alert has ended or isn't shared with you.");
      const mine = await all<{ id: string }>(
        `select id from alert_recipients where alert_id = ? and contact_id in (select id from contacts where owner_id = ? and linked_user_id = ?)`,
        [b, al.owner_id, uid],
      );
      for (const r of mine) await advanceRecipient(r.id, "acknowledged", { message: str(body.message, 280) });
      await audit(al.owner_id, uid, "alert.ack_by_guardian", "alert", b);
      return json({ ok: true });
    }
  }

  // ----- journeys -----
  if (a === "journeys") {
    if (b === "active" && m === "GET") {
      return json({ journey: await one(`select * from journeys where owner_id = ? and status = 'active' order by started_at desc limit 1`, [uid]) });
    }
    if (!b && m === "POST") {
      const destination = need(str(body.destination, 120), "Where are you headed?");
      const minutes = Math.round(num(body.interval_minutes) ?? 5);
      if (minutes < 1 || minutes > 60) throw new HttpError(400, "Check-ins can be every 1 to 60 minutes.");
      const fix = readFix(body, false);
      await run(`update journeys set status = 'cancelled', ended_at = ? where owner_id = ? and status = 'active'`, [now(), uid]);
      const id = uuid();
      await run(
        `insert into journeys (id, owner_id, destination, interval_minutes, next_checkin_at, last_lat, last_lng, started_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, uid, destination, minutes, new Date(Date.now() + minutes * 60000).toISOString(), fix?.lat ?? null, fix?.lng ?? null, now()],
      );
      return json({ journey: await one(`select * from journeys where id = ?`, [id]) }, 201);
    }
    if (b && m === "POST") {
      const j = await one<{ id: string; interval_minutes: number; status: string }>(`select id, interval_minutes, status from journeys where id = ? and owner_id = ?`, [b, uid]);
      if (!j) throw new HttpError(404, "Journey not found.");
      if (d === "checkin") {
        if (j.status !== "active") throw new HttpError(409, "This journey has already ended.");
        await run(`update journeys set next_checkin_at = ? where id = ? and status = 'active'`, [new Date(Date.now() + j.interval_minutes * 60000).toISOString(), b]);
      } else if (d === "location") {
        const fix = readFix(body, true)!;
        await run(`update journeys set last_lat = ?, last_lng = ? where id = ?`, [fix.lat, fix.lng, b]);
      } else if (d === "end") {
        const status = body.status === "arrived" ? "arrived" : body.status === "missed" ? "missed" : "cancelled";
        await run(`update journeys set status = ?, ended_at = ? where id = ? and status = 'active'`, [status, now(), b]);
      } else throw new HttpError(404, "Not found");
      return json({ journey: await one(`select * from journeys where id = ?`, [b]) });
    }
  }

  // ----- pattern -----
  if (a === "threads") {
    if (!b && m === "GET") return json({ threads: await all(`select id, title, created_at from threads where owner_id = ? order by created_at desc`, [uid]) });
    if (!b && m === "POST") {
      const id = uuid();
      await run(`insert into threads (id, owner_id, title, created_at) values (?, ?, ?, ?)`, [id, uid, need(str(body.title, 120), "Give the thread a title."), now()]);
      return json({ thread: await one(`select id, title, created_at from threads where id = ?`, [id]) }, 201);
    }
    if (b) {
      const th = await one<{ id: string; title: string }>(`select id, title, created_at from threads where id = ? and owner_id = ?`, [b, uid]);
      if (!th) throw new HttpError(404, "Thread not found.");
      if (!d && m === "GET") {
        const entries = await all<Record<string, any>>(`select * from entries where thread_id = ? order by occurred_at desc`, [b]);
        const summary = await one<Record<string, any>>(
          `select id, body, source, edited, created_at, basis_count, basis_latest from summaries where thread_id = ? order by created_at desc limit 1`,
          [b],
        );
        return json({ thread: th, entries, summary: summary ? { ...summary, ...summaryFreshness(summary, entries) } : null });
      }
      // Corrections keep the earlier version, so a timeline shown to someone can always be explained.
      if (d === "entries" && e && m === "PATCH") {
        const cur = await one<Record<string, any>>(`select * from entries where id = ? and thread_id = ? and owner_id = ?`, [e, b, uid]);
        if (!cur) throw new HttpError(404, "Entry not found.");
        const next = {
          kind: "kind" in body ? String(body.kind) : cur.kind,
          occurred_at: "occurred_at" in body ? iso(body.occurred_at) : cur.occurred_at,
          channel: "channel" in body ? str(body.channel, 120) : cur.channel,
          handle: "handle" in body ? str(body.handle, 120) : cur.handle,
          note: "note" in body ? str(body.note, 4000) : cur.note,
          source_ref: "source_ref" in body ? str(body.source_ref, 200) : cur.source_ref,
        };
        if (!ENTRY_KINDS.includes(next.kind)) throw new HttpError(400, "Pick what happened.");
        if (!next.occurred_at) throw new HttpError(400, "That time isn't valid.");
        const same = (["kind", "occurred_at", "channel", "handle", "note", "source_ref"] as const).every((k) => (next[k] ?? null) === (cur[k] ?? null));
        if (same) return json({ entry: cur });
        const t = now();
        await batch([
          {
            sql: `insert into entry_revisions (entry_id, owner_id, revision, kind, occurred_at, channel, handle, note, source_ref, reason, replaced_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [e, uid, cur.revision ?? 1, cur.kind, cur.occurred_at, cur.channel, cur.handle, cur.note, cur.source_ref ?? null, str(body.reason, 200), t],
          },
          {
            sql: `update entries set kind = ?, occurred_at = ?, channel = ?, handle = ?, note = ?, source_ref = ?, revision = coalesce(revision, 1) + 1, updated_at = ? where id = ? and owner_id = ?`,
            args: [next.kind, next.occurred_at, next.channel, next.handle, next.note, next.source_ref, t, e, uid],
          },
        ]);
        return json({ entry: await one(`select * from entries where id = ?`, [e]) });
      }
      if (d === "entries" && e && parts[4] === "revisions" && m === "GET") {
        if (!(await one(`select 1 from entries where id = ? and thread_id = ? and owner_id = ?`, [e, b, uid]))) throw new HttpError(404, "Entry not found.");
        return json({ revisions: await all(`select revision, kind, occurred_at, channel, handle, note, source_ref, reason, replaced_at from entry_revisions where entry_id = ? and owner_id = ? order by revision`, [e, uid]) });
      }
      if (d === "entries" && m === "POST") {
        const kind = String(body.kind);
        if (!ENTRY_KINDS.includes(kind)) throw new HttpError(400, "Pick what happened.");
        let vaultId = str(body.vault_item_id, 64);
        if (vaultId && !(await one(`select 1 from vault_items where id = ? and owner_id = ?`, [vaultId, uid]))) vaultId = null;
        const id = uuid();
        await run(
          `insert into entries (id, owner_id, thread_id, kind, occurred_at, channel, handle, note, vault_item_id, source_ref, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, uid, b, kind, iso(body.occurred_at) ?? now(), str(body.channel, 120), str(body.handle, 120), str(body.note, 4000), vaultId, str(body.source_ref, 200), now(), now()],
        );
        return json({ entry: await one(`select * from entries where id = ?`, [id]) }, 201);
      }
      if (d === "summary" && m === "POST") {
        const entries = await all<Entry & { created_at: string; updated_at: string | null }>(
          `select kind, occurred_at, channel, handle, note, created_at, updated_at from entries where thread_id = ? order by occurred_at`,
          [b],
        );
        const s = await summarize(entries);
        const basis = { basis_count: entries.length, basis_latest: latestChange(entries) };
        if (entries.length) {
          await run(`insert into summaries (id, owner_id, thread_id, body, source, basis_count, basis_latest, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`, [
            uuid(), uid, b, s.body, s.source, basis.basis_count, basis.basis_latest, now(),
          ]);
        }
        return json({ ...s, ...basis, stale: false });
      }
      if (d === "summary" && m === "PUT") {
        const text = need(str(body.body, 8000), "The summary can't be empty.");
        // An edit keeps the basis of the summary it edits, so staleness still tells the truth.
        const prev = await one<{ basis_count: number | null; basis_latest: string | null }>(`select basis_count, basis_latest from summaries where thread_id = ? order by created_at desc limit 1`, [b]);
        await run(`insert into summaries (id, owner_id, thread_id, body, source, edited, basis_count, basis_latest, created_at) values (?, ?, ?, ?, ?, 1, ?, ?, ?)`, [
          uuid(), uid, b, text, str(body.source, 10) ?? "ai", prev?.basis_count ?? null, prev?.basis_latest ?? null, now(),
        ]);
        return json({ ok: true });
      }
    }
  }

  if (a === "insight" && m === "GET") {
    const th = await one<{ id: string; title: string }>(
      `select t.id, t.title from threads t where t.owner_id = ? and exists (select 1 from entries e where e.thread_id = t.id) order by t.created_at desc limit 1`,
      [uid],
    );
    if (!th) return json({ insight: null });
    const rows = await all<{ kind: string; occurred_at: string }>(`select kind, occurred_at from entries where thread_id = ? order by occurred_at`, [th.id]);
    const blocked = rows.find((r) => r.kind === "blocked");
    const afterBlock = blocked ? rows.filter((r) => r.occurred_at > blocked.occurred_at && r.kind !== "blocked").length : 0;
    return json({ insight: { threadId: th.id, title: th.title, total: rows.length, afterBlock } });
  }

  // ----- vault (chunked, so any file size up to 25 MB fits Vercel's request limits) -----
  if (a === "vault") {
    if (!b && m === "GET") {
      return json({ items: await all(`select id, kind, label, sha256, size_bytes, mime, source, alert_id, captured_at from vault_items where owner_id = ? and complete = 1 order by captured_at desc`, [uid]) });
    }
    if (!b && m === "POST") {
      const kind = String(body.kind);
      if (!VAULT_KINDS.includes(kind)) throw new HttpError(400, "Unknown item type.");
      const size = num(body.size_bytes) ?? 0;
      if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, "The file is empty.");
      if (size > MAX_FILE_BYTES) throw new HttpError(413, "Files can be up to 25 MB.");
      const used = await one<{ n: number }>(`select coalesce(sum(size_bytes), 0) as n from vault_items where owner_id = ?`, [uid]);
      if ((used?.n ?? 0) + size > VAULT_QUOTA_BYTES) throw new HttpError(413, "Your vault is full (500 MB). Export and delete older items to make room.");
      const sha = String(body.sha256 ?? "");
      if (!/^[a-f0-9]{64}$/.test(sha)) throw new HttpError(400, "Missing file fingerprint.");
      const chunks = Math.ceil(size / CHUNK_BYTES);
      const source = VAULT_SOURCES.includes(String(body.source)) ? String(body.source) : "upload";
      let alertId = str(body.alert_id, 64);
      if (alertId && !(await one(`select 1 from alerts where id = ? and owner_id = ?`, [alertId, uid]))) alertId = null;
      const id = uuid();
      await run(
        `insert into vault_items (id, owner_id, kind, label, sha256, size_bytes, mime, source, alert_id, chunks, captured_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, uid, kind, str(body.label, 200) ?? "", sha, size, str(body.mime, 100) ?? "application/octet-stream", source, alertId, chunks, iso(body.captured_at) ?? now(), now()],
      );
      return json({ id, chunks, chunkBytes: CHUNK_BYTES }, 201);
    }
    if (b === "log" && m === "POST") {
      const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 500) : [];
      const owned = ids.length ? await all<{ id: string }>(`select id from vault_items where owner_id = ? and id in (${ids.map(() => "?").join(",")})`, [uid, ...ids]) : [];
      await batch(owned.map((o) => ({ sql: `insert into vault_log (owner_id, item_id, action, at) values (?, ?, 'export', ?)`, args: [uid, o.id, now()] })));
      if (owned.length) await audit(uid, uid, "vault.exported", "vault", null, { items: owned.length });
      return json({ ok: true });
    }
    if (b) {
      const item = await one<{ id: string; chunks: number; sha256: string; size_bytes: number; mime: string; complete: number }>(
        `select id, chunks, sha256, size_bytes, mime, complete from vault_items where id = ? and owner_id = ?`,
        [b, uid],
      );
      if (!item) throw new HttpError(404, "Item not found.");
      if (d === "chunks" && e != null && m === "PUT") {
        const idx = Number(e);
        if (!Number.isInteger(idx) || idx < 0 || idx >= item.chunks) throw new HttpError(400, "Bad chunk number.");
        if (item.complete) throw new HttpError(409, "This item is already saved.");
        const raw = String(body.data ?? "");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new HttpError(400, "That part isn't valid base64.");
        const data = Buffer.from(raw, "base64");
        const expected = idx === item.chunks - 1 ? item.size_bytes - CHUNK_BYTES * (item.chunks - 1) : CHUNK_BYTES;
        if (data.length !== expected) throw new HttpError(400, `Part ${idx + 1} should be ${expected} bytes but was ${data.length}.`);
        await run(`insert or replace into vault_chunks (item_id, idx, data) values (?, ?, ?)`, [b, idx, new Uint8Array(data)]);
        return json({ ok: true });
      }
      if (d === "finish" && m === "POST") {
        if (item.complete) return json({ item: await one(`select id, kind, label, sha256, size_bytes, mime, source, alert_id, captured_at from vault_items where id = ?`, [b]) });
        const parts = await all<{ idx: number; data: ArrayBuffer }>(`select idx, data from vault_chunks where item_id = ? order by idx`, [b]);
        if (parts.length !== item.chunks) throw new HttpError(400, `Upload incomplete: ${parts.length} of ${item.chunks} parts arrived.`);
        const whole = Buffer.concat(parts.map((p) => Buffer.from(p.data)));
        const sha = sha256Hex(whole);
        if (whole.length !== item.size_bytes || sha !== item.sha256) {
          await batch([
            { sql: `delete from vault_chunks where item_id = ?`, args: [b] },
            { sql: `delete from vault_items where id = ?`, args: [b] },
          ]);
          throw new HttpError(422, "The file changed during upload, so it wasn't saved. Try again.");
        }
        await run(`update vault_items set complete = 1 where id = ?`, [b]);
        await audit(uid, uid, "vault.saved", "vault_item", b, { bytes: item.size_bytes });
        return json({ item: await one(`select id, kind, label, sha256, size_bytes, mime, source, alert_id, captured_at from vault_items where id = ?`, [b]) });
      }
      if (d === "chunks" && e != null && m === "GET") {
        if (!item.complete) throw new HttpError(404, "This item hasn't finished uploading.");
        const row = await one<{ data: ArrayBuffer }>(`select data from vault_chunks where item_id = ? and idx = ?`, [b, Number(e)]);
        if (!row) throw new HttpError(404, "Part not found.");
        if (Number(e) === 0) {
          await run(`insert into vault_log (owner_id, item_id, action, at) values (?, ?, 'view', ?)`, [uid, b, now()]);
          await audit(uid, uid, "vault.viewed", "vault_item", b);
        }
        return new Response(new Uint8Array(Buffer.from(row.data)), { status: 200, headers: { "content-type": "application/octet-stream", "cache-control": "no-store", ...CORS } });
      }
      if (!d && m === "DELETE") {
        await batch([
          { sql: `delete from vault_chunks where item_id = ?`, args: [b] },
          { sql: `update entries set vault_item_id = null where vault_item_id = ?`, args: [b] },
          { sql: `delete from vault_items where id = ?`, args: [b] },
        ]);
        await audit(uid, uid, "vault.deleted", "vault_item", b);
        return json({ ok: true });
      }
    }
  }

  // ----- community layer: places, never people; shown at 3+ distinct reporters -----
  if (a === "reports" && m === "POST") {
    await rateLimit(`report:${uid}`, 20, 86400, "You've sent a lot of reports today. Try again tomorrow.");
    const cell = String(body.geohash6 ?? "");
    if (!/^[0-9b-hjkmnp-z]{6}$/.test(cell)) throw new HttpError(400, "Location missing.");
    const category = String(body.category);
    const band = String(body.time_band);
    if (!REPORT_CATEGORIES.includes(category) || !TIME_BANDS.includes(band)) throw new HttpError(400, "Pick what's wrong and when.");
    const label = str(body.area_label, 80);
    // Same person, same spot, same problem within 30 days: refresh it instead of adding a second report.
    const dup = await one<{ id: string }>(
      `select id from reports where reporter_id = ? and geohash6 = ? and category = ? and created_at > ? order by created_at desc limit 1`,
      [uid, cell, category, ago(REPORT_DEDUPE_DAYS * 86400_000)],
    );
    if (dup) {
      await run(`update reports set time_band = ?, area_label = coalesce(?, area_label), created_at = ? where id = ?`, [band, label, now(), dup.id]);
      return json({ ok: true, id: dup.id, duplicate: true });
    }
    const id = uuid();
    await run(`insert into reports (id, reporter_id, geohash6, area_label, category, time_band, created_at) values (?, ?, ?, ?, ?, ?, ?)`, [id, uid, cell, label, category, band, now()]);
    return json({ ok: true, id, duplicate: false }, 201);
  }
  if (a === "reports" && b === "mine" && m === "GET") {
    return json({
      reports: await all(`select id, geohash6, area_label, category, time_band, created_at from reports where reporter_id = ? order by created_at desc limit 200`, [uid]),
    });
  }
  if (a === "reports" && b && b !== "mine" && !d && m === "DELETE") {
    await run(`delete from reports where id = ? and reporter_id = ?`, [b, uid]);
    return json({ ok: true });
  }
  // Anyone signed in can flag an area entry (e.g. it names a person). Enough flags hide it until reviewed.
  if (a === "areas" && b === "flag" && m === "POST") {
    await rateLimit(`flag:${uid}`, 20, 86400, "You've flagged a lot today. Try again tomorrow.");
    const cell = String(body.geohash6 ?? "");
    const category = String(body.category ?? "");
    const reason = String(body.reason ?? "");
    if (!/^[0-9b-hjkmnp-z]{6}$/.test(cell) || !REPORT_CATEGORIES.includes(category)) throw new HttpError(400, "Pick the area and what's wrong.");
    if (!FLAG_REASONS.includes(reason)) throw new HttpError(400, "Pick a reason.");
    await run(`insert or ignore into report_flags (geohash6, category, flagger_id, reason, created_at) values (?, ?, ?, ?, ?)`, [cell, category, uid, reason, now()]);
    const n = await one<{ n: number }>(`select count(distinct flagger_id) as n from report_flags where geohash6 = ? and category = ?`, [cell, category]);
    if ((n?.n ?? 0) >= FLAGS_TO_HIDE) {
      await run(
        `insert into area_moderation (geohash6, category, status, note, updated_at) values (?, ?, 'hidden', 'auto: flagged', ?)
           on conflict(geohash6, category) do update set status = case when area_moderation.status = 'visible' then 'visible' else 'hidden' end, updated_at = excluded.updated_at`,
        [cell, category, now()],
      );
      log("area_hidden_pending_review", { cell, category });
    }
    return json({ ok: true });
  }
  if (a === "areas" && m === "GET") {
    const cells = (c.url.searchParams.get("cells") ?? "").split(",").filter((x) => /^[0-9b-hjkmnp-z]{6}$/.test(x)).slice(0, 25);
    if (!cells.length) return json({ areas: [] });
    const since = ago(REPORT_VISIBLE_DAYS * 86400_000);
    // Shown only at 3+ different reporters in the last 90 days, never when hidden by moderation.
    // A place name is shown only if 3+ different reporters typed the same one, so one person can't
    // put a name (or a person) on the map.
    const rows = await all<Record<string, unknown>>(
      `select geohash6, category, count(distinct reporter_id) as reporters,
              (select time_band from reports r2 where r2.geohash6 = r.geohash6 and r2.category = r.category and r2.created_at > ? group by time_band order by count(*) desc limit 1) as time_band,
              (select min(r3.area_label) from reports r3 where r3.geohash6 = r.geohash6 and r3.created_at > ? and r3.area_label is not null
                 group by lower(trim(r3.area_label)) having count(distinct r3.reporter_id) >= 3 order by count(distinct r3.reporter_id) desc limit 1) as area_label
         from reports r
        where geohash6 in (${cells.map(() => "?").join(",")}) and created_at > ?
          and not exists (select 1 from area_moderation mo where mo.geohash6 = r.geohash6 and mo.category = r.category and mo.status = 'hidden')
        group by geohash6, category
       having count(distinct reporter_id) >= 3
        order by reporters desc`,
      [since, since, ...cells, since],
    );
    return json({ areas: rows });
  }

  if (a === "guide" && m === "POST") {
    await rateLimit(`guide:${uid}`, 60, 3600, "You've asked a lot of questions this hour. The helplines are always open.");
    const q = need(str(body.question, 1000), "Type a question first.");
    return json(await guide(q));
  }

  throw new HttpError(404, "Not found");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  // vercel.json rewrites /api/<path> to /api?__p=<path>; also accept direct /api/<path>.
  const raw = url.searchParams.get("__p") ?? url.pathname.replace(/^\/api\/?/, "");
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    await migrate();
    const origin = siteOrigin(req);
    await maybeMaintain(origin);
    let body: Record<string, unknown> = {};
    if (req.method !== "GET" && req.method !== "HEAD") {
      const text = await req.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
        } catch {
          throw new HttpError(400, "Request body must be JSON.");
        }
      }
    }
    return await route({ req, url, parts, body, origin, ip: clientIp(req) });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    log("api_error", { route: parts.slice(0, 2).join("/"), error: String((err as Error)?.message ?? err).slice(0, 300) });
    return json({ error: "Something went wrong on our side. Your data is safe; try again in a moment." }, 500);
  }
}
