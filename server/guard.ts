// Cross-cutting safety helpers: rate limits, audit log, structured logs, recipient status rules.
import { HttpError, now, one, run } from "./db";

// ---------------------------------------------------------------------------
// Rate limits: fixed windows stored in Turso, so they hold across function instances.
// ---------------------------------------------------------------------------
export async function rateLimit(key: string, max: number, windowSeconds: number, message: string): Promise<void> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  await run(
    `insert into rate_limits (key, bucket, count, expires) values (?, ?, 1, ?)
       on conflict(key, bucket) do update set count = count + 1`,
    [key, bucket, (bucket + 1) * windowSeconds * 1000],
  );
  const row = await one<{ count: number }>(`select count from rate_limits where key = ? and bucket = ?`, [key, bucket]);
  if ((row?.count ?? 0) > max) throw new HttpError(429, message);
}

/** Counts without incrementing; for "only failures count" limits. */
export async function rateLimitPeek(key: string, max: number, windowSeconds: number, message: string): Promise<void> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const row = await one<{ count: number }>(`select count from rate_limits where key = ? and bucket = ?`, [key, bucket]);
  if ((row?.count ?? 0) >= max) throw new HttpError(429, message);
}

export async function rateLimitHit(key: string, windowSeconds: number): Promise<void> {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  await run(`insert into rate_limits (key, bucket, count, expires) values (?, ?, 1, ?) on conflict(key, bucket) do update set count = count + 1`, [
    key,
    bucket,
    (bucket + 1) * windowSeconds * 1000,
  ]);
}

/** Vercel sets x-vercel-forwarded-for / x-real-ip itself; x-forwarded-for is the fallback for local runs. */
export function clientIp(req: Request): string {
  const v = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for");
  return (v?.split(",")[0] ?? "unknown").trim().slice(0, 64);
}

// ---------------------------------------------------------------------------
// Audit log: who did what to whose safety record. Never stores message text or locations.
// ---------------------------------------------------------------------------
export async function audit(
  ownerId: string,
  actorId: string | null,
  action: string,
  targetType?: string,
  targetId?: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await run(`insert into audit_log (owner_id, actor_id, action, target_type, target_id, meta, at) values (?, ?, ?, ?, ?, ?, ?)`, [
      ownerId,
      actorId,
      action,
      targetType ?? null,
      targetId ?? null,
      meta ? JSON.stringify(meta).slice(0, 1000) : null,
      now(),
    ]);
  } catch (e) {
    // The audit trail must never block an emergency action.
    log("audit_write_failed", { action, error: String((e as Error).message) });
  }
}

/** One JSON line per event, ids only, for Vercel's log search. */
export function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, at: now(), ...fields }));
}

// ---------------------------------------------------------------------------
// Recipient delivery states. Each name says exactly what we know, no more.
// Status only moves forward; "failed" can be left by a successful retry.
// ---------------------------------------------------------------------------
export const RECIPIENT_STATES = [
  "queued", // nothing has left yet
  "failed", // a send attempt failed (provider error); may be retried
  "device_compose", // her phone opened its Messages app with the text; not confirmed sent
  "device_sent", // iOS reported she pressed Send; not confirmed delivered
  "provider_accepted", // a provider (Expo push / SMS gateway) accepted it; not confirmed delivered
  "provider_delivered", // the provider reported delivery (push: handed to Apple/Google; SMS: handset receipt)
  "link_opened", // someone opened her tracking link and chose this name
  "acknowledged", // a person said they're on it
] as const;
export type RecipientState = (typeof RECIPIENT_STATES)[number];

const RANK: Record<RecipientState, number> = {
  queued: 0,
  failed: 1,
  device_compose: 2,
  device_sent: 3,
  provider_accepted: 3,
  provider_delivered: 4,
  link_opened: 5,
  acknowledged: 6,
};

export const isRecipientState = (s: string): s is RecipientState => (RECIPIENT_STATES as readonly string[]).includes(s);

/** Moves one recipient forward. Returns true if the row changed. */
export async function advanceRecipient(
  id: string,
  next: RecipientState,
  extra: { message?: string | null; error?: string | null; provider?: string; provider_ref?: string | null; attempt?: boolean } = {},
): Promise<boolean> {
  const row = await one<{ status: string }>(`select status from alert_recipients where id = ?`, [id]);
  if (!row) return false;
  const current = isRecipientState(row.status) ? row.status : "queued";
  const allowed = RANK[next] > RANK[current] || (next === "failed" && current === "failed");
  if (!allowed) {
    // Still record the attempt/error without downgrading the status.
    if (extra.attempt || extra.error) {
      await run(`update alert_recipients set attempts = attempts + ?, last_attempt_at = ?, error = coalesce(?, error) where id = ?`, [
        extra.attempt ? 1 : 0,
        now(),
        extra.error ?? null,
        id,
      ]);
    }
    return false;
  }
  await run(
    `update alert_recipients
        set status = ?, updated_at = ?,
            message = coalesce(?, message),
            error = ?,
            provider = coalesce(?, provider),
            provider_ref = coalesce(?, provider_ref),
            attempts = attempts + ?,
            last_attempt_at = case when ? then ? else last_attempt_at end
      where id = ?`,
    [
      next,
      now(),
      extra.message ?? null,
      next === "failed" ? (extra.error ?? "Send failed") : null,
      extra.provider ?? null,
      extra.provider_ref ?? null,
      extra.attempt ? 1 : 0,
      extra.attempt ? 1 : 0,
      now(),
      id,
    ],
  );
  return true;
}
