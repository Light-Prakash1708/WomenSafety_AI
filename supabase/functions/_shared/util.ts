import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Service-role client. Bypasses RLS, so every query must filter explicitly. */
export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Client acting as the calling user, so RLS applies. */
export function asUser(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
}

export async function currentUserId(req: Request): Promise<string | null> {
  const { data } = await asUser(req).auth.getUser();
  return data.user?.id ?? null;
}

export type PushMessage = { to: string; title: string; body: string; data?: Record<string, unknown> };

/** Sends through Expo's push service. Returns how many tickets came back ok. */
export async function sendPush(messages: PushMessage[]): Promise<number> {
  const valid = messages.filter((m) => m.to?.startsWith("ExponentPushToken") || m.to?.startsWith("ExpoPushToken"));
  if (!valid.length) return 0;
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      valid.map((m) => ({ ...m, sound: "default", priority: "high", channelId: "sos" })),
    ),
  });
  if (!res.ok) return 0;
  const out = await res.json().catch(() => ({ data: [] }));
  return (out.data ?? []).filter((t: { status: string }) => t.status === "ok").length;
}

/** Pushes an alert to every guardian who has the app, and marks their rows sent. */
export async function pushToGuardians(db: SupabaseClient, alertId: string, ownerName: string, trackUrl: string) {
  const { data: recips } = await db
    .from("alert_recipients")
    .select("id, contact_id, trusted_contacts(linked_user_id)")
    .eq("alert_id", alertId);
  const linked = (recips ?? [])
    .map((r: any) => ({ id: r.id, user: r.trusted_contacts?.linked_user_id as string | null }))
    .filter((r) => r.user);
  if (!linked.length) return 0;
  const { data: profiles } = await db
    .from("profiles")
    .select("id, expo_push_token")
    .in("id", linked.map((l) => l.user!));
  const tokenOf = new Map((profiles ?? []).map((p: any) => [p.id, p.expo_push_token]));
  const msgs = linked
    .map((l) => ({
      to: tokenOf.get(l.user!) as string,
      title: `${ownerName || "Someone in your circle"} needs help`,
      body: "Tap to see her live location and let her know you're on it.",
      data: { alertId, url: trackUrl },
    }))
    .filter((m) => m.to);
  const ok = await sendPush(msgs);
  if (ok > 0) {
    await db
      .from("alert_recipients")
      .update({ status: "sent", channel: "push", updated_at: new Date().toISOString() })
      .in("id", linked.map((l) => l.id))
      .eq("status", "queued");
  }
  return ok;
}

export function trackUrlFor(token: string): string {
  const base = Deno.env.get("TRACK_PAGE_URL") ?? "";
  return base ? `${base.replace(/\/$/, "")}/?t=${token}` : `token:${token}`;
}
