// Client for the SAAHI API (a Vercel function backed by Turso).
// Web: same origin as the site. Phone app: EXPO_PUBLIC_API_URL, or the production site.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const DEFAULT_SITE = "https://womensafety-ai.vercel.app";

export const SITE_URL = (() => {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (Platform.OS === "web" && typeof location !== "undefined") return location.origin;
  return DEFAULT_SITE;
})();

const TOKEN_KEY = "saahi.session";
let token: string | null = null;
let loaded = false;
const listeners = new Set<(t: string | null) => void>();

export async function getToken(): Promise<string | null> {
  if (!loaded) {
    try {
      token = await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      token = null;
    }
    loaded = true;
  }
  return token;
}

export async function setToken(t: string | null) {
  token = t;
  loaded = true;
  try {
    if (t) await AsyncStorage.setItem(TOKEN_KEY, t);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable (private browsing); the session still works for this visit.
  }
  listeners.forEach((l) => l(t));
}

export function onTokenChange(fn: (t: string | null) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Opts = { timeoutMs?: number; raw?: boolean };

/** Calls /api/<path>. Throws ApiError with the server's plain-English message. */
export async function api<T = any>(method: string, path: string, body?: unknown, opts: Opts = {}): Promise<T> {
  const t = await getToken();
  let res: Response;
  try {
    res = await fetch(`${SITE_URL}/api/${path}`, {
      method,
      headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    });
  } catch {
    throw new ApiError(0, "Can't reach SAAHI right now. Check your internet connection.");
  }
  if (res.status === 401 && t) await setToken(null);
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, "Couldn't load this file.");
    return res as unknown as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong. Try again.");
  return data as T;
}

export const trackPageUrl = (publicToken: string) => `${SITE_URL}/track/?t=${publicToken}`;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type Profile = {
  id: string;
  display_name: string;
  phone: string | null;
  language: "en" | "hi" | "bn";
  expo_push_token: string | null;
  onboarded: boolean;
};

export type Contact = {
  id: string;
  owner_id: string;
  name: string;
  phone: string;
  relation: string | null;
  priority: number;
  invite_code: string;
  invite_expires_at: string | null;
  linked_user_id: string | null;
  linked_at: string | null;
  /** Display name of the person who joined with this code, if anyone has. */
  guardian_name: string | null;
};

export type Recipient = {
  id: string;
  alert_id: string;
  contact_id: string | null;
  name: string;
  channel: "sms" | "push";
  status: RecipientStatus;
  message: string | null;
  attempts?: number;
  error?: string | null;
  updated_at: string;
};

/** Each state says only what is known. Nothing but "acknowledged" means a person has seen it. */
export type RecipientStatus =
  | "queued"
  | "failed"
  | "device_compose"
  | "device_sent"
  | "provider_accepted"
  | "provider_delivered"
  | "link_opened"
  | "acknowledged";

export type StatusTone = "wait" | "sent" | "ack" | "fail";

export const RECIPIENT_LABELS: Record<RecipientStatus, { label: string; detail: string; tone: StatusTone }> = {
  queued: { label: "Waiting", detail: "Nothing has gone to them yet", tone: "wait" },
  failed: { label: "Not delivered", detail: "Sending failed. SAAHI retries a few times.", tone: "fail" },
  device_compose: { label: "Text opened", detail: "Opened in your Messages app. Not confirmed sent.", tone: "wait" },
  device_sent: { label: "Text sent", detail: "Sent from your phone. Delivery not confirmed.", tone: "sent" },
  provider_accepted: { label: "Push queued", detail: "Accepted by the notification service", tone: "sent" },
  provider_delivered: { label: "Push sent", detail: "Handed to their phone's notification system", tone: "sent" },
  link_opened: { label: "Opened link", detail: "Someone opened your link and chose this name", tone: "sent" },
  acknowledged: { label: "On it", detail: "They said they're on it", tone: "ack" },
};

export const recipientLabel = (s: string) => RECIPIENT_LABELS[s as RecipientStatus] ?? RECIPIENT_LABELS.queued;

/** "just now", "3 min ago", "2 h ago". */
export function ageText(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

export type AlertRow = {
  id: string;
  owner_id: string;
  status: "active" | "cancelled" | "resolved" | "expired";
  duress: boolean;
  client_ref?: string | null;
  end_reason?: string | null;
  location_age_seconds?: number | null;
  location_stale?: boolean | null;
  trigger: string;
  public_token: string;
  last_lat: number | null;
  last_lng: number | null;
  last_accuracy: number | null;
  last_seen_at: string | null;
  battery: number | null;
  started_at: string;
};

export type EntryKind = "message" | "new_account" | "call" | "in_person" | "blocked" | "threat" | "other";

export type PatternEntry = {
  id: string;
  thread_id: string;
  kind: EntryKind;
  occurred_at: string;
  channel: string | null;
  handle: string | null;
  note: string | null;
  vault_item_id: string | null;
};

export type VaultItem = {
  id: string;
  kind: "photo" | "audio" | "screenshot" | "document" | "note";
  label: string;
  sha256: string;
  size_bytes: number | null;
  mime: string | null;
  source: "upload" | "sos_recording" | "pattern";
  captured_at: string;
};
