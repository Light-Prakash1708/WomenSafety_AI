// Public endpoint behind the link in the SOS text message.
// Anyone holding the 36-character token can see the live alert and say "I'm on it".
// GET  ?t=<token>                         -> alert status, location, who was asked
// POST { t, action: "open" | "ack", recipient_id?, message? }
import { admin, cors, json } from "../_shared/util.ts";

const TOKEN = /^[a-f0-9]{36}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();

  let token = "";
  let body: Record<string, any> = {};
  if (req.method === "GET") {
    token = new URL(req.url).searchParams.get("t") ?? "";
  } else if (req.method === "POST") {
    body = await req.json().catch(() => ({}));
    token = String(body.t ?? "");
  } else {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!TOKEN.test(token)) return json({ error: "This link isn't valid." }, 400);

  const { data: alert } = await db
    .from("alerts")
    .select("id, owner_id, status, duress, trigger, channel, last_lat, last_lng, last_accuracy, last_seen_at, started_at, ended_at, battery")
    .eq("public_token", token)
    .maybeSingle();
  if (!alert) return json({ error: "This alert doesn't exist or was deleted." }, 404);

  // A duress cancel must look active to helpers. A real cancel hides location.
  const live = alert.status === "active";

  if (req.method === "POST") {
    if (!live) return json({ error: "This alert has ended." }, 409);
    const action = body.action === "ack" ? "ack" : "open";
    const recipientId = typeof body.recipient_id === "string" ? body.recipient_id : null;
    if (recipientId) {
      const { data: r } = await db
        .from("alert_recipients")
        .select("id, status")
        .eq("id", recipientId)
        .eq("alert_id", alert.id)
        .maybeSingle();
      if (!r) return json({ error: "Unknown responder." }, 404);
      if (action === "ack") {
        await db.from("alert_recipients").update({
          status: "acknowledged",
          message: typeof body.message === "string" ? body.message.slice(0, 280) : null,
          updated_at: new Date().toISOString(),
        }).eq("id", r.id);
      } else if (r.status === "queued" || r.status === "sent") {
        await db.from("alert_recipients").update({ status: "opened", updated_at: new Date().toISOString() }).eq("id", r.id);
      }
    }
    return json({ ok: true });
  }

  const [{ data: profile }, { data: recipients }, { data: trail }] = await Promise.all([
    db.from("profiles").select("display_name").eq("id", alert.owner_id).maybeSingle(),
    db.from("alert_recipients").select("id, name, status, message, updated_at").eq("alert_id", alert.id).order("name"),
    live
      ? db.from("alert_locations").select("lat, lng, recorded_at").eq("alert_id", alert.id)
          .order("recorded_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const firstName = (profile?.display_name ?? "").split(" ")[0] || "Your contact";

  return json({
    name: firstName,
    status: live ? "active" : alert.status,
    // Shown to helpers so they keep going even if they see "cancelled" on her phone.
    possibly_forced_cancel: live && alert.duress,
    started_at: alert.started_at,
    ended_at: live ? null : alert.ended_at,
    location: live && alert.last_lat != null
      ? { lat: alert.last_lat, lng: alert.last_lng, accuracy: alert.last_accuracy, at: alert.last_seen_at }
      : null,
    trail: trail ?? [],
    battery: live ? alert.battery : null,
    recipients: (recipients ?? []).map((r) => ({ id: r.id, name: r.name.split(" ")[0], status: r.status, message: r.message })),
  });
});
