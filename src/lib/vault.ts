// Evidence vault. Every file is fingerprinted (SHA-256) on the device, uploaded in parts,
// and the server re-checks the fingerprint before saving, so the record proves the file is unchanged.
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { api, type VaultItem } from "./api";

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  return toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as unknown as BufferSource));
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

function localDir(): Directory {
  const d = new Directory(Paths.document, "vault");
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

const extFor = (mime: string) =>
  mime.includes("jpeg") ? "jpg" : mime.includes("png") ? "png" : mime.includes("m4a") || mime.includes("mp4") || mime.includes("webm") ? "m4a" : mime.includes("pdf") ? "pdf" : mime.startsWith("text") ? "txt" : "bin";

async function readBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === "web") return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return new File(uri).bytes();
}

export async function addToVault(opts: {
  uri: string;
  kind: VaultItem["kind"];
  mime: string;
  label: string;
  source?: VaultItem["source"];
  alertId?: string | null;
  capturedAt?: Date;
}): Promise<VaultItem> {
  const bytes = await readBytes(opts.uri);
  if (!bytes.length) throw new Error("That file is empty.");
  const sha = await sha256OfBytes(bytes);

  // Keep an original on the phone too, so it survives a bad connection.
  if (Platform.OS !== "web") {
    try {
      new File(opts.uri).copy(new File(localDir(), `${Date.now()}-${sha.slice(0, 12)}.${extFor(opts.mime)}`));
    } catch {
      // A local copy failing shouldn't block the upload.
    }
  }

  const start = await api<{ id: string; chunks: number; chunkBytes: number }>("POST", "vault", {
    kind: opts.kind,
    label: opts.label,
    mime: opts.mime,
    size_bytes: bytes.length,
    sha256: sha,
    source: opts.source ?? "upload",
    alert_id: opts.alertId && !opts.alertId.startsWith("local-") ? opts.alertId : null,
    captured_at: (opts.capturedAt ?? new Date()).toISOString(),
  });
  for (let i = 0; i < start.chunks; i++) {
    const part = bytes.subarray(i * start.chunkBytes, (i + 1) * start.chunkBytes);
    let tries = 0;
    for (;;) {
      try {
        await api("PUT", `vault/${start.id}/chunks/${i}`, { data: bytesToBase64(part) }, { timeoutMs: 60000 });
        break;
      } catch (e) {
        if (++tries >= 3) throw new Error(`Upload stopped at part ${i + 1} of ${start.chunks}: ${(e as Error).message}`);
      }
    }
  }
  const done = await api<{ item: VaultItem }>("POST", `vault/${start.id}/finish`);
  return done.item;
}

export async function addNoteToVault(label: string, text: string): Promise<VaultItem> {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    try {
      return await addToVault({ uri: url, kind: "note", mime: "text/plain", label, capturedAt: new Date() });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const f = new File(localDir(), `${Date.now()}-note.txt`);
  f.create();
  f.write(text);
  return addToVault({ uri: f.uri, kind: "note", mime: "text/plain", label, capturedAt: new Date() });
}

async function downloadBytes(item: VaultItem): Promise<Uint8Array> {
  const size = item.size_bytes ?? 0;
  const parts: Uint8Array[] = [];
  let got = 0;
  for (let i = 0; got < size; i++) {
    const res = await api<Response>("GET", `vault/${item.id}/chunks/${i}`, undefined, { raw: true, timeoutMs: 60000 });
    const part = new Uint8Array(await res.arrayBuffer());
    if (!part.length) break;
    parts.push(part);
    got += part.length;
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Opens an item: a new browser tab on the web, the system viewer/share sheet on phones. */
export async function openVaultItem(item: VaultItem): Promise<void> {
  const bytes = await downloadBytes(item);
  const mime = item.mime ?? "application/octet-stream";
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const f = new File(Paths.cache, `saahi-${item.id.slice(0, 8)}.${extFor(mime)}`);
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(f.uri, { mimeType: mime });
}

export async function deleteVaultItem(item: VaultItem) {
  await api("DELETE", `vault/${item.id}`);
}

/** A plain-text manifest she can share as a case pack: what, when, fingerprint. */
export function manifest(items: VaultItem[], ownerName: string): string {
  const lines = [
    `SAAHI case pack for ${ownerName || "(name withheld)"}`,
    `Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
    "",
    "Each file's SHA-256 fingerprint was recorded on her device when it was saved and checked again by the server.",
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
