// Notification providers. Each send records exactly what is known:
//   provider_accepted   the provider took the message (Expo ticket "ok", SMS gateway 2xx)
//   provider_delivered  the provider later confirmed delivery (Expo receipt "ok" = handed to Apple/Google;
//                       SMS = handset delivery report)
//   failed              the provider refused it or reported failure
// Nothing here ever claims a person has read a message. Only "acknowledged" means that.
//
// Push: Expo push service (no extra credentials beyond the app's EAS project + FCM/APNs setup).
// SMS:  no provider is enabled by default. India requires DLT registration of the sender ID and
//       message templates before a gateway will deliver; see docs/NOTIFICATIONS.md. Adding one means
//       implementing SmsProvider below and setting SMS_PROVIDER plus its credentials.
import { all, now, one, run } from "./db";
import { advanceRecipient, log } from "./guard";

export type SendResult = { ok: true; ref: string | null } | { ok: false; error: string; retryable: boolean };

export interface PushProvider {
  name: string;
  send(token: string, title: string, body: string, data: Record<string, unknown>): Promise<SendResult>;
  /** Maps provider refs to delivery outcomes. Missing ref = not known yet. */
  receipts(refs: string[]): Promise<Record<string, { delivered: boolean; error?: string }>>;
}

export interface SmsProvider {
  name: string;
  send(toE164: string, body: string, idempotencyKey: string): Promise<SendResult>;
}

export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 60_000;

// ---------------------------------------------------------------------------
// Expo push
// ---------------------------------------------------------------------------
const expoPush: PushProvider = {
  name: "expo",
  async send(token, title, body, data) {
    if (!/^Expo(nent)?PushToken\[/.test(token)) return { ok: false, error: "Not an Expo push token", retryable: false };
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ to: token, title, body, data, sound: "default", priority: "high", channelId: "sos" }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.status === 429 || res.status >= 500) return { ok: false, error: `Expo HTTP ${res.status}`, retryable: true };
      const out = (await res.json().catch(() => ({}))) as { data?: { status: string; id?: string; message?: string; details?: { error?: string } } };
      const t = out.data;
      if (t?.status === "ok") return { ok: true, ref: t.id ?? null };
      const code = t?.details?.error ?? t?.message ?? `HTTP ${res.status}`;
      return { ok: false, error: code, retryable: code !== "DeviceNotRegistered" };
    } catch (e) {
      return { ok: false, error: `Network: ${(e as Error).message}`, retryable: true };
    }
  },
  async receipts(refs) {
    if (!refs.length) return {};
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ids: refs }),
        signal: AbortSignal.timeout(6000),
      });
      const out = (await res.json().catch(() => ({}))) as { data?: Record<string, { status: string; message?: string; details?: { error?: string } }> };
      const result: Record<string, { delivered: boolean; error?: string }> = {};
      for (const [id, r] of Object.entries(out.data ?? {})) {
        result[id] = r.status === "ok" ? { delivered: true } : { delivered: false, error: r.details?.error ?? r.message ?? "error" };
      }
      return result;
    } catch {
      return {};
    }
  },
};

// Deterministic provider for automated tests (SAAHI_PUSH_MODE=fake). Never used in production.
// Tokens containing "fail" are refused (retryable), "dead" are refused permanently, anything else is accepted
// and its receipt reports delivered.
const fakePush: PushProvider = {
  name: "fake",
  async send(token) {
    if (token.includes("dead")) return { ok: false, error: "DeviceNotRegistered", retryable: false };
    if (token.includes("fail")) return { ok: false, error: "Simulated outage", retryable: true };
    return { ok: true, ref: `fake-${Math.random().toString(36).slice(2)}` };
  },
  async receipts(refs) {
    return Object.fromEntries(refs.map((r) => [r, { delivered: true }]));
  },
};

const disabledPush: PushProvider = {
  name: "disabled",
  async send() {
    return { ok: false, error: "Push disabled in this environment", retryable: false };
  },
  async receipts() {
    return {};
  },
};

export function pushProvider(): PushProvider {
  const mode = process.env.SAAHI_PUSH_MODE;
  if (mode === "fake") return fakePush;
  if (mode === "disabled" || process.env.SAAHI_DISABLE_PUSH === "1") return disabledPush;
  return expoPush;
}

/** No SMS provider is configured unless SMS_PROVIDER names one implemented here. */
export function smsProvider(): SmsProvider | null {
  const name = process.env.SMS_PROVIDER;
  if (!name) return null;
  log("sms_provider_unavailable", { requested: name });
  return null;
}

