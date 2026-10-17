import { all, now, run } from "./db";

type PushMessage = { to: string; title: string; body: string; data?: Record<string, unknown> };

/** Sends through Expo's push service. Returns how many were accepted. Never throws. */
export async function sendPush(messages: PushMessage[]): Promise<number> {
  const valid = messages.filter((m) => /^Expo(nent)?PushToken\[/.test(m.to ?? ""));
  if (!valid.length) return 0;
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(valid.map((m) => ({ ...m, sound: "default", priority: "high", channelId: "sos" }))),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 0;
    const out = (await res.json().catch(() => ({ data: [] }))) as { data?: { status: string }[] };
    return (out.data ?? []).filter((t) => t.status === "ok").length;
  } catch {
    return 0;
  }
}

/** Pushes an alert to every guardian with the app and marks their rows sent. */
export async function pushToGuardians(alertId: string, ownerName: string, trackUrl: string): Promise<number> {
  const rows = await all<{ rid: string; token: string | null }>(
    `select r.id as rid, p.expo_push_token as token
       from alert_recipients r
       join contacts c on c.id = r.contact_id
       join profiles p on p.id = c.linked_user_id
      where r.alert_id = ?`,
    [alertId],
  );
  const targets = rows.filter((r) => r.token);
  if (!targets.length) return 0;
  const ok = await sendPush(
    targets.map((t) => ({
      to: t.token!,
      title: `${ownerName || "Someone in your circle"} needs help`,
      body: "Tap to see her live location and let her know you're on it.",
      data: { alertId, url: trackUrl },
    })),
  );
  if (ok > 0) {
    for (const t of targets) {
      await run(`update alert_recipients set status = 'sent', channel = 'push', updated_at = ? where id = ? and status = 'queued'`, [now(), t.rid]);
    }
  }
  return ok;
}
