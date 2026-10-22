// End-to-end tests for the SAAHI API. Run with `npm run test:api`
// (tests/run-api.mjs starts a local server on a throwaway libSQL file and sets BASE and TEST_DB).
import crypto from "node:crypto";
const BASE = process.env.BASE ?? "http://localhost:8095";
let pass = 0, fail = 0;
const out = [];
const check = (name, cond, detail = "") => { cond ? pass++ : fail++; out.push(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  -> " + detail : ""}`); };

async function call(method, path, body, token, raw = false) {
  const r = await fetch(BASE + "/api/" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return r;
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const stamp = Date.now();
const email = (n) => `${n}+${stamp}@test.in`;

// ---- auth ----
const A = await call("POST", "auth/signup", { email: email("ananya"), password: "correct horse", name: "Ananya Ghosh" });
check("sign-up returns a session and recovery code", A.status === 201 && A.token && /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(A.recoveryCode), JSON.stringify(A));
const M = await call("POST", "auth/signup", { email: email("ma"), password: "mother pass", name: "Mita Ghosh" });
const S = await call("POST", "auth/signup", { email: email("stranger"), password: "stranger pass" });
check("duplicate email refused", (await call("POST", "auth/signup", { email: email("ananya").toUpperCase(), password: "whatever12" })).status === 409);
check("short password refused", (await call("POST", "auth/signup", { email: email("x"), password: "short" })).status === 400);
check("bad email refused", (await call("POST", "auth/signup", { email: "not-an-email", password: "longenough" })).status === 400);
const L = await call("POST", "auth/login", { email: email("ananya"), password: "correct horse" });
check("login with right password", L.status === 200 && !!L.token);
check("login with wrong password refused", (await call("POST", "auth/login", { email: email("ananya"), password: "wrong one" })).status === 401);
check("requests without a session refused", (await call("GET", "me")).status === 401);
check("forged token refused", (await call("GET", "me", null, A.token.slice(0, -3) + "abc")).status === 401);
for (let i = 0; i < 10; i++) await call("POST", "auth/login", { email: email("stranger"), password: "nope nope" });
check("login locked after 10 wrong attempts", (await call("POST", "auth/login", { email: email("stranger"), password: "stranger pass" })).status === 429);

// recovery: new password + new code, old sessions signed out
const R = await call("POST", "auth/recover", { email: email("ma"), recoveryCode: M.recoveryCode.toLowerCase().replace(/-/g, " "), password: "new mother pass" });
check("password reset with recovery code", R.status === 200 && !!R.token && R.recoveryCode !== M.recoveryCode, JSON.stringify(R));
check("old sessions signed out after reset", (await call("GET", "me", null, M.token)).status === 401);
check("old recovery code no longer works", (await call("POST", "auth/recover", { email: email("ma"), recoveryCode: M.recoveryCode, password: "another pass" })).status === 401);
check("new password works", (await call("POST", "auth/login", { email: email("ma"), password: "new mother pass" })).status === 200);
const MT = R.token, AT = A.token, ST = S.token;

// ---- profile + contacts ----
const me = await call("GET", "me", null, AT);
check("profile created with name", me.profile?.display_name === "Ananya Ghosh" && me.profile.onboarded === false);
const pp = await call("PATCH", "profile", { phone: "+91 98300 00001", language: "bn", onboarded: true }, AT);
check("profile update", pp.profile?.language === "bn" && pp.profile.onboarded === true);
check("contact needs a full number", (await call("POST", "contacts", { name: "x", phone: "123" }, AT)).status === 400);
await call("POST", "contacts", { name: "Ma", phone: "+919830011111", relation: "Mother" }, AT);
const c2 = await call("POST", "contacts", { name: "Riya Sen", phone: "+919830099999", relation: "Roommate" }, AT);
check("two contacts added, each with an 8-character guardian code", c2.contacts?.length === 2 && c2.contacts.every((x) => /^[A-Z0-9]{8}$/.test(x.invite_code)));
const maC = c2.contacts.find((x) => x.name === "Ma");
check("stranger sees none of her contacts", ((await call("GET", "me", null, ST)).contacts ?? []).length === 0);
check("stranger can't delete her contact", (await call("DELETE", `contacts/${maC.id}`, null, ST)).contacts?.length === 0 && (await call("GET", "me", null, AT)).contacts.length === 2);

// guardian join by code (replaces phone-number matching)
check("wrong code refused", (await call("POST", "guardian/join", { code: "ZZZZZZZZ" }, MT)).status === 404);
check("her own code refused", (await call("POST", "guardian/join", { code: maC.invite_code }, AT)).status === 400);
const j = await call("POST", "guardian/join", { code: maC.invite_code.toLowerCase() }, MT);
check("Ma joins as guardian with the code", j.ok && j.name === "Ananya", JSON.stringify(j));
check("a used code can't be reused by someone else", (await call("POST", "guardian/join", { code: maC.invite_code }, ST)).status === 409);
const linked = (await call("GET", "me", null, AT)).contacts.find((x) => x.name === "Ma");
check("her contact shows as linked", linked.linked_user_id === M.user.id);

// ---- SOS ----
const al = await call("POST", "alerts", { trigger: "hold", lat: 22.518, lng: 88.353, accuracy: 8, battery: 0.41 }, AT);
check("SOS creates an alert with a 36-char tracking token", al.status === 201 && /^[a-f0-9]{36}$/.test(al.alert.public_token), JSON.stringify(al).slice(0, 200));
check("SOS adds every contact as a recipient", al.recipients?.length === 2);
check("SOS returns a tracking link", al.trackUrl?.endsWith(`/track/?t=${al.alert.public_token}`));
const alertId = al.alert.id, token = al.alert.public_token;
await call("POST", `alerts/${alertId}/locations`, { lat: 22.5191, lng: 88.3541, accuracy: 6 }, AT);
const g1 = await call("GET", `alerts/${alertId}`, null, AT);
check("location update moves her last location", Math.abs(g1.alert.last_lat - 22.5191) < 1e-9 && g1.mine === true);
check("guardian can't add locations to her alert", (await call("POST", `alerts/${alertId}/locations`, { lat: 1, lng: 1 }, MT)).status === 404);
check("stranger can't see her alert", (await call("GET", `alerts/${alertId}`, null, ST)).status === 404);
check("stranger can't cancel her alert", (await call("POST", `alerts/${alertId}/cancel`, null, ST)).status === 404);
const ga = await call("GET", "guardian/alerts", null, MT);
check("guardian sees her active alert on Home", ga.alerts?.length === 1 && ga.alerts[0].owner_name === "Ananya Ghosh");
check("stranger sees no guardian alerts", (await call("GET", "guardian/alerts", null, ST)).alerts.length === 0);
const gview = await call("GET", `alerts/${alertId}`, null, MT);
check("guardian can open the alert", gview.status === 200 && gview.mine === false);
check("guardian can't cancel it", (await call("POST", `alerts/${alertId}/cancel`, null, MT)).status === 404);
check("stranger can't acknowledge", (await call("POST", `alerts/${alertId}/ack`, { message: "fake" }, ST)).status === 404);
check("guardian acknowledges in the app", (await call("POST", `alerts/${alertId}/ack`, { message: "Coming in 5 min" }, MT)).ok === true);
const after = await call("GET", `alerts/${alertId}`, null, AT);
const maRow = after.recipients.find((r) => r.name === "Ma");
check("she sees Ma 'acknowledged' with message", maRow.status === "acknowledged" && maRow.message === "Coming in 5 min");
await call("POST", `alerts/${alertId}/sms-sent`, null, AT);
check("Android 'unknown' from her Messages app is recorded as opened-in-Messages, never 'sent'", (await call("GET", `alerts/${alertId}`, null, AT)).recipients.find((r) => r.name === "Riya Sen").status === "device_compose");

// public tracking page API
const pub = async (method, body, t = token) => {
  const r = await fetch(`${BASE}/api/public/alert${method === "GET" ? `?t=${t}` : ""}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ t, ...body }) : undefined });
  return { status: r.status, j: await r.json() };
};
let p = await pub("GET");
check("tracking link shows first name only", p.j.name === "Ananya");
check("tracking link shows live location and battery", p.j.location && Math.abs(p.j.location.lat - 22.5191) < 1e-9 && p.j.battery === 0.41);
check("tracking link lists recipients", p.j.recipients.length === 2);
const riya = p.j.recipients.find((r) => r.name === "Riya");
await pub("POST", { action: "open", recipient_id: riya.id });
check("opening the link moves the recipient forward to link_opened", (await call("GET", `alerts/${alertId}`, null, AT)).recipients.find((r) => r.name === "Riya Sen").status === "link_opened");
await pub("POST", { action: "ack", recipient_id: riya.id, message: "On my way, 10 min" });
check("helper's 'I'm on it' reaches her", (await call("GET", `alerts/${alertId}`, null, AT)).recipients.find((r) => r.name === "Riya Sen").status === "acknowledged");
check("malformed token rejected", (await pub("GET", null, "zz")).status === 400);
check("unknown token 404", (await pub("GET", null, "0".repeat(36))).status === 404);
check("ack for someone not on the alert refused", (await pub("POST", { action: "ack", recipient_id: "nope" })).status === 404);

// duress then real cancel
await call("POST", `alerts/${alertId}/duress`, null, AT);
p = await pub("GET");
check("duress: still live for helpers, flagged as possibly forced", p.j.status === "active" && p.j.possibly_forced_cancel === true && !!p.j.location);
await call("POST", `alerts/${alertId}/cancel`, null, AT);
p = await pub("GET");
check("real cancel: link shows ended, no location", p.j.status === "cancelled" && p.j.location === null && p.j.trail.length === 0);
check("acks refused after it ends", (await pub("POST", { action: "ack", recipient_id: riya.id })).status === 409);
check("guardian loses access once it ends", (await call("GET", `alerts/${alertId}`, null, MT)).status === 404);
check("locations ignored after it ends", (await call("POST", `alerts/${alertId}/locations`, { lat: 9, lng: 9 }, AT)).status === "cancelled");

// ---- pattern + AI ----
const th = await call("POST", "threads", { title: "Unwanted contact" }, AT);
const day = (d) => new Date(Date.now() - d * 86400000).toISOString();
for (const [kind, d, extra] of [["message", 12, { channel: "Instagram", handle: "@rk_xx" }], ["message", 9, {}], ["blocked", 6, {}], ["new_account", 4, { handle: "+91 ••••• 4471" }], ["in_person", 3, { note: "Waiting outside Commerce block" }], ["message", 2, {}], ["threat", 1, { note: "said I'd regret ignoring him" }]]) {
  await call("POST", `threads/${th.thread.id}/entries`, { kind, occurred_at: day(d), ...extra }, AT);
}
check("bad entry kind refused", (await call("POST", `threads/${th.thread.id}/entries`, { kind: "nonsense" }, AT)).status === 400);
check("stranger can't add to her thread", (await call("POST", `threads/${th.thread.id}/entries`, { kind: "message" }, ST)).status === 404);
check("stranger can't read her thread", (await call("GET", `threads/${th.thread.id}`, null, ST)).status === 404);
const sum = await call("POST", `threads/${th.thread.id}/summary`, null, AT);
check("summary drafted (rules fallback without API key)", sum.source === "rules" && /7 entries/.test(sum.body), JSON.stringify(sum));
check("summary counts events after blocking", /4 event\(s\) logged after you blocked/.test(sum.body));
check("summary flags the threat with 112", /112/.test(sum.body));
check("summary never labels a person", !/stalker|criminal|rapist|abuser/i.test(sum.body));
await call("PUT", `threads/${th.thread.id}/summary`, { body: "My own edited summary", source: "rules" }, AT);
const thv = await call("GET", `threads/${th.thread.id}`, null, AT);
check("edited summary is the latest, entries newest first", thv.summary.body === "My own edited summary" && thv.summary.edited === 1 && thv.entries[0].kind === "threat");
const ins = await call("GET", "insight", null, AT);
check("home insight: 4 events after blocking of 7", ins.insight?.afterBlock === 4 && ins.insight.total === 7, JSON.stringify(ins));
const gd = await call("POST", "guide", { question: "Do I have to file where it happened?" }, AT);
check("support guide answers", /Zero FIR/.test(gd.body));

// ---- vault: chunked upload + integrity ----
const big = crypto.randomBytes(3_400_000); // 3 chunks
const sha = crypto.createHash("sha256").update(big).digest("hex");
const st = await call("POST", "vault", { kind: "audio", label: "Audio recorded during SOS", mime: "audio/mp4", size_bytes: big.length, sha256: sha, source: "sos_recording", alert_id: alertId }, AT);
check("vault upload starts in 3 parts", st.status === 201 && st.chunks === 3, JSON.stringify(st));
for (let i = 0; i < st.chunks; i++) {
  const r = await call("PUT", `vault/${st.id}/chunks/${i}`, { data: big.subarray(i * st.chunkBytes, (i + 1) * st.chunkBytes).toString("base64") }, AT);
  if (!r.ok) check(`chunk ${i}`, false, JSON.stringify(r));
}
check("stranger can't write into her upload", (await call("PUT", `vault/${st.id}/chunks/0`, { data: "AAAA" }, ST)).status === 404);
const fin = await call("POST", `vault/${st.id}/finish`, null, AT);
check("server re-checks the SHA-256 and saves", fin.item?.sha256 === sha, JSON.stringify(fin).slice(0, 200));
const parts = [];
for (let i = 0; i < 3; i++) parts.push(Buffer.from(await (await call("GET", `vault/${st.id}/chunks/${i}`, null, AT, true)).arrayBuffer()));
check("download reassembles the exact file", crypto.createHash("sha256").update(Buffer.concat(parts)).digest("hex") === sha);
check("guardian can't download her vault", (await call("GET", `vault/${st.id}/chunks/0`, null, MT, true)).status === 404);
check("vault list shows only hers", (await call("GET", "vault", null, AT)).items.length === 1 && (await call("GET", "vault", null, MT)).items.length === 0);
const tamper = await call("POST", "vault", { kind: "note", label: "x", mime: "text/plain", size_bytes: 5, sha256: "a".repeat(64) }, AT);
await call("PUT", `vault/${tamper.id}/chunks/0`, { data: Buffer.from("hello").toString("base64") }, AT);
check("mismatched fingerprint is rejected, not saved", (await call("POST", `vault/${tamper.id}/finish`, null, AT)).status === 422 && (await call("GET", "vault", null, AT)).items.length === 1);
check("files over 25 MB refused", (await call("POST", "vault", { kind: "photo", label: "x", mime: "image/jpeg", size_bytes: 30_000_000, sha256: "a".repeat(64) }, AT)).status === 413);

// ---- community ----
const cell = ("t" + stamp.toString(32)).slice(-6).replace(/[ailo]/g, "b");
for (const t of [AT, MT]) await call("POST", "reports", { geohash6: cell, category: "poor_lighting", time_band: "night", area_label: "Gariahat bus stop" }, t);
check("area hidden at 2 reporters", (await call("GET", `areas?cells=${cell}`, null, AT)).areas.length === 0);
await call("POST", "reports", { geohash6: cell, category: "poor_lighting", time_band: "night" }, AT);
check("same reporter twice doesn't make 3", (await call("GET", `areas?cells=${cell}`, null, AT)).areas.length === 0);
await call("POST", "reports", { geohash6: cell, category: "poor_lighting", time_band: "evening" }, ST);
const ar = await call("GET", `areas?cells=${cell}`, null, AT);
check("area shown at 3 different women, most common time band", ar.areas[0]?.reporters === 3 && ar.areas[0].time_band === "night", JSON.stringify(ar));
check("area data has no reporter ids", !JSON.stringify(ar).includes(A.user.id));
check("signed-out users can't query areas", (await call("GET", `areas?cells=${cell}`)).status === 401);

// ---- walk with me + watchdog ----
const jr = await call("POST", "journeys", { destination: "Kalighat Metro", interval_minutes: 5, lat: 22.52, lng: 88.35 }, AT);
check("journey starts", jr.journey?.status === "active");
const before = jr.journey.next_checkin_at;
await new Promise((r) => setTimeout(r, 20));
const ci = await call("POST", `journeys/${jr.journey.id}/checkin`, null, AT);
check("check-in pushes the deadline later", ci.journey.next_checkin_at > before);
check("stranger can't check in for her", (await call("POST", `journeys/${jr.journey.id}/checkin`, null, ST)).status === 404);
// Make it overdue directly in the DB through a test-only path: end it and start an overdue one.
const { createClient } = await import("@libsql/client");
const dbc = createClient({ url: `file:${process.env.TEST_DB}` });
await dbc.execute({ sql: "update journeys set next_checkin_at = ? where id = ?", args: [new Date(Date.now() - 4 * 60000).toISOString(), jr.journey.id] });
const runCron = async () => {
  await dbc.execute("delete from meta where key = 'cron_last_run'");
  return (await fetch(`${BASE}/api/cron/watchdog`)).json();
};
const wd = await runCron();
check("watchdog opens an alert for the overdue journey", wd.opened >= 1, JSON.stringify(wd));
const jrow = (await dbc.execute({ sql: "select status, alert_id from journeys where id = ?", args: [jr.journey.id] })).rows[0];
check("journey marked missed and linked to the alert", jrow.status === "missed" && !!jrow.alert_id);
const wa = await call("GET", `alerts/${jrow.alert_id}`, null, AT);
check("watchdog alert uses her last journey location and whole circle", wa.alert.trigger === "watchdog" && wa.alert.last_lat === 22.52 && wa.recipients.length === 2);
check("guardian sees the watchdog alert", (await call("GET", "guardian/alerts", null, MT)).alerts.some((x) => x.id === jrow.alert_id));
const wd2 = await runCron();
const wdCount = (await dbc.execute({ sql: "select count(*) as n from alerts where owner_id = ? and trigger = 'watchdog'", args: [A.user.id] })).rows[0].n;
check("next sweep doesn't double-alert (exactly one watchdog alert)", wd2.opened === 0 && Number(wdCount) === 1, JSON.stringify({ wd2, wdCount }));
const fresh = await call("POST", "journeys", { destination: "Home", interval_minutes: 5 }, AT);
await runCron();
check("on-time journey left alone", (await call("GET", "journeys/active", null, AT)).journey?.id === fresh.journey.id);
await call("POST", `journeys/${fresh.journey.id}/end`, { status: "arrived" }, AT);
check("arriving ends the journey", (await call("GET", "journeys/active", null, AT)).journey === null);

// ---- guardian code rotation ----
const rot = await call("POST", `contacts/${maC.id}/new-code`, null, AT);
const maNew = rot.contacts.find((x) => x.id === maC.id);
check("new code unlinks the old guardian", maNew.invite_code !== maC.invite_code && maNew.linked_user_id === null);

// ---- delete everything ----
check("delete account", (await call("DELETE", "me", null, AT)).ok === true);
check("deleted account can't sign in", (await call("POST", "auth/login", { email: email("ananya"), password: "correct horse" })).status === 401);
const left = (await dbc.execute({ sql: `select (select count(*) from alerts where owner_id = ?) + (select count(*) from contacts where owner_id = ?) + (select count(*) from vault_items where owner_id = ?) + (select count(*) from vault_chunks where item_id = ?) + (select count(*) from entries where owner_id = ?) + (select count(*) from reports where reporter_id = ?) as n`, args: [A.user.id, A.user.id, A.user.id, st.id, A.user.id, A.user.id] })).rows[0].n;
check("all her data removed, including vault file parts", Number(left) === 0, String(left));

// ---- errors ----
check("unknown route 404", (await call("GET", "nope", null, MT)).status === 404);
const bad = await fetch(`${BASE}/api/contacts`, { method: "POST", headers: { authorization: "Bearer " + MT, "content-type": "application/json" }, body: "{not json" });
check("bad JSON gives a clear 400", bad.status === 400);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
