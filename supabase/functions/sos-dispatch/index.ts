// Called by the app right after an alert row is created.
// Sends push notifications to every guardian who has SAAHI installed.
// SMS to everyone else is sent from her own phone, so it works without this server.
import { admin, cors, currentUserId, json, pushToGuardians, trackUrlFor } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const uid = await currentUserId(req);
  if (!uid) return json({ error: "Sign in again to send alerts." }, 401);

  const { alert_id } = await req.json().catch(() => ({}));
  if (typeof alert_id !== "string") return json({ error: "alert_id is required" }, 400);

  const db = admin();
  const { data: alert } = await db
    .from("alerts")
    .select("id, owner_id, public_token, status")
    .eq("id", alert_id)
    .eq("owner_id", uid)
    .maybeSingle();
  if (!alert) return json({ error: "Alert not found." }, 404);

  const { data: profile } = await db.from("profiles").select("display_name").eq("id", uid).maybeSingle();
  const pushed = await pushToGuardians(db, alert.id, profile?.display_name ?? "", trackUrlFor(alert.public_token));
  return json({ pushed });
});
