// SAAHI API. One handler for every route, so the whole backend is a single Vercel function.
// Every query is scoped to the signed-in user explicitly (SQLite has no row-level security).
import { guide, summarize, type Entry } from "./ai";
import { all, batch, HttpError, migrate, now, one, run } from "./db";
import { pushToGuardians, sendPush } from "./push";
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
  verifyToken,
} from "./security";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
const SESSION_DAYS = 60;
const MAX_CONTACTS = 8;
const CHUNK_BYTES = 1_500_000; // raw bytes per vault chunk; base64 stays under Vercel's 4.5 MB body limit
const MAX_FILE_BYTES = 25_000_000;
const WATCHDOG_GRACE_MS = 2 * 60 * 1000;
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
type Ctx = { req: Request; url: URL; parts: string[]; body: Record<string, unknown>; origin: string };
type User = { id: string; email: string; token_version: number };

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...headers },
  });

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

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
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d.toISOString();
};
const bool = (v: unknown) => (v ? 1 : 0);
const digits = (s: string) => s.replace(/\D/g, "");

function siteOrigin(req: Request): string {
  const fixed = process.env.PUBLIC_SITE_URL;
  if (fixed) return fixed.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
const trackUrl = (origin: string, token: string) => `${origin}/track/?t=${token}`;

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
  const rows = await all<Record<string, unknown>>(
    `select id, owner_id, name, phone, relation, priority, invite_code, linked_user_id, created_at
       from contacts where owner_id = ? order by priority, created_at`,
    [uid],
  );
  return rows;
}

async function ownedAlert(uid: string, id: string) {
  const a = await one<Record<string, unknown>>(`select * from alerts where id = ? and owner_id = ?`, [id, uid]);
  if (!a) throw new HttpError(404, "Alert not found.");
  return a;
}

/** Alerts I can see as a guardian: active ones from people whose circle I joined. */
async function guardianAlert(uid: string, id: string) {
  return one<Record<string, unknown>>(
    `select a.* from alerts a
      where a.id = ? and a.status = 'active'
        and exists (select 1 from contacts c where c.owner_id = a.owner_id and c.linked_user_id = ?)`,
    [id, uid],
  );
}

const alertView = (a: Record<string, unknown>) => ({ ...a, duress: Boolean(a.duress) });

// ---------------------------------------------------------------------------
// Walk-with-me watchdog: opens an alert for journeys whose check-in is overdue.
// Runs on the daily cron, on /api/cron/watchdog (point a free pinger at it for
// minute-level checks), and opportunistically during normal API traffic.
// ---------------------------------------------------------------------------
let lastSweep = 0;
export async function sweepJourneys(origin: string): Promise<{ checked: number; opened: number }> {
  const cutoff = new Date(Date.now() - WATCHDOG_GRACE_MS).toISOString();
  const overdue = await all<{ id: string; owner_id: string; destination: string; last_lat: number | null; last_lng: number | null; alert_id: string | null }>(
    `select id, owner_id, destination, last_lat, last_lng, alert_id from journeys where status = 'active' and next_checkin_at < ? limit 50`,
    [cutoff],
  );
  let opened = 0;
  for (const j of overdue) {
    // Claim first, so overlapping sweeps never double-alert.
    const claimed = await run(`update journeys set status = 'missed', ended_at = ? where id = ? and status = 'active'`, [now(), j.id]);
    if (!claimed) continue;
    const alertId = uuid();
    const token = randomHex(18);
    const t = now();
    const contacts = await all<{ id: string; name: string }>(`select id, name from contacts where owner_id = ?`, [j.owner_id]);
    await batch([
      {
        sql: `insert into alerts (id, owner_id, trigger, public_token, last_lat, last_lng, last_seen_at, started_at) values (?, ?, 'watchdog', ?, ?, ?, ?, ?)`,
        args: [alertId, j.owner_id, token, j.last_lat, j.last_lng, j.last_lat != null ? t : null, t],
      },
      { sql: `update journeys set alert_id = ? where id = ?`, args: [alertId, j.id] },
      ...contacts.map((c) => ({
        sql: `insert into alert_recipients (id, alert_id, contact_id, name, channel, updated_at) values (?, ?, ?, ?, 'push', ?)`,
        args: [uuid(), alertId, c.id, c.name, t],
      })),
    ]);
    const prof = await one<{ display_name: string; expo_push_token: string | null }>(`select display_name, expo_push_token from profiles where id = ?`, [j.owner_id]);
    await pushToGuardians(alertId, prof?.display_name ?? "", trackUrl(origin, token));
    if (prof?.expo_push_token) {
      await sendPush([
        {
          to: prof.expo_push_token,
          title: "You missed a check-in",
          body: `Your circle was alerted on your way to ${j.destination}. Open SAAHI to say you're safe.`,
          data: { alertId },
        },
      ]);
    }
    opened++;
  }
  return { checked: overdue.length, opened };
}

