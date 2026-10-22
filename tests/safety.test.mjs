// Phase 2 regression tests: the safety-critical failure modes from docs/AUDIT.md.
// Synthetic people and data only. Run with `npm run test:api`.
import crypto from "node:crypto";
import { createClient } from "@libsql/client";

const BASE = process.env.BASE;
const db = createClient({ url: `file:${process.env.TEST_DB}` });
const SECRET = process.env.JWT_SECRET;
let pass = 0, fail = 0;
const out = [];
const check = (name, cond, detail = "") => { cond ? pass++ : fail++; out.push(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  -> " + String(detail).slice(0, 300) : ""}`); };
const section = (t) => out.push(`\n## ${t}`);
const sql = async (q, args = []) => (await db.execute({ sql: q, args })).rows;
const one = async (q, args = []) => (await sql(q, args))[0];

let ipCounter = 0;
async function call(method, path, body, token, opts = {}) {
  const r = await fetch(BASE + "/api/" + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": opts.ip ?? `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (opts.raw) return r;
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const stamp = Date.now().toString(36);
const signup = async (name) => {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${stamp}@example.test`;
  const password = `pw-${name}-123`;
  const r = await call("POST", "auth/signup", { email, password, name });
  if (!r.user) throw new Error(`signup failed for ${name}: ${JSON.stringify(r)}`);
  return { token: r.token, id: r.user.id, email, password };
};
const ref = () => crypto.randomBytes(9).toString("base64url");
const runCron = async () => {
  await db.execute("delete from meta where key = 'cron_last_run'");
  return (await fetch(`${BASE}/api/cron/watchdog`)).json();
};
const b64u = (x) => Buffer.from(x).toString("base64url");
const forge = (payload, secret = SECRET) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};

const asha = await signup("Asha Rao");
const guard = await signup("Guardian Gita");
const other = await signup("Other Omar");
await call("PATCH", "profile", { expo_push_token: "ExponentPushToken[ok-gita]" }, guard.token);
const c1 = await call("POST", "contacts", { name: "Gita", phone: "+919800000001" }, asha.token);
await call("POST", "contacts", { name: "Neighbour", phone: "+919800000002" }, asha.token);
const gitaContact = c1.contacts.find((x) => x.name === "Gita");
await call("POST", "guardian/join", { code: gitaContact.invite_code }, guard.token);

section("Schema");
const h = await call("GET", "health");
check("health reports the latest schema version", h.ok === true && h.schema >= 2, JSON.stringify(h));
const mig = await sql("select version from schema_migrations order by version");
check("migrations recorded once each", mig.map((r) => Number(r.version)).join(",") === "1,2", JSON.stringify(mig));

section("SOS idempotency and duplicate prevention");
const r1 = ref();
const s1 = await call("POST", "alerts", { client_ref: r1, trigger: "hold" }, asha.token);
check("first SOS creates an alert (201, created)", s1.status === 201 && s1.created === true, JSON.stringify(s1).slice(0, 200));
const s1b = await call("POST", "alerts", { client_ref: r1, trigger: "hold" }, asha.token);
check("retrying with the same client_ref returns the same alert, not a new one", s1b.status === 200 && s1b.created === false && s1b.alert.id === s1.alert.id);
const s1c = await call("POST", "alerts", { client_ref: ref(), trigger: "hold" }, asha.token);
check("a second SOS while one is active returns the active alert", s1c.alert.id === s1.alert.id && s1c.created === false);
check("recipients weren't duplicated by retries", Number((await one("select count(*) as n from alert_recipients where alert_id = ?", [s1.alert.id])).n) === 2);
check("only one active alert exists for her", Number((await one("select count(*) as n from alerts where owner_id = ? and status = 'active'", [asha.id])).n) === 1);
check("bad client_ref rejected", (await call("POST", "alerts", { client_ref: "x y" }, asha.token)).status === 400);

section("Truthful delivery states");
const gitaRow = s1.recipients.find((r) => r.name === "Gita");
const neighbourRow = s1.recipients.find((r) => r.name === "Neighbour");
check("guardian with the app: push accepted by the provider, not 'delivered'", gitaRow.status === "provider_accepted", gitaRow.status);
check("contact without the app and no SMS provider stays queued (nothing claims it was sent)", neighbourRow.status === "queued", neighbourRow.status);
await call("POST", `alerts/${s1.alert.id}/device-sms`, { result: "cancelled" }, asha.token);
check("she backed out of Messages: still queued", (await one("select status from alert_recipients where id = ?", [neighbourRow.id])).status === "queued");
await call("POST", `alerts/${s1.alert.id}/device-sms`, { result: "unknown" }, asha.token);
check("Android 'unknown': opened in her Messages app, not sent", (await one("select status from alert_recipients where id = ?", [neighbourRow.id])).status === "device_compose");
await call("POST", `alerts/${s1.alert.id}/device-sms`, { result: "sent" }, asha.token);
check("iOS 'sent': sent from her phone (not delivered)", (await one("select status from alert_recipients where id = ?", [neighbourRow.id])).status === "device_sent");
await db.execute({ sql: "update alert_recipients set updated_at = ? where id = ?", args: [new Date(Date.now() - 60000).toISOString(), gitaRow.id] });
await runCron();
check("provider receipt moves the push to provider_delivered", (await one("select status from alert_recipients where id = ?", [gitaRow.id])).status === "provider_delivered");
await call("POST", `alerts/${s1.alert.id}/ack`, { message: "Coming" }, guard.token);
await call("POST", `alerts/${s1.alert.id}/device-sms`, { result: "unknown" }, asha.token);
const pub0 = await call("GET", `public/alert?t=${s1.alert.public_token}`);
await call("POST", "public/alert", { t: s1.alert.public_token, action: "open", recipient_id: gitaRow.id });
check("status never moves backwards: acknowledged stays acknowledged", (await one("select status from alert_recipients where id = ?", [gitaRow.id])).status === "acknowledged");
check("public view never shows a status the server didn't record", pub0.recipients.every((r) => ["queued", "failed", "device_compose", "device_sent", "provider_accepted", "provider_delivered", "link_opened", "acknowledged"].includes(r.status)));

section("Location freshness");
const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
await call("POST", `alerts/${s1.alert.id}/locations`, { lat: 22.58, lng: 88.37, accuracy: 30, fix_at: tenMinAgo }, asha.token);
let pub = await call("GET", `public/alert?t=${s1.alert.public_token}`);
check("a 10-minute-old fix keeps its own time, not the arrival time", pub.location.at === tenMinAgo && pub.location.stale === true && pub.location.age_seconds >= 590, JSON.stringify(pub.location));
const fresh = new Date().toISOString();
await call("POST", `alerts/${s1.alert.id}/locations`, { lat: 22.59, lng: 88.38, accuracy: 8, fix_at: fresh }, asha.token);
await call("POST", `alerts/${s1.alert.id}/locations`, { lat: 22.50, lng: 88.30, accuracy: 8, fix_at: new Date(Date.now() - 5 * 60000).toISOString() }, asha.token);
pub = await call("GET", `public/alert?t=${s1.alert.public_token}`);
check("a late-arriving older fix doesn't replace the newer last location", Math.abs(pub.location.lat - 22.59) < 1e-9 && pub.location.stale === false, JSON.stringify(pub.location));
check("the older fix still goes into the trail", pub.trail.some((t) => Math.abs(t.lat - 22.5) < 1e-9));
check("fix from the future is clamped to now", (await call("POST", `alerts/${s1.alert.id}/locations`, { lat: 22.6, lng: 88.4, fix_at: new Date(Date.now() + 3600e3).toISOString() }, asha.token)).ok === true &&
  +new Date((await one("select last_seen_at from alerts where id = ?", [s1.alert.id])).last_seen_at) <= Date.now() + 1000);
check("latitude out of range rejected", (await call("POST", `alerts/${s1.alert.id}/locations`, { lat: 91, lng: 88 }, asha.token)).status === 400);
check("0,0 (no-fix placeholder) rejected", (await call("POST", `alerts/${s1.alert.id}/locations`, { lat: 0, lng: 0 }, asha.token)).status === 400);
check("fix older than a day rejected", (await call("POST", `alerts/${s1.alert.id}/locations`, { lat: 22.6, lng: 88.4, fix_at: new Date(Date.now() - 30 * 3600e3).toISOString() }, asha.token)).status === 400);
check("non-numeric coordinates rejected", (await call("POST", `alerts/${s1.alert.id}/locations`, { lat: "22", lng: "88" }, asha.token)).status === 400);

section("Cross-account isolation");
check("another account can't read her alert", (await call("GET", `alerts/${s1.alert.id}`, null, other.token)).status === 404);
check("another account can't post locations to it", (await call("POST", `alerts/${s1.alert.id}/locations`, { lat: 1, lng: 1 }, other.token)).status === 404);
check("another account can't cancel it", (await call("POST", `alerts/${s1.alert.id}/cancel`, null, other.token)).status === 404);
check("another account can't cancel it by her client_ref", (await call("POST", `alerts/by-ref/${r1}/cancel`, null, other.token)).status === "cancelled" &&
  (await one("select status from alerts where id = ?", [s1.alert.id])).status === "active");
check("another account can't rotate her link", (await call("POST", `alerts/${s1.alert.id}/rotate-link`, null, other.token)).status === 404);
check("the guardian can't rotate her link either", (await call("POST", `alerts/${s1.alert.id}/rotate-link`, null, guard.token)).status === 404);
check("another account can't acknowledge it", (await call("POST", `alerts/${s1.alert.id}/ack`, {}, other.token)).status === 404);
check("guardian view doesn't include her tracking link", (await call("GET", `alerts/${s1.alert.id}`, null, guard.token)).trackUrl === undefined);

section("Tracking link rotation and expiry");
const oldToken = s1.alert.public_token;
const rot = await call("POST", `alerts/${s1.alert.id}/rotate-link`, null, asha.token);
check("rotating gives a new link", /^[a-f0-9]{36}$/.test(rot.public_token) && rot.public_token !== oldToken);
check("the old link stops working at once", (await call("GET", `public/alert?t=${oldToken}`)).status === 404);
const newLink = await call("GET", `public/alert?t=${rot.public_token}`);
check("the new link works", newLink.status === "active" && newLink.name === "Asha", JSON.stringify(newLink).slice(0, 200));

section("Duress and cancellation");
await call("POST", `alerts/${s1.alert.id}/duress`, null, asha.token);
check("duress flags the live alert for helpers", (await call("GET", `public/alert?t=${rot.public_token}`)).possibly_forced_cancel === true);
await call("POST", `alerts/by-ref/${r1}/cancel`, null, asha.token);
const ended = await call("GET", `public/alert?t=${rot.public_token}`);
check("cancel by client_ref ends it", ended.status === "cancelled");
check("after it ends the link reveals no name, location or recipients", ended.name === null && ended.location === null && ended.recipients.length === 0);
check("cancelling twice is harmless", (await call("POST", `alerts/${s1.alert.id}/cancel`, null, asha.token)).ok === true);
check("guardian access ends with it", (await call("GET", `alerts/${s1.alert.id}`, null, guard.token)).status === 404);
await db.execute({ sql: "update alerts set ended_at = ? where id = ?", args: [new Date(Date.now() - 8 * 86400e3).toISOString(), s1.alert.id] });
check("7 days after it ends, the link is gone (410)", (await call("GET", `public/alert?t=${rot.public_token}`)).status === 410);

// Cancel arrives BEFORE the create it cancels (create stuck on a slow network).
const r2 = ref();
const pre = await call("POST", `alerts/by-ref/${r2}/cancel`, null, asha.token);
check("cancel for an alert that doesn't exist yet is accepted", pre.ok === true && pre.status === "cancelled");
const late = await call("POST", "alerts", { client_ref: r2, trigger: "hold", lat: 22.57, lng: 88.36 }, asha.token);
check("the late create returns the cancelled alert instead of starting one", late.alert.status === "cancelled" && late.created === false);
check("no active alert and no recipients were created", Number((await one("select count(*) as n from alerts where owner_id = ? and status = 'active'", [asha.id])).n) === 0 &&
  Number((await one("select count(*) as n from alert_recipients where alert_id = ?", [late.alert.id])).n) === 0);

// Create and cancel racing each other, many times.
let raceOk = true;
for (let i = 0; i < 8; i++) {
  const r = ref();
  await Promise.all([
    call("POST", "alerts", { client_ref: r, trigger: "hold" }, asha.token),
    call("POST", `alerts/by-ref/${r}/cancel`, null, asha.token),
  ]);
  const row = await one("select status from alerts where owner_id = ? and client_ref = ?", [asha.id, r]);
  if (row?.status !== "cancelled") raceOk = false;
  const active = Number((await one("select count(*) as n from alerts where owner_id = ? and status = 'active'", [asha.id])).n);
  if (active !== 0) {
    raceOk = false;
    await sql("update alerts set status = 'cancelled' where owner_id = ? and status = 'active'", [asha.id]);
  }
}
check("8 concurrent create/cancel races all end cancelled, never left active", raceOk);

// Many concurrent creates with different refs: still one active alert.
const burst = await Promise.all(Array.from({ length: 6 }, () => call("POST", "alerts", { client_ref: ref(), trigger: "hold" }, asha.token)));
const ids = new Set(burst.map((x) => x.alert?.id));
check("6 simultaneous SOS presses produce exactly one active alert", ids.size === 1 && Number((await one("select count(*) as n from alerts where owner_id = ? and status = 'active'", [asha.id])).n) === 1, JSON.stringify([...ids]));
const burstAlert = burst[0].alert;
const act = await call("GET", "alerts/active", null, asha.token);
check("a reopened app can find her running alert", act.alert?.id === burstAlert.id && Array.isArray(act.recipients));
check("nobody else can see it as 'their' active alert", (await call("GET", "alerts/active", null, other.token)).alert === null);
check("duress sent on create is kept", (await call("POST", "alerts", { client_ref: ref(), duress: true }, asha.token)).alert.duress === true);
await call("POST", `alerts/${burstAlert.id}/cancel`, null, asha.token);

section("Silent alerts expire");
const s3 = await call("POST", "alerts", { client_ref: ref(), trigger: "hold", lat: 22.57, lng: 88.36 }, asha.token);
const old = new Date(Date.now() - 25 * 3600e3).toISOString();
await db.execute({ sql: "update alerts set started_at = ?, heartbeat_at = ?, last_received_at = ? where id = ?", args: [old, old, old, s3.alert.id] });
await runCron();
const s3row = await one("select status, end_reason from alerts where id = ?", [s3.alert.id]);
check("an active alert with no contact for 24 h expires", s3row.status === "expired" && s3row.end_reason === "no_contact_24h", JSON.stringify(s3row));
const s4 = await call("POST", "alerts", { client_ref: ref(), trigger: "hold" }, asha.token);
await call("POST", `alerts/${s4.alert.id}/heartbeat`, { battery: 0.2 }, asha.token);
await db.execute({ sql: "update alerts set started_at = ?, last_received_at = ? where id = ?", args: [old, old, s4.alert.id] });
await runCron();
check("a recent heartbeat keeps it alive", (await one("select status from alerts where id = ?", [s4.alert.id])).status === "active");
await call("POST", `alerts/${s4.alert.id}/cancel`, null, asha.token);

section("SafeWalk watchdog");
const sActive = await call("POST", "alerts", { client_ref: ref(), trigger: "hold" }, asha.token);
const j = await call("POST", "journeys", { destination: "Library", interval_minutes: 5, lat: 22.5, lng: 88.3 }, asha.token);
await db.execute({ sql: "update journeys set next_checkin_at = ? where id = ?", args: [new Date(Date.now() - 10 * 60000).toISOString(), j.journey.id] });
await runCron();
const jr = await one("select status, alert_id from journeys where id = ?", [j.journey.id]);
check("missed check-in while an SOS is active joins that alert instead of opening a second", jr.status === "missed" && jr.alert_id === sActive.alert.id);
await call("POST", `alerts/${sActive.alert.id}/cancel`, null, asha.token);

// Push retries: a guardian whose push fails gets bounded retries, then stops.
const flaky = await signup("Flaky Fatima");
await call("PATCH", "profile", { expo_push_token: "ExponentPushToken[fail-fatima]" }, flaky.token);
const cf = await call("POST", "contacts", { name: "Fatima", phone: "+919800000003" }, asha.token);
await call("POST", "guardian/join", { code: cf.contacts.find((x) => x.name === "Fatima").invite_code }, flaky.token);
const dead = await signup("Dead Dev");
await call("PATCH", "profile", { expo_push_token: "ExponentPushToken[dead-dev]" }, dead.token);
const cd = await call("POST", "contacts", { name: "Dev", phone: "+919800000004" }, asha.token);
await call("POST", "guardian/join", { code: cd.contacts.find((x) => x.name === "Dev").invite_code }, dead.token);
const s5 = await call("POST", "alerts", { client_ref: ref(), trigger: "hold" }, asha.token);
const fr = s5.recipients.find((r) => r.name === "Fatima");
const dr = s5.recipients.find((r) => r.name === "Dev");
check("a failed push is recorded as failed with the provider's error", fr.status === "failed" && fr.attempts === 1 && /outage/i.test(fr.error), JSON.stringify(fr));
for (let i = 0; i < 4; i++) {
  await db.execute({ sql: "update alert_recipients set last_attempt_at = ? where alert_id = ?", args: [new Date(Date.now() - 120e3).toISOString(), s5.alert.id] });
  await runCron();
}
const frAfter = await one("select status, attempts from alert_recipients where id = ?", [fr.id]);
check("retries stop at 3 attempts", Number(frAfter.attempts) === 3 && frAfter.status === "failed", JSON.stringify(frAfter));
const drAfter = await one("select status, attempts from alert_recipients where id = ?", [dr.id]);
check("an unregistered device isn't retried", drAfter.status === "failed" && Number(drAfter.attempts) === 3, JSON.stringify(drAfter));
await call("POST", `alerts/${s5.alert.id}/cancel`, null, asha.token);

section("Guardian invitations");
const inv = await call("POST", "contacts", { name: "Late Lata", phone: "+919800000005" }, asha.token);
const lata = inv.contacts.find((x) => x.name === "Late Lata");
check("new invite codes expire in about 7 days", Math.abs(+new Date(lata.invite_expires_at) - (Date.now() + 7 * 86400e3)) < 60e3);
await db.execute({ sql: "update contacts set invite_expires_at = ? where id = ?", args: [new Date(Date.now() - 1000).toISOString(), lata.id] });
const lataUser = await signup("Lata L");
check("an expired code is refused (410)", (await call("POST", "guardian/join", { code: lata.invite_code }, lataUser.token)).status === 410);
const renewed = (await call("POST", `contacts/${lata.id}/new-code`, null, asha.token)).contacts.find((x) => x.id === lata.id);
check("a new code works", (await call("POST", "guardian/join", { code: renewed.invite_code }, lataUser.token)).ok === true);
check("she can see who joined", (await call("GET", "me", null, asha.token)).contacts.find((x) => x.id === lata.id).guardian_name === "Lata L");
const s6 = await call("POST", "alerts", { client_ref: ref(), trigger: "hold" }, asha.token);
check("the guardian sees her active alert", (await call("GET", `alerts/${s6.alert.id}`, null, lataUser.token)).status === 200);
await call("POST", `contacts/${lata.id}/unlink`, null, asha.token);
check("revoking removes the guardian's access immediately", (await call("GET", `alerts/${s6.alert.id}`, null, lataUser.token)).status === 404 &&
  (await call("GET", "guardian/alerts", null, lataUser.token)).alerts.length === 0);
check("the revoked guardian's old code no longer works", (await call("POST", "guardian/join", { code: renewed.invite_code }, lataUser.token)).status === 404);
await call("POST", `alerts/${s6.alert.id}/cancel`, null, asha.token);
const brute = await signup("Brute B");
for (let i = 0; i < 10; i++) await call("POST", "guardian/join", { code: crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 8) }, brute.token);
const freshCode = (await call("POST", "contacts", { name: "Real R", phone: "+919800000006" }, asha.token)).contacts.find((x) => x.name === "Real R").invite_code;
check("after 10 wrong codes in an hour, joining is locked even with a right code", (await call("POST", "guardian/join", { code: freshCode }, brute.token)).status === 429);
const codes = new Set();
for (let i = 0; i < 100; i++) codes.add((await call("POST", "contacts", { name: `x${i}`, phone: "+919800000099" }, (await signup(`gen${i}`)).token)).contacts?.[0]?.invite_code);
check("100 generated codes are all distinct and 8 characters from the unambiguous alphabet", codes.size === 100 && [...codes].every((x) => /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(x)));

section("Authentication");
check("token signed with the wrong key is refused", (await call("GET", "me", null, forge({ sub: asha.id, tv: 0, typ: "session", exp: Math.floor(Date.now() / 1000) + 3600 }, "wrong-secret"))).status === 401);
check("expired token is refused", (await call("GET", "me", null, forge({ sub: asha.id, tv: 0, typ: "session", exp: Math.floor(Date.now() / 1000) - 10 }))).status === 401);
check("token of the wrong type is refused", (await call("GET", "me", null, forge({ sub: asha.id, tv: 0, typ: "other", exp: Math.floor(Date.now() / 1000) + 3600 }))).status === 401);
check("token for a user that doesn't exist is refused", (await call("GET", "me", null, forge({ sub: crypto.randomUUID(), tv: 0, typ: "session", exp: Math.floor(Date.now() / 1000) + 3600 }))).status === 401);
check("alg:none token is refused", (await call("GET", "me", null, `${b64u('{"alg":"none"}')}.${b64u(JSON.stringify({ sub: asha.id, tv: 0, typ: "session", exp: 9e9 }))}.`)).status === 401);
const lo = await call("POST", "auth/logout-all", null, asha.token);
check("sign out everywhere: the old token stops working", (await call("GET", "me", null, asha.token)).status === 401);
check("...and this device gets a fresh one", (await call("GET", "me", null, lo.token)).status === 200);
asha.token = lo.token;
check("password check for cancelling on a device without PINs: wrong password refused with 403", (await call("POST", "auth/verify-password", { password: "nope" }, asha.token)).status === 403);
check("...and a wrong password does not end her session", (await call("GET", "me", null, asha.token)).status === 200);
check("right password accepted", (await call("POST", "auth/verify-password", { password: asha.password }, asha.token)).ok === true);
for (let i = 0; i < 10; i++) await call("POST", "auth/verify-password", { password: "nope" }, other.token);
check("10 wrong passwords lock the check for 15 minutes", (await call("POST", "auth/verify-password", { password: other.password }, other.token)).status === 429);
const ip = "203.0.113.77";
let lastSignup;
for (let i = 0; i < 11; i++) lastSignup = await call("POST", "auth/signup", { email: `spray${i}.${stamp}@example.test`, password: "longenough1" }, null, { ip });
check("more than 10 sign-ups an hour from one network are refused", lastSignup.status === 429);
check("very long passwords are refused at sign-up", (await call("POST", "auth/signup", { email: `long.${stamp}@example.test`, password: "x".repeat(201) })).status === 400);
const t0 = Date.now();
await call("POST", "auth/login", { email: `nobody.${stamp}@example.test`, password: "whatever123" });
const tNoUser = Date.now() - t0;
const t1 = Date.now();
await call("POST", "auth/login", { email: other.email, password: "wrong-password" });
const tWrong = Date.now() - t1;
check("unknown email takes about as long as a wrong password (no timing tell)", tNoUser > tWrong * 0.4, `${tNoUser}ms vs ${tWrong}ms`);

section("Evidence vault");
const upload = (body, tok = asha.token) => call("POST", "vault", body, tok);
const data = crypto.randomBytes(1_600_000);
const sha = crypto.createHash("sha256").update(data).digest("hex");
const st = await upload({ kind: "photo", label: "test", mime: "image/jpeg", size_bytes: data.length, sha256: sha });
check("upload starts in 2 parts", st.chunks === 2);
check("wrong part size refused", (await call("PUT", `vault/${st.id}/chunks/0`, { data: data.subarray(0, 1000).toString("base64") }, asha.token)).status === 400);
check("invalid base64 refused", (await call("PUT", `vault/${st.id}/chunks/0`, { data: "@@@not base64@@@" }, asha.token)).status === 400);
check("part number out of range refused", (await call("PUT", `vault/${st.id}/chunks/5`, { data: "AAAA" }, asha.token)).status === 400);
await call("PUT", `vault/${st.id}/chunks/0`, { data: data.subarray(0, 1_500_000).toString("base64") }, asha.token);
check("finishing with a part missing is refused", (await call("POST", `vault/${st.id}/finish`, null, asha.token)).status === 400);
check("an unfinished item can't be downloaded", (await call("GET", `vault/${st.id}/chunks/0`, null, asha.token, { raw: true })).status === 404);
await call("PUT", `vault/${st.id}/chunks/1`, { data: data.subarray(1_500_000).toString("base64") }, asha.token);
check("finished upload verifies", (await call("POST", `vault/${st.id}/finish`, null, asha.token)).item?.sha256 === sha);
check("finishing twice is harmless", (await call("POST", `vault/${st.id}/finish`, null, asha.token)).item?.sha256 === sha);
check("another account can't download it", (await call("GET", `vault/${st.id}/chunks/0`, null, other.token, { raw: true })).status === 404);
check("her guardian can't download it", (await call("GET", `vault/${st.id}/chunks/0`, null, guard.token, { raw: true })).status === 404);
check("another account can't delete it", (await call("DELETE", `vault/${st.id}`, null, other.token)).status === 404 && Boolean(await one("select 1 as x from vault_items where id = ?", [st.id])));
check("negative or fractional sizes refused", (await upload({ kind: "photo", label: "x", mime: "image/jpeg", size_bytes: -5, sha256: sha })).status === 400 &&
  (await upload({ kind: "photo", label: "x", mime: "image/jpeg", size_bytes: 10.5, sha256: sha })).status === 400);
const quotaUser = await signup("Quota Q");
let quotaHit = null;
for (let i = 0; i < 21 && !quotaHit; i++) {
  const r = await upload({ kind: "document", label: `big${i}`, mime: "application/pdf", size_bytes: 25_000_000, sha256: sha }, quotaUser.token);
  if (r.status === 413) quotaHit = i;
}
check("the 500 MB per-person quota is enforced", quotaHit === 20, String(quotaHit));
await db.execute({ sql: "update vault_items set created_at = ? where owner_id = ?", args: [new Date(Date.now() - 25 * 3600e3).toISOString(), quotaUser.id] });
await runCron();
check("abandoned uploads are cleaned up after 24 h", Number((await one("select count(*) as n from vault_items where owner_id = ?", [quotaUser.id])).n) === 0);

section("Audit trail");
const auditA = await call("GET", "audit", null, asha.token);
const actions = new Set(auditA.events.map((e) => e.action));
for (const a of ["alert.created", "alert.cancelled", "alert.duress", "alert.link_rotated", "alert.expired", "guardian.joined", "guardian.revoked", "alert.ack_by_guardian", "auth.logout_all", "vault.saved", "journey.missed", "alert.cancelled_before_created"]) {
  check(`audit records ${a}`, actions.has(a), [...actions].join(","));
}
check("guardian actions name the guardian", auditA.events.some((e) => e.action === "alert.ack_by_guardian" && e.actor === "Guardian Gita"));
check("one person can't read another's audit trail", (await call("GET", "audit", null, other.token)).events.every((e) => !String(e.target_id ?? "").includes(s1.alert.id)));
check("the audit trail stores no locations or message text", !(await sql("select meta from audit_log where owner_id = ?", [asha.id])).some((r) => /22\.5|88\.3|Coming/.test(String(r.meta ?? ""))));

section("Account deletion covers new tables");
await call("DELETE", "me", null, asha.token);
check("deleting her account removes her audit trail too", Number((await one("select count(*) as n from audit_log where owner_id = ?", [asha.id])).n) === 0);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
