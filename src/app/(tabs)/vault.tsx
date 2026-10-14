import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useState, type ComponentType } from "react";
import { Linking, Pressable, Share, Text, View } from "react-native";
import { IconCamera, IconDoc, IconMic, IconSpark } from "@/components/icons";
import { Button, Card, ErrorText, Field, H1, Note, Screen, Section, Sub, TopBar, s as ui } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { supabase, type VaultItem } from "@/lib/supabase";
import { c, f, radius } from "@/lib/theme";
import { addNoteToVault, addToVault, deleteVaultItem, manifest, openVaultItem } from "@/lib/vault";

const ICON: Record<VaultItem["kind"], { Icon: ComponentType<{ size?: number }>; bg: string }> = {
  photo: { Icon: IconCamera, bg: c.sage },
  screenshot: { Icon: IconDoc, bg: c.lilac },
  audio: { Icon: IconMic, bg: c.blush },
  document: { Icon: IconDoc, bg: c.faint },
  note: { Icon: IconSpark, bg: c.marigold },
};

export default function Vault() {
  const { profile } = useApp();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("vault_items").select("*").order("captured_at", { ascending: false });
    setItems((data ?? []) as VaultItem[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const add = async (from: "library" | "camera") => {
    setErr("");
    const fn = from === "camera" ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    if (from === "camera") {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return setErr("Camera access is off. Turn it on in Settings to take photos here.");
    }
    const r = await fn({ mediaTypes: ["images"], quality: 1, exif: true });
    if (r.canceled) return;
    setBusy(from);
    try {
      const a = r.assets[0];
      await addToVault({ uri: a.uri, kind: from === "camera" ? "photo" : "screenshot", mime: a.mimeType ?? "image/jpeg", label: a.fileName ?? (from === "camera" ? "Photo" : "Screenshot") });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveNote = async () => {
    if (!noteBody.trim()) return;
    setBusy("note");
    try {
      await addNoteToVault(noteTitle.trim() || "Written account", noteBody.trim());
      setNoteOpen(false);
      setNoteTitle("");
      setNoteBody("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportPack = async () => {
    const text = manifest(items, profile?.display_name ?? "");
    try {
      const file = new File(Paths.cache, `saahi-case-pack-${Date.now()}.txt`);
      file.create();
      file.write(text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: "text/plain", dialogTitle: "Share case pack" });
      } else {
        await Share.share({ message: text });
      }
      const uid = (await supabase.auth.getUser()).data.user?.id;
      if (uid) await supabase.from("vault_access_log").insert(items.map((it) => ({ owner_id: uid, vault_item_id: it.id, action: "export" })));
    } catch {
      await Share.share({ message: text });
    }
  };

  const open = async (it: VaultItem) => {
    const url = await openVaultItem(it);
    if (url) Linking.openURL(url);
  };

  return (
    <Screen>
      <TopBar title="vault" />
      <H1>Evidence Vault</H1>
      <Sub>Private to you · {items.length} item{items.length === 1 ? "" : "s"} · each one fingerprinted when saved</Sub>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button label="Add screenshot" onPress={() => add("library")} loading={busy === "library"} style={{ flex: 1 }} />
        <Button tone="ghost" label="Take photo" onPress={() => add("camera")} loading={busy === "camera"} style={{ flex: 1 }} />
      </View>
      <Button tone="ghost" label="Write down what happened" onPress={() => setNoteOpen(!noteOpen)} style={{ marginTop: 10 }} />
      {noteOpen && (
        <Card style={{ marginTop: 12 }}>
          <View style={{ gap: 12 }}>
            <Field label="Title" value={noteTitle} onChangeText={setNoteTitle} placeholder="What happened on 12 Oct" />
            <Field label="Your account" value={noteBody} onChangeText={setNoteBody} multiline placeholder="Write it in your own words, whenever you're ready." />
            <Button label="Save to vault" onPress={saveNote} loading={busy === "note"} />
          </View>
        </Card>
      )}
      <ErrorText>{err}</ErrorText>

      <Section title="Saved" hint="tap to open · hold to delete" />
      <Card>
        {items.length === 0 && <Text style={ui.hint}>Nothing here yet. Screenshots, photos, notes and SOS audio recordings will appear here.</Text>}
        {items.map((it, i) => {
          const { Icon, bg } = ICON[it.kind];
          return (
            <View key={it.id}>
              <Pressable
                onPress={() => open(it)}
                onLongPress={() => setConfirmDelete(it.id)}
                style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 10, borderTopWidth: i ? 1.5 : 0, borderTopColor: c.faint }}
              >
                <View style={{ width: 44, height: 44, borderRadius: radius.sm, borderWidth: 2, borderColor: c.ink, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
                  <Icon size={20} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: f.bodyBold, fontSize: 14, color: c.ink }}>
                    {it.label || it.kind}
                  </Text>
                  <Text numberOfLines={1} style={{ fontFamily: f.mono, fontSize: 10.5, color: c.muted }}>
                    {new Date(it.captured_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · sha256 {it.sha256.slice(0, 4)}…{it.sha256.slice(-4)}
                  </Text>
                </View>
                <Text style={{ fontFamily: f.bodyBold, fontSize: 10, color: c.ink, borderWidth: 1.5, borderColor: c.ink, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                  {it.source === "sos_recording" ? "SOS" : "Original"}
                </Text>
              </Pressable>
              {confirmDelete === it.id && (
                <View style={{ flexDirection: "row", gap: 8, paddingBottom: 10 }}>
                  <Button tone="danger" label="Delete permanently" style={{ flex: 1 }} onPress={async () => { await deleteVaultItem(it); setConfirmDelete(null); load(); }} />
                  <Button tone="ghost" label="Keep" style={{ flex: 1 }} onPress={() => setConfirmDelete(null)} />
                </View>
              )}
            </View>
          );
        })}
      </Card>

      <Section title="Share when you're ready" />
      <Button label="Export case pack" onPress={exportPack} disabled={!items.length} />
      <Note>
        The case pack lists every item with its capture time and SHA-256 fingerprint, so anyone you share files with can check they're unchanged. Fingerprints don't by themselves make evidence admissible in court.
      </Note>
    </Screen>
  );
}
