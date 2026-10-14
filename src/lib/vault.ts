// Evidence vault: every file is fingerprinted (SHA-256) on the phone before upload,
// so the record shows the file hasn't changed since it was saved.
import * as Crypto from "expo-crypto";
import { File, Directory, Paths } from "expo-file-system";
import { supabase, type VaultItem } from "./supabase";

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  return toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as unknown as BufferSource));
}

function localDir(): Directory {
  const d = new Directory(Paths.document, "vault");
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

const extFor = (mime: string) =>
  mime.includes("jpeg") ? "jpg" : mime.includes("png") ? "png" : mime.includes("m4a") || mime.includes("mp4") ? "m4a" : mime.includes("pdf") ? "pdf" : mime.startsWith("text") ? "txt" : "bin";

export async function addToVault(opts: {
  uri: string;
  kind: VaultItem["kind"];
  mime: string;
  label: string;
  source?: VaultItem["source"];
  alertId?: string | null;
  capturedAt?: Date;
}): Promise<VaultItem> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error("Sign in to use your vault.");

  const src = new File(opts.uri);
  const bytes = await src.bytes();
  const sha = await sha256OfBytes(bytes);
  const name = `${Date.now()}-${sha.slice(0, 12)}.${extFor(opts.mime)}`;

  // Keep an original on the phone, so it survives a bad connection.
  try {
    src.copy(new File(localDir(), name));
  } catch {
    // A copy failure shouldn't block the upload.
  }

  const path = `${uid}/${name}`;
  const up = await supabase.storage.from("vault").upload(path, bytes, { contentType: opts.mime, upsert: false });
  if (up.error) throw new Error(`Saved on this phone, but the upload failed: ${up.error.message}`);

  const { data, error } = await supabase
    .from("vault_items")
    .insert({
      owner_id: uid,
      kind: opts.kind,
      label: opts.label,
      storage_path: path,
      sha256: sha,
      size_bytes: bytes.byteLength,
      mime: opts.mime,
      source: opts.source ?? "upload",
      alert_id: opts.alertId ?? null,
      captured_at: (opts.capturedAt ?? new Date()).toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as VaultItem;
}

export async function addNoteToVault(label: string, text: string): Promise<VaultItem> {
  const f = new File(localDir(), `${Date.now()}-note.txt`);
  f.create();
  f.write(text);
  return addToVault({ uri: f.uri, kind: "note", mime: "text/plain", label, capturedAt: new Date() });
}

export async function openVaultItem(item: VaultItem): Promise<string | null> {
  if (!item.storage_path) return null;
  const { data } = await supabase.storage.from("vault").createSignedUrl(item.storage_path, 300);
  await supabase.from("vault_access_log").insert({ owner_id: (await supabase.auth.getUser()).data.user?.id, vault_item_id: item.id, action: "view" });
  return data?.signedUrl ?? null;
}

export async function deleteVaultItem(item: VaultItem) {
  if (item.storage_path) await supabase.storage.from("vault").remove([item.storage_path]);
  await supabase.from("vault_items").delete().eq("id", item.id);
}

/** A plain-text manifest she can share as a case pack: what, when, fingerprint. */
export function manifest(items: VaultItem[], ownerName: string): string {
  const lines = [
    `SAAHI case pack for ${ownerName || "(name withheld)"}`,
    `Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
    "",
    "Each file's SHA-256 fingerprint was recorded on her phone when it was saved.",
    "A matching fingerprint shows the file is unchanged. It does not by itself make evidence admissible.",
    "",
  ];
  items.forEach((it, i) => {
    lines.push(
      `${i + 1}. ${it.label || it.kind} (${it.kind}${it.source === "sos_recording" ? ", recorded during SOS" : ""})`,
      `   Captured: ${new Date(it.captured_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
      `   SHA-256: ${it.sha256}`,
      "",
    );
  });
  return lines.join("\n");
}
