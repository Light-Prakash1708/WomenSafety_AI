import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Chip, ErrorText, Field, H1, Note, Screen, Sub } from "@/components/ui";
import { geohash } from "@/lib/geo";
import { api } from "@/lib/api";
import { c, f } from "@/lib/theme";

const CATS = [
  ["poor_lighting", "Poor lighting"],
  ["harassment", "Harassment happens here"],
  ["unsafe_transport", "Unsafe transport stop"],
  ["no_security", "No guard or police"],
  ["isolated", "Isolated stretch"],
] as const;
const BANDS = ["morning", "afternoon", "evening", "night"] as const;

export default function ReportArea() {
  const router = useRouter();
  const [cat, setCat] = useState<(typeof CATS)[number][0]>("poor_lighting");
  const [band, setBand] = useState<(typeof BANDS)[number]>("night");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mine, setMine] = useState<{ id: string; category: string; time_band: string; area_label: string | null; created_at: string }[]>([]);
  const [done, setDone] = useState("");

  const loadMine = useCallback(
    () =>
      api<{ reports: { id: string; category: string; time_band: string; area_label: string | null; created_at: string }[] }>("GET", "reports/mine")
        .then((r) => setMine(r.reports))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    loadMine();
  }, [loadMine]);

  const removeReport = async (id: string) => {
    await api("DELETE", `reports/${id}`).catch(() => {});
    loadMine();
  };

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) throw new Error("Allow location so the report lands in the right area.");
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const r = await api<{ duplicate: boolean }>("POST", "reports", {
        geohash6: geohash(loc.coords.latitude, loc.coords.longitude, 6),
        area_label: label.trim() || null,
        category: cat,
        time_band: band,
      });
      setDone(r.duplicate ? "You'd already reported this here, so we updated your report instead of counting it twice." : "Report sent. Thank you.");
      loadMine();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ height: 16 }} />
      <H1>Report an unsafe spot</H1>
      <Sub>Your report is pooled with others for this area, about a 1 km block. Nobody sees who reported, and it only shows once 3 women report the same thing.</Sub>
      <Text style={{ fontFamily: f.bodyBold, fontSize: 13.5, color: c.ink, marginBottom: 8 }}>What's wrong here?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {CATS.map(([k, l]) => (
          <Chip key={k} label={l} active={cat === k} onPress={() => setCat(k)} />
        ))}
      </View>
      <Text style={{ fontFamily: f.bodyBold, fontSize: 13.5, color: c.ink, marginBottom: 8 }}>When?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {BANDS.map((b) => (
          <Chip key={b} label={b[0].toUpperCase() + b.slice(1)} active={band === b} onPress={() => setBand(b)} />
        ))}
      </View>
      <Field label="Name the place (optional)" value={label} onChangeText={setLabel} placeholder="Gariahat crossing bus stop" hint="A landmark, never a person's name." />
      <ErrorText>{err}</ErrorText>
      {done ? <Text style={{ fontFamily: f.bodySemi, fontSize: 13.5, color: c.ink, marginTop: 8 }}>{done}</Text> : null}
      <View style={{ gap: 10, marginTop: 16 }}>
        <Button label="Send report" onPress={submit} loading={busy} />
        <Button tone="ghost" label={done ? "Done" : "Cancel"} onPress={() => router.back()} />
      </View>
      {mine.length > 0 && (
        <View style={{ marginTop: 20 }}>
          <Text style={{ fontFamily: f.bodyBold, fontSize: 13.5, color: c.ink, marginBottom: 6 }}>Your reports</Text>
          {mine.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }}>
              <Text style={{ flex: 1, fontFamily: f.body, fontSize: 13, color: c.ink }}>
                {CATS.find(([k]) => k === r.category)?.[1] ?? r.category} · {r.time_band} · {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Delete this report" onPress={() => removeReport(r.id)}>
                <Text style={{ fontFamily: f.bodyBold, fontSize: 13, color: c.ink, textDecorationLine: "underline" }}>Delete</Text>
              </Pressable>
            </View>
          ))}
          <Text style={{ fontFamily: f.body, fontSize: 12, color: c.muted, marginTop: 4 }}>Reports count for 90 days and are deleted after 180. Place names only show when 3 women use the same one.</Text>
        </View>
      )}
      <Note>Reports are about places, not people. Naming or describing a person here isn't allowed; use Pattern to keep a private record instead.</Note>
    </Screen>
  );
}
