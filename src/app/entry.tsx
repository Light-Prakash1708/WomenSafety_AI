import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Button, Chip, ErrorText, Field, H1, Note, Screen, Sub } from "@/components/ui";
import { KIND } from "@/lib/pattern";
import { api, type EntryKind } from "@/lib/api";
import { c, f } from "@/lib/theme";
import { addToVault } from "@/lib/vault";

const WHEN = [
  { label: "Just now", mins: 0 },
  { label: "1 hour ago", mins: 60 },
  { label: "This morning", mins: -1 },
  { label: "Yesterday", mins: 24 * 60 },
];

export default function NewEntry() {
  const router = useRouter();
  const params = useLocalSearchParams<{ thread?: string }>();
  const [threadId, setThreadId] = useState<string | null>(params.thread || null);
  const [threads, setThreads] = useState<{ id: string; title: string }[]>([]);
  const [kind, setKind] = useState<EntryKind>("message");
  const [when, setWhen] = useState(0);
  const [exact, setExact] = useState("");
  const [channel, setChannel] = useState("");
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<{ threads: { id: string; title: string }[] }>("GET", "threads")
      .then(({ threads: list }) => {
        setThreads(list);
        if (!threadId && list[0]) setThreadId(list[0].id);
      })
      .catch(() => {});
  }, [threadId]);

  const occurredAt = (): Date => {
    const m = exact.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      const now = new Date();
      return new Date(Number(m[3] ?? now.getFullYear()), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
    }
    const opt = WHEN[when];
    if (opt.mins === -1) {
      const d = new Date();
      d.setHours(9, 0, 0, 0);
      return d;
    }
    return new Date(Date.now() - opt.mins * 60000);
  };

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, exif: true });
    if (!r.canceled) setImage(r.assets[0]);
  };

  const save = async () => {
    setErr("");
    if (exact && !/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2}):(\d{2})$/.test(exact)) return setErr("Write the time like 12/10 16:05.");
    setBusy(true);
    try {
      let tid = threadId;
      if (!tid) {
        tid = (await api<{ thread: { id: string } }>("POST", "threads", { title: "Unwanted contact" })).thread.id;
      }
      if (!tid) throw new Error("Couldn't create a thread. Check your connection.");
      let vaultId: string | null = null;
      if (image) {
        const v = await addToVault({
          uri: image.uri,
          kind: "screenshot",
          mime: image.mimeType ?? "image/jpeg",
          label: `${KIND[kind].label}${handle ? ` from ${handle}` : ""}`,
          source: "pattern",
          capturedAt: occurredAt(),
        });
        vaultId = v.id;
      }
      await api("POST", `threads/${tid}/entries`, {
        kind,
        occurred_at: occurredAt().toISOString(),
        channel: channel.trim() || null,
        handle: handle.trim() || null,
        note: note.trim() || null,
        vault_item_id: vaultId,
      });
      router.back();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ height: 16 }} />
      <H1>Log something</H1>
      <Sub>Only you see this. Short is fine; you can add detail later.</Sub>

      {threads.length > 1 && (
        <View style={{ gap: 8, marginBottom: 14 }}>
          <Text style={{ fontFamily: f.bodyBold, fontSize: 13.5, color: c.ink }}>Thread</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {threads.map((t) => (
              <Chip key={t.id} label={t.title} active={t.id === threadId} onPress={() => setThreadId(t.id)} />
            ))}
          </View>
        </View>
      )}

      <Text style={{ fontFamily: f.bodyBold, fontSize: 13.5, color: c.ink, marginBottom: 8 }}>What happened?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {(Object.keys(KIND) as EntryKind[]).map((k) => (
          <Chip key={k} label={KIND[k].label} active={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>

      <Text style={{ fontFamily: f.bodyBold, fontSize: 13.5, color: c.ink, marginBottom: 8 }}>When?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        {WHEN.map((w, i) => (
          <Chip key={w.label} label={w.label} active={!exact && when === i} onPress={() => { setWhen(i); setExact(""); }} />
        ))}
      </View>
      <View style={{ gap: 14 }}>
        <Field label="Or exact time" value={exact} onChangeText={setExact} placeholder="12/10 16:05" hint="Day/month, 24-hour time." />
        <Field label="Where or how (optional)" value={channel} onChangeText={setChannel} placeholder="Instagram, WhatsApp, outside Commerce block" />
        <Field label="Account, number or description (optional)" value={handle} onChangeText={setHandle} placeholder="@rk_xx or +91 ••••• 4471" />
        <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="What was said or done, in your words" />
        <Button tone="ghost" label={image ? "Screenshot attached ✓" : "Attach a screenshot or photo"} onPress={pick} />
        {kind === "threat" && <Note>If you're in danger now, hold the SOS button or call 112.</Note>}
        <ErrorText>{err}</ErrorText>
        <Button label="Save entry" onPress={save} loading={busy} />
        <Button tone="ghost" label="Cancel" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
