// Server-side safety net for "Walk with me".
// Runs every minute (see supabase/cron.sql). If a journey's check-in is more than
// 2 minutes overdue, even with her phone dead or the app killed, it marks the
// journey missed, opens an alert and pushes it to her guardians and her own phone.
// Contacts without the app can't be texted from here because SMS goes from her phone;
// add an SMS provider in pushToGuardians if you need that.
import { admin, cors, json, pushToGuardians, sendPush, trackUrlFor } from "../_shared/util.ts";

const GRACE_MS = 2 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Forbidden" }, 403);

  const db = admin();
  const cutoff = new Date(Date.now() - GRACE_MS).toISOString();
  const { data: overdue } = await db
    .from("journeys")
    .select("id, owner_id, destination, last_lat, last_lng, alert_id")
    .eq("status", "active")
    .lt("next_checkin_at", cutoff)
    .limit(100);

  let opened = 0;
  for (const j of overdue ?? []) {
    // Claim the journey first so two overlapping runs can't double-alert.
    const { data: claimed } = await db
      .from("journeys")
      .update({ status: "missed", ended_at: new Date().toISOString() })
      .eq("id", j.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    let alertId = j.alert_id as string | null;
    let token = "";
    if (alertId) {
      const { data: existing } = await db.from("alerts").select("public_token").eq("id", alertId).maybeSingle();
      token = existing?.public_token ?? "";
    } else {
      const { data: alert } = await db
        .from("alerts")
        .insert({
          owner_id: j.owner_id,
          trigger: "watchdog",
          last_lat: j.last_lat,
          last_lng: j.last_lng,
          last_seen_at: j.last_lat != null ? new Date().toISOString() : null,
        })
        .select("id, public_token")
        .single();
      if (!alert) continue;
      alertId = alert.id;
      token = alert.public_token;
      await db.from("journeys").update({ alert_id: alertId }).eq("id", j.id);

      const { data: contacts } = await db
        .from("trusted_contacts")
        .select("id, name")
        .eq("owner_id", j.owner_id);
      if (contacts?.length) {
        await db.from("alert_recipients").insert(
          contacts.map((c) => ({ alert_id: alertId, owner_id: j.owner_id, contact_id: c.id, name: c.name, channel: "push" })),
        );
      }
    }

    const { data: profile } = await db
      .from("profiles")
      .select("display_name, expo_push_token")
      .eq("id", j.owner_id)
      .maybeSingle();
    await pushToGuardians(db, alertId!, profile?.display_name ?? "", trackUrlFor(token));
    if (profile?.expo_push_token) {
      await sendPush([{
        to: profile.expo_push_token,
        title: "You missed a check-in",
        body: `Your circle was alerted on your way to ${j.destination}. Open SAAHI to say you're safe.`,
        data: { alertId },
      }]);
    }
    opened++;
  }
  return json({ checked: overdue?.length ?? 0, opened });
});