// ---------------------------------------------------------------------------
// Dispatch for one alert: push to guardians who have the app; SMS only via a configured provider.
// Contacts without the app and without a provider stay "queued" until her own device sends the text.
// ---------------------------------------------------------------------------
type Target = { rid: string; status: string; attempts: number; token: string | null; contact_id: string | null };

async function targets(alertId: string): Promise<Target[]> {
  return all<Target>(
    `select r.id as rid, r.status, r.attempts, p.expo_push_token as token, r.contact_id
       from alert_recipients r
       left join contacts c on c.id = r.contact_id
       left join profiles p on p.id = c.linked_user_id
      where r.alert_id = ?`,
    [alertId],
  );
}

export async function dispatchAlert(alertId: string, ownerName: string, trackUrl: string, opts: { title?: string; body?: string } = {}): Promise<number> {
  const provider = pushProvider();
  let accepted = 0;
  for (const t of await targets(alertId)) {
    if (!t.token) continue; // no app: her device or an SMS provider must carry this one
    if (!["queued", "failed"].includes(t.status) || t.attempts >= MAX_ATTEMPTS) continue;
    const r = await provider.send(t.token, opts.title ?? `${ownerName || "Someone in your circle"} needs help`, opts.body ?? "Tap to see her live location and let her know you're on it.", {
      alertId,
      url: trackUrl,
    });
    if (r.ok) {
      accepted++;
      await run(`update alert_recipients set channel = 'push' where id = ?`, [t.rid]);
      await advanceRecipient(t.rid, "provider_accepted", { provider: provider.name, provider_ref: r.ref, attempt: true });
    } else {
      await run(`update alert_recipients set channel = 'push' where id = ?`, [t.rid]);
      await advanceRecipient(t.rid, "failed", { provider: provider.name, error: r.error, attempt: true });
      if (!r.retryable) await run(`update alert_recipients set attempts = ? where id = ?`, [MAX_ATTEMPTS, t.rid]);
    }
  }
  const sms = smsProvider();
  if (sms) log("sms_dispatch_skipped", { alertId, reason: "no provider implementation" });
  log("alert_dispatched", { alertId, pushAccepted: accepted, provider: provider.name });
  return accepted;
}

/** Bounded retries for failed pushes on recent active alerts, then delivery receipts. */
export async function retryAndReceipts(origin: string): Promise<{ retried: number; receipts: number }> {
  const provider = pushProvider();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const due = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  const retry = await all<{ alert_id: string; owner_id: string; public_token: string }>(
    `select distinct a.id as alert_id, a.owner_id, a.public_token
       from alert_recipients r join alerts a on a.id = r.alert_id
      where a.status = 'active' and a.started_at > ?
        and r.status = 'failed' and r.channel = 'push' and r.attempts < ? and (r.last_attempt_at is null or r.last_attempt_at < ?)`,
    [since, MAX_ATTEMPTS, due],
  );
  let retried = 0;
  for (const a of retry) {
    const owner = await one<{ display_name: string }>(`select display_name from profiles where id = ?`, [a.owner_id]);
    retried += await dispatchAlert(a.alert_id, owner?.display_name ?? "", `${origin}/track/?t=${a.public_token}`);
  }

  const pending = await all<{ id: string; provider_ref: string }>(
    `select id, provider_ref from alert_recipients
      where status = 'provider_accepted' and provider_ref is not null and provider = ? and updated_at < ? and updated_at > ?`,
    [provider.name, new Date(Date.now() - 15_000).toISOString(), new Date(Date.now() - 24 * 3600_000).toISOString()],
  );
  let receipts = 0;
  if (pending.length) {
    const results = await provider.receipts(pending.map((p) => p.provider_ref));
    for (const p of pending) {
      const r = results[p.provider_ref];
      if (!r) continue;
      receipts++;
      if (r.delivered) await advanceRecipient(p.id, "provider_delivered");
      else await run(`update alert_recipients set status = 'failed', error = ?, updated_at = ? where id = ? and status = 'provider_accepted'`, [r.error ?? "Delivery failed", now(), p.id]);
    }
  }
  return { retried, receipts };
}

/** A direct notice to one person's own device (e.g. "you missed a check-in"). Best effort. */
export async function notifySelf(token: string | null, title: string, body: string, data: Record<string, unknown>) {
  if (!token) return;
  const r = await pushProvider().send(token, title, body, data);
  if (!r.ok) log("self_notice_failed", { error: r.error });
}