async function maybeSweep(origin: string) {
  if (Date.now() - lastSweep < 30_000) return;
  lastSweep = Date.now();
  try {
    await sweepJourneys(origin);
  } catch {
    // Never let the watchdog break a normal request.
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function route(c: Ctx): Promise<Response> {
  const { req, parts, body } = c;
  const m = req.method;
  const [a, b, d, e] = parts;

  // ----- public -----
  if (a === "health" && m === "GET") {
    await one(`select 1`);
    return json({ ok: true, time: now() });
  }

  if (a === "cron" && b === "watchdog") {
    return json(await sweepJourneys(c.origin));
  }

  if (a === "auth" && b === "signup" && m === "POST") {
    const email = need(str(body.email, 254), "Enter your email address.").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email address doesn't look right.");
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) throw new HttpError(400, "Use at least 8 characters for your password.");
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
    const email = (str(body.email, 254) ?? "").toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const since = Date.now() - 15 * 60 * 1000;
    const tries = await one<{ n: number }>(`select count(*) as n from login_attempts where email = ? and at > ?`, [email, since]);
    if ((tries?.n ?? 0) >= 10) throw new HttpError(429, "Too many attempts. Wait 15 minutes, or reset your password with your recovery code.");
    const u = await one<User & { password_hash: string }>(`select id, email, token_version, password_hash from users where email = ?`, [email]);
    if (!u || !(await verifyPassword(password, u.password_hash))) {
      await run(`insert into login_attempts (email, at) values (?, ?)`, [email, Date.now()]);
      throw new HttpError(401, "That email and password don't match.");
    }
    await run(`delete from login_attempts where email = ?`, [email]);
    return json({ token: sessionToken(u), user: { id: u.id, email: u.email } });
  }

  if (a === "auth" && b === "recover" && m === "POST") {
    const email = (str(body.email, 254) ?? "").toLowerCase();
    const code = normalizeCode(String(body.recoveryCode ?? ""));
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8) throw new HttpError(400, "Use at least 8 characters for your new password.");
    const since = Date.now() - 15 * 60 * 1000;
    const tries = await one<{ n: number }>(`select count(*) as n from login_attempts where email = ? and at > ?`, [email, since]);
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
    return json({ token: sessionToken({ id: u.id, token_version: tv }), recoveryCode: newCode, user: { id: u.id, email: u.email } });
  }

  if (a === "public" && b === "alert") {
    const token = m === "GET" ? c.url.searchParams.get("t") ?? "" : String(body.t ?? "");
    if (!/^[a-f0-9]{36}$/.test(token)) throw new HttpError(400, "This link isn't valid.");
    const al = await one<Record<string, any>>(`select * from alerts where public_token = ?`, [token]);
    if (!al) throw new HttpError(404, "This alert doesn't exist or was deleted.");
    const live = al.status === "active";
    if (m === "POST") {
      if (!live) throw new HttpError(409, "This alert has ended.");
      const rid = str(body.recipient_id, 64);
      if (rid) {
        const r = await one<{ id: string; status: string }>(`select id, status from alert_recipients where id = ? and alert_id = ?`, [rid, al.id]);
        if (!r) throw new HttpError(404, "Unknown responder.");
        if (body.action === "ack") {
          await run(`update alert_recipients set status = 'acknowledged', message = ?, updated_at = ? where id = ?`, [str(body.message, 280), now(), r.id]);
        } else if (r.status === "queued" || r.status === "sent") {
          await run(`update alert_recipients set status = 'opened', updated_at = ? where id = ?`, [now(), r.id]);
        }
      }
      return json({ ok: true });
    }
    const [prof, recips, trail] = await Promise.all([
      one<{ display_name: string }>(`select display_name from profiles where id = ?`, [al.owner_id]),
      all<Record<string, any>>(`select id, name, status, message from alert_recipients where alert_id = ? order by name`, [al.id]),
      live ? all(`select lat, lng, recorded_at from alert_locations where alert_id = ? order by recorded_at desc limit 20`, [al.id]) : Promise.resolve([]),
    ]);
    return json({
      name: (prof?.display_name ?? "").split(" ")[0] || "Your contact",
      status: live ? "active" : al.status,
      possibly_forced_cancel: live && Boolean(al.duress),
      started_at: al.started_at,
      ended_at: live ? null : al.ended_at,
      location: live && al.last_lat != null ? { lat: al.last_lat, lng: al.last_lng, accuracy: al.last_accuracy, at: al.last_seen_at } : null,
      trail,
      battery: live ? al.battery : null,
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
        ...["vault_items", "vault_log", "entries", "summaries", "threads", "journeys", "alerts", "contacts"].map((t) => ({ sql: `delete from ${t} where owner_id = ?`, args: [uid] })),
        { sql: `delete from reports where reporter_id = ?`, args: [uid] },
        { sql: `update contacts set linked_user_id = null where linked_user_id = ?`, args: [uid] },
        { sql: `delete from profiles where id = ?`, args: [uid] },
        { sql: `delete from users where id = ?`, args: [uid] },
      ]);
      return json({ ok: true });
    }
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
        `insert into contacts (id, owner_id, name, phone, relation, priority, invite_code, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), uid, name, phone, str(body.relation, 40), (count?.n ?? 0) + 1, randomCode(8), now()],
      );
      return json({ contacts: await loadContacts(uid) }, 201);
    }
    if (m === "DELETE" && b) {
      await run(`delete from contacts where id = ? and owner_id = ?`, [b, uid]);
      return json({ contacts: await loadContacts(uid) });
    }
  }

  // Someone gave me their invite code: I become their guardian in the app.
  if (a === "guardian" && b === "join" && m === "POST") {
    const code = normalizeCode(String(body.code ?? ""));
    if (code.length !== 8) throw new HttpError(400, "Guardian codes are 8 letters and numbers.");
    const ct = await one<{ id: string; owner_id: string; linked_user_id: string | null }>(`select id, owner_id, linked_user_id from contacts where invite_code = ?`, [code]);
    if (!ct) throw new HttpError(404, "That code didn't match anyone's circle. Check it and try again.");
    if (ct.owner_id === uid) throw new HttpError(400, "That's your own code. Send it to the person you added.");
    if (ct.linked_user_id && ct.linked_user_id !== uid) throw new HttpError(409, "This code was already used. Ask her to send a new one.");
    await run(`update contacts set linked_user_id = ? where id = ?`, [uid, ct.id]);
    const owner = await one<{ display_name: string }>(`select display_name from profiles where id = ?`, [ct.owner_id]);
    return json({ ok: true, name: (owner?.display_name ?? "").split(" ")[0] || "your contact" });
  }

  if (a === "guardian" && b === "alerts" && m === "GET") {
    const rows = await all<Record<string, unknown>>(
      `select a.id, a.owner_id, a.started_at, a.duress, p.display_name as owner_name
         from alerts a join profiles p on p.id = a.owner_id
        where a.status = 'active' and a.owner_id <> ?
          and exists (select 1 from contacts c where c.owner_id = a.owner_id and c.linked_user_id = ?)
        order by a.started_at desc`,
      [uid, uid],
    );
    return json({ alerts: rows.map(alertView) });
  }

  if (a === "contacts" && d === "new-code" && m === "POST" && b) {
    const code = randomCode(8);
    const n = await run(`update contacts set invite_code = ?, linked_user_id = null where id = ? and owner_id = ?`, [code, b, uid]);
    if (!n) throw new HttpError(404, "Contact not found.");
    return json({ contacts: await loadContacts(uid) });
  }

  // ----- alerts -----
  if (a === "alerts") {
    if (m === "POST" && !b) {
      const trigger = TRIGGERS.includes(String(body.trigger)) ? String(body.trigger) : "hold";
      const lat = num(body.lat);
      const lng = num(body.lng);
      const id = uuid();
      const token = randomHex(18);
      const t = now();
      const contacts = await all<{ id: string; name: string }>(`select id, name from contacts where owner_id = ? order by priority`, [uid]);
      await batch([
        {
          sql: `insert into alerts (id, owner_id, trigger, public_token, last_lat, last_lng, last_accuracy, last_seen_at, battery, started_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [id, uid, trigger, token, lat, lng, num(body.accuracy), lat != null ? t : null, num(body.battery), t],
        },
        ...(lat != null && lng != null
          ? [{ sql: `insert into alert_locations (alert_id, lat, lng, accuracy, recorded_at) values (?, ?, ?, ?, ?)`, args: [id, lat, lng, num(body.accuracy), t] }]
          : []),
        ...contacts.map((ct) => ({
          sql: `insert into alert_recipients (id, alert_id, contact_id, name, channel, updated_at) values (?, ?, ?, ?, 'sms', ?)`,
          args: [uuid(), id, ct.id, ct.name, t],
        })),
      ]);
      const prof = await one<{ display_name: string }>(`select display_name from profiles where id = ?`, [uid]);
      await pushToGuardians(id, prof?.display_name ?? "", trackUrl(c.origin, token));
      const alert = await one<Record<string, unknown>>(`select * from alerts where id = ?`, [id]);
      const recipients = await all(`select * from alert_recipients where alert_id = ? order by name`, [id]);
      return json({ alert: alertView(alert!), recipients, trackUrl: trackUrl(c.origin, token) }, 201);
    }

    if (b && m === "GET" && !d) {
      const own = await one<Record<string, unknown>>(`select * from alerts where id = ? and owner_id = ?`, [b, uid]);
      const al = own ?? (await guardianAlert(uid, b));
      if (!al) throw new HttpError(404, "This alert has ended or isn't shared with you.");
      const recipients = await all(`select * from alert_recipients where alert_id = ? order by name`, [b]);
      return json({ alert: alertView(al), recipients, mine: Boolean(own) });
    }

    if (b && d === "locations" && m === "POST") {
      const al = await ownedAlert(uid, b);
      if (al.status === "active") {
        const lat = need(num(body.lat), "lat is required");
        const lng = need(num(body.lng), "lng is required");
        const t = now();
        await batch([
          { sql: `insert into alert_locations (alert_id, lat, lng, accuracy, recorded_at) values (?, ?, ?, ?, ?)`, args: [b, lat, lng, num(body.accuracy), t] },
          { sql: `update alerts set last_lat = ?, last_lng = ?, last_accuracy = ?, last_seen_at = ?, battery = coalesce(?, battery) where id = ?`, args: [lat, lng, num(body.accuracy), t, num(body.battery), b] },
        ]);
      }
      return json({ ok: true, status: al.status });
    }

    if (b && d === "sms-sent" && m === "POST") {
      await ownedAlert(uid, b);
      await run(`update alert_recipients set status = 'sent', updated_at = ? where alert_id = ? and status = 'queued'`, [now(), b]);
      return json({ ok: true });
    }

    if (b && d === "duress" && m === "POST") {
      await ownedAlert(uid, b);
      await run(`update alerts set duress = 1 where id = ? and status = 'active'`, [b]);
      return json({ ok: true });
    }

    if (b && d === "cancel" && m === "POST") {
      await ownedAlert(uid, b);
      await batch([
        { sql: `update alerts set status = 'cancelled', ended_at = ? where id = ? and status = 'active'`, args: [now(), b] },
        { sql: `update journeys set status = 'cancelled', ended_at = coalesce(ended_at, ?) where alert_id = ? and status = 'active'`, args: [now(), b] },
      ]);
      return json({ ok: true });
    }

    if (b && d === "ack" && m === "POST") {
      const al = await guardianAlert(uid, b);
      if (!al) throw new HttpError(404, "This alert has ended or isn't shared with you.");
      await run(
        `update alert_recipients set status = 'acknowledged', message = ?, updated_at = ?
          where alert_id = ? and contact_id in (select id from contacts where owner_id = ? and linked_user_id = ?)`,
        [str(body.message, 280), now(), b, al.owner_id as string, uid],
      );
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
      await run(`update journeys set status = 'cancelled', ended_at = ? where owner_id = ? and status = 'active'`, [now(), uid]);
      const id = uuid();
      await run(
        `insert into journeys (id, owner_id, destination, interval_minutes, next_checkin_at, last_lat, last_lng, started_at) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, uid, destination, minutes, new Date(Date.now() + minutes * 60000).toISOString(), num(body.lat), num(body.lng), now()],
      );
      return json({ journey: await one(`select * from journeys where id = ?`, [id]) }, 201);
    }
    if (b && m === "POST") {
      const j = await one<{ id: string; interval_minutes: number; status: string }>(`select id, interval_minutes, status from journeys where id = ? and owner_id = ?`, [b, uid]);
      if (!j) throw new HttpError(404, "Journey not found.");
      if (d === "checkin") {
        if (j.status !== "active") throw new HttpError(409, "This journey has already ended.");
        await run(`update journeys set next_checkin_at = ? where id = ?`, [new Date(Date.now() + j.interval_minutes * 60000).toISOString(), b]);
      } else if (d === "location") {
        await run(`update journeys set last_lat = ?, last_lng = ? where id = ?`, [num(body.lat), num(body.lng), b]);
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
        const entries = await all(`select * from entries where thread_id = ? order by occurred_at desc`, [b]);
        const summary = await one(`select id, body, source, edited, created_at from summaries where thread_id = ? order by created_at desc limit 1`, [b]);
        return json({ thread: th, entries, summary });
      }
      if (d === "entries" && m === "POST") {
        const kind = String(body.kind);
        if (!ENTRY_KINDS.includes(kind)) throw new HttpError(400, "Pick what happened.");
        let vaultId = str(body.vault_item_id, 64);
        if (vaultId && !(await one(`select 1 from vault_items where id = ? and owner_id = ?`, [vaultId, uid]))) vaultId = null;
        const id = uuid();
        await run(
          `insert into entries (id, owner_id, thread_id, kind, occurred_at, channel, handle, note, vault_item_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, uid, b, kind, iso(body.occurred_at) ?? now(), str(body.channel, 120), str(body.handle, 120), str(body.note, 4000), vaultId, now()],
        );
        return json({ entry: await one(`select * from entries where id = ?`, [id]) }, 201);
      }
      if (d === "summary" && m === "POST") {
        const entries = await all<Entry>(`select kind, occurred_at, channel, handle, note from entries where thread_id = ? order by occurred_at`, [b]);
        const s = await summarize(entries);
        if (entries.length) await run(`insert into summaries (id, owner_id, thread_id, body, source, created_at) values (?, ?, ?, ?, ?, ?)`, [uuid(), uid, b, s.body, s.source, now()]);
        return json(s);
      }
      if (d === "summary" && m === "PUT") {
        const text = need(str(body.body, 8000), "The summary can't be empty.");
        await run(`insert into summaries (id, owner_id, thread_id, body, source, edited, created_at) values (?, ?, ?, ?, ?, 1, ?)`, [uuid(), uid, b, text, str(body.source, 10) ?? "ai", now()]);
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
      if (size <= 0) throw new HttpError(400, "The file is empty.");
      if (size > MAX_FILE_BYTES) throw new HttpError(413, "Files can be up to 25 MB.");
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
        const data = Buffer.from(String(body.data ?? ""), "base64");
        if (!data.length || data.length > CHUNK_BYTES) throw new HttpError(400, "Bad chunk size.");
        await run(`insert or replace into vault_chunks (item_id, idx, data) values (?, ?, ?)`, [b, idx, new Uint8Array(data)]);
        return json({ ok: true });
      }
      if (d === "finish" && m === "POST") {
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
        return json({ item: await one(`select id, kind, label, sha256, size_bytes, mime, source, alert_id, captured_at from vault_items where id = ?`, [b]) });
      }
      if (d === "chunks" && e != null && m === "GET") {
        const row = await one<{ data: ArrayBuffer }>(`select data from vault_chunks where item_id = ? and idx = ?`, [b, Number(e)]);
        if (!row) throw new HttpError(404, "Part not found.");
        if (Number(e) === 0) await run(`insert into vault_log (owner_id, item_id, action, at) values (?, ?, 'view', ?)`, [uid, b, now()]);
        return new Response(new Uint8Array(Buffer.from(row.data)), { status: 200, headers: { "content-type": "application/octet-stream", "cache-control": "no-store", ...CORS } });
      }
      if (!d && m === "DELETE") {
        await batch([
          { sql: `delete from vault_chunks where item_id = ?`, args: [b] },
          { sql: `update entries set vault_item_id = null where vault_item_id = ?`, args: [b] },
          { sql: `delete from vault_items where id = ?`, args: [b] },
        ]);
        return json({ ok: true });
      }
    }
    if (b === "log" && m === "POST") {
      const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 500) : [];
      const owned = ids.length ? await all<{ id: string }>(`select id from vault_items where owner_id = ? and id in (${ids.map(() => "?").join(",")})`, [uid, ...ids]) : [];
      await batch(owned.map((o) => ({ sql: `insert into vault_log (owner_id, item_id, action, at) values (?, ?, 'export', ?)`, args: [uid, o.id, now()] })));
      return json({ ok: true });
    }
  }

  // ----- community layer: places, never people; shown at 3+ distinct reporters -----
  if (a === "reports" && m === "POST") {
    const cell = String(body.geohash6 ?? "");
    if (!/^[0-9b-hjkmnp-z]{6}$/.test(cell)) throw new HttpError(400, "Location missing.");
    const category = String(body.category);
    const band = String(body.time_band);
    if (!REPORT_CATEGORIES.includes(category) || !TIME_BANDS.includes(band)) throw new HttpError(400, "Pick what's wrong and when.");
    await run(`insert into reports (id, reporter_id, geohash6, area_label, category, time_band, created_at) values (?, ?, ?, ?, ?, ?, ?)`, [uuid(), uid, cell, str(body.area_label, 80), category, band, now()]);
    return json({ ok: true }, 201);
  }
  if (a === "areas" && m === "GET") {
    const cells = (c.url.searchParams.get("cells") ?? "").split(",").filter((x) => /^[0-9b-hjkmnp-z]{6}$/.test(x)).slice(0, 25);
    if (!cells.length) return json({ areas: [] });
    const since = new Date(Date.now() - 180 * 86400000).toISOString();
    const rows = await all<Record<string, unknown>>(
      `select geohash6, max(area_label) as area_label, category, count(distinct reporter_id) as reporters,
              (select time_band from reports r2 where r2.geohash6 = r.geohash6 and r2.category = r.category group by time_band order by count(*) desc limit 1) as time_band
         from reports r
        where geohash6 in (${cells.map(() => "?").join(",")}) and created_at > ?
        group by geohash6, category
       having count(distinct reporter_id) >= 3
        order by reporters desc`,
      [...cells, since],
    );
    return json({ areas: rows });
  }

  if (a === "guide" && m === "POST") {
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
    await maybeSweep(origin);
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
    return await route({ req, url, parts, body, origin });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("SAAHI API error", parts.join("/"), err);
    return json({ error: "Something went wrong on our side. Your data is safe; try again in a moment." }, 500);
  }
}
