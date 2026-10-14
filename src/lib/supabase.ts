import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isConfigured = Boolean(url && anon);

export const supabase = createClient(url || "https://example.supabase.co", anon || "missing-key", {
  auth: {
    storage: Platform.OS === "web" && typeof window === "undefined" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

export const trackPageUrl = (token: string) => {
  const base = process.env.EXPO_PUBLIC_TRACK_PAGE_URL ?? "";
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/?t=${token}`;
};

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
  linked_user_id: string | null;
};

export type Recipient = {
  id: string;
  alert_id: string;
  contact_id: string | null;
  name: string;
  channel: "sms" | "push";
  status: "queued" | "sent" | "opened" | "acknowledged" | "failed";
  message: string | null;
  updated_at: string;
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
  storage_path: string | null;
  sha256: string;
  size_bytes: number | null;
  mime: string | null;
  source: "upload" | "sos_recording" | "pattern";
  captured_at: string;
};
