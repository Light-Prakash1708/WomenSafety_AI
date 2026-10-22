// Phase 5: Escalation Graph corrections and summary basis; community reports privacy and moderation.
// Synthetic data only.
import { createClient } from "@libsql/client";

const BASE = process.env.BASE;
const db = createClient({ url: `file:${process.env.TEST_DB}` });
let pass = 0, fail = 0;
const out = [];
const check = (name, cond, detail = "") => { cond ? pass++ : fail++; out.push(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  -> " + String(detail).slice(0, 300) : ""}`); };
const section = (t) => out.push(`\n## ${t}`);
let ip = 0;
async function call(method, path, body, token) {
  const r = await fetch(BASE + "/api/" + path, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(ip / 250)}.${ip++ % 250}`, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ...j };
}
const stamp = Date.now().toString(36);
const signup = async (n) => {
  const r = await call("POST", "auth/signup", { email: `${n}.${stamp}@example.test`, password: `pw-${n}-12345`, name: n });
  return { token: r.token, id: r.user.id };
};

const me = await signup("meera");
const other = await signup("other");

section("Escalation Graph: corrections keep history");
const th = (await call("POST", "threads", { title: "Unwanted contact" }, me.token)).thread;
const t0 = new Date(Date.now() - 3 * 86400e3).toISOString();
const e1 = (await call("POST", `threads/${th.id}/entries`, { kind: "message", occurred_at: t0, channel: "Instagram", handle: "@synthetic_x", note: "Asked where I live", source_ref: "screenshot in vault" }, me.token)).entry;
await call("POST", `threads/${th.id}/entries`, { kind: "blocked", occurred_at: new Date(Date.now() - 2 * 86400e3).toISOString() }, me.token);
check("entry saved with a source reference and revision 1", e1.source_ref === "screenshot in vault" && Number(e1.revision) === 1);
const sum = await call("POST", `threads/${th.id}/summary`, null, me.token);
check("summary says what it was based on", sum.basis_count === 2 && Boolean(sum.basis_latest) && sum.stale === false, JSON.stringify(sum));
let view = await call("GET", `threads/${th.id}`, null, me.token);
check("fresh summary is not stale", view.summary.stale === false && view.summary.basis_count === 2);

const fixed = await call("PATCH", `threads/${th.id}/entries/${e1.id}`, { occurred_at: new Date(Date.now() - 4 * 86400e3).toISOString(), note: "Asked where I live and which bus I take", reason: "Wrong day" }, me.token);
check("a correction is saved as revision 2", Number(fixed.entry.revision) === 2 && fixed.entry.note.includes("which bus"));
const revs = await call("GET", `threads/${th.id}/entries/${e1.id}/revisions`, null, me.token);
check("the original version is kept, with the reason", revs.revisions.length === 1 && revs.revisions[0].note === "Asked where I live" && revs.revisions[0].occurred_at === t0 && revs.revisions[0].reason === "Wrong day", JSON.stringify(revs));
check("an identical save doesn't create a revision", Number((await call("PATCH", `threads/${th.id}/entries/${e1.id}`, { note: "Asked where I live and which bus I take" }, me.token)).entry.revision) === 2);
view = await call("GET", `threads/${th.id}`, null, me.token);
check("after a correction the summary is marked out of date", view.summary.stale === true);
await call("PUT", `threads/${th.id}/summary`, { body: "My own words.", source: "ai" }, me.token);
view = await call("GET", `threads/${th.id}`, null, me.token);
check("editing the summary text doesn't hide that it's out of date", view.summary.stale === true && view.summary.edited === 1);
await call("POST", `threads/${th.id}/summary`, null, me.token);
await call("POST", `threads/${th.id}/entries`, { kind: "in_person", occurred_at: new Date().toISOString() }, me.token);
view = await call("GET", `threads/${th.id}`, null, me.token);
check("adding an entry after a summary marks it out of date", view.summary.stale === true && view.summary.basis_count === 2);
check("bad kind refused on correction", (await call("PATCH", `threads/${th.id}/entries/${e1.id}`, { kind: "murder" }, me.token)).http === 400);
check("another account can't correct her entry", (await call("PATCH", `threads/${th.id}/entries/${e1.id}`, { note: "x" }, other.token)).http === 404);
check("another account can't read its history", (await call("GET", `threads/${th.id}/entries/${e1.id}/revisions`, null, other.token)).http === 404);

section("Community reports");
const cell = "tunb" + stamp.slice(-2).replace(/[ailo]/g, "b").padEnd(2, "c");
const cellOk = /^[0-9b-hjkmnp-z]{6}$/.test(cell) ? cell : "tunbcc";
const people = [me, other, await signup("r3"), await signup("r4")];
const r1 = await call("POST", "reports", { geohash6: cellOk, category: "poor_lighting", time_band: "night", area_label: "Ravi's house" }, people[0].token);
const r1b = await call("POST", "reports", { geohash6: cellOk, category: "poor_lighting", time_band: "evening" }, people[0].token);
check("the same person reporting the same thing again within 30 days refreshes it", r1b.duplicate === true && r1b.id === r1.id);
check("...and stores one report, not two", Number((await db.execute({ sql: "select count(*) as n from reports where reporter_id = ?", args: [people[0].id] })).rows[0].n) === 1);
await call("POST", "reports", { geohash6: cellOk, category: "poor_lighting", time_band: "night", area_label: "Lake Road bus stop" }, people[1].token);
await call("POST", "reports", { geohash6: cellOk, category: "poor_lighting", time_band: "night", area_label: "lake road bus stop " }, people[2].token);
let areas = await call("GET", `areas?cells=${cellOk}`, null, people[3].token);
check("shown at 3 different reporters", areas.areas.length === 1 && areas.areas[0].reporters === 3, JSON.stringify(areas));
check("a name typed by only one or two people is never shown (could name a person or a home)", areas.areas[0].area_label === null, JSON.stringify(areas.areas[0]));
await call("POST", "reports", { geohash6: cellOk, category: "poor_lighting", time_band: "night", area_label: "Lake Road Bus Stop" }, people[3].token);
areas = await call("GET", `areas?cells=${cellOk}`, null, people[3].token);
check("a place name agreed by 3 different reporters is shown", /lake road bus stop/i.test(areas.areas[0].area_label ?? ""), JSON.stringify(areas.areas[0]));
check("no reporter ids or free text from single reporters leak", !JSON.stringify(areas).includes("Ravi") && !JSON.stringify(areas).includes(people[0].id));

const mine = await call("GET", "reports/mine", null, people[1].token);
check("she can see her own reports", mine.reports.length === 1 && mine.reports[0].geohash6 === cellOk);
check("another person can't delete her report", (await call("DELETE", `reports/${mine.reports[0].id}`, null, people[0].token)).ok === true &&
  Number((await db.execute({ sql: "select count(*) as n from reports where id = ?", args: [mine.reports[0].id] })).rows[0].n) === 1);
await call("DELETE", `reports/${mine.reports[0].id}`, null, people[1].token);
check("she can delete her own report", (await call("GET", "reports/mine", null, people[1].token)).reports.length === 0);
areas = await call("GET", `areas?cells=${cellOk}`, null, people[3].token);
check("deleting drops the count", areas.areas[0].reporters === 3);

await db.execute({ sql: "update reports set created_at = ? where geohash6 = ? and reporter_id = ?", args: [new Date(Date.now() - 91 * 86400e3).toISOString(), cellOk, people[2].id] });
areas = await call("GET", `areas?cells=${cellOk}`, null, people[3].token);
check("reports older than 90 days stop counting", areas.areas.length === 0, JSON.stringify(areas));
await db.execute({ sql: "update reports set created_at = ? where geohash6 = ? and reporter_id = ?", args: [new Date().toISOString(), cellOk, people[2].id] });

check("bad flag reason refused", (await call("POST", "areas/flag", { geohash6: cellOk, category: "poor_lighting", reason: "dislike" }, people[0].token)).http === 400);
for (const p of people.slice(0, 2)) await call("POST", "areas/flag", { geohash6: cellOk, category: "poor_lighting", reason: "names_a_person" }, p.token);
await call("POST", "areas/flag", { geohash6: cellOk, category: "poor_lighting", reason: "names_a_person" }, people[0].token);
check("one person flagging twice counts once", (await call("GET", `areas?cells=${cellOk}`, null, people[3].token)).areas.length === 1);
await call("POST", "areas/flag", { geohash6: cellOk, category: "poor_lighting", reason: "names_a_person" }, people[2].token);
check("3 different flags hide it until someone reviews it", (await call("GET", `areas?cells=${cellOk}`, null, people[3].token)).areas.length === 0);
await db.execute({ sql: "update area_moderation set status = 'visible' where geohash6 = ?", args: [cellOk] });
await call("POST", "areas/flag", { geohash6: cellOk, category: "poor_lighting", reason: "other" }, people[3].token);
check("once a reviewer restores it, more flags don't re-hide it", (await call("GET", `areas?cells=${cellOk}`, null, people[3].token)).areas.length === 1);

await db.execute({ sql: "update reports set created_at = ? where geohash6 = ? and reporter_id = ?", args: [new Date(Date.now() - 181 * 86400e3).toISOString(), cellOk, people[3].id] });
await db.execute("delete from meta where key = 'cron_last_run'");
await fetch(`${BASE}/api/cron/watchdog`);
check("reports are deleted after 180 days", Number((await db.execute({ sql: "select count(*) as n from reports where reporter_id = ?", args: [people[3].id] })).rows[0].n) === 0);

section("Account deletion covers the new tables");
await call("DELETE", "me", null, me.token);
check("her entry history is deleted", Number((await db.execute({ sql: "select count(*) as n from entry_revisions where owner_id = ?", args: [me.id] })).rows[0].n) === 0);
check("her flags are deleted", Number((await db.execute({ sql: "select count(*) as n from report_flags where flagger_id = ?", args: [me.id] })).rows[0].n) === 0);

console.log(out.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
