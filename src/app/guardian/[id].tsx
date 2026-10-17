// What a guardian with the app sees for someone else's active alert.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { Button, Card, ErrorText, Field, H1, Note, Screen, Sub } from "@/components/ui";
import { mapsLink } from "@/lib/geo";
import { api, type Recipient } from "@/lib/api";
import { c, f } from "@/lib/theme";

type A = { id: string; status: string; duress: boolean; last_lat: number | null; last_lng: number | null; last_accuracy: number | null; last_seen_at: string | null; started_at: string; battery: number | null };

export default function GuardianAlert() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [alert, setAlert] = useState<A | null>(null);
  const [recips, setRecips] = useState<Recipient[]>([]);
  const [msg, setMsg] = useState("On my way");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [seen, setSeen] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ alert: A; recipients: Recipient[] }>("GET", `alerts/${id}`).catch(() => null);
    const row = r?.alert ?? null;
    setAlert(row);
    setSeen(row?.last_seen_at ? Math.round((Date.now() - +new Date(row.last_seen_at)) / 60000) : null);
    setRecips(r?.recipients ?? []);
  }, [id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 10000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const ack = async () => {
    setErr("");
    try {
      await api("POST", `alerts/${id}/ack`, { message: msg.trim() || null });
    } catch {
      return setErr("Couldn't send. Call her or 112 directly.");
    }
    setSent(true);
    load();
  };

  if (!alert) {
    return (
      <Screen>
        <View style={{ height: 24 }} />
        <H1>This alert has ended</H1>
        <Sub>She cancelled it, or it's no longer shared with you.</Sub>
        <Button label="Back" onPress={() => router.dismissTo("/(tabs)")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ height: 24 }} />
      <H1>She needs help</H1>
      <Sub>Alert started {new Date(alert.started_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</Sub>
      {alert.duress && (
        <Card bg={c.sos} style={{ marginBottom: 12 }}>
          <Text style={{ fontFamily: f.bodyBold, color: c.white, fontSize: 14.5 }}>She may have been forced to cancel. Keep going.</Text>
        </Card>
      )}
      <Card bg={c.sage}>
        <Text style={{ fontFamily: f.displayBold, fontSize: 17, color: c.ink }}>Last location</Text>
        <Text style={{ fontFamily: f.body, fontSize: 13.5, color: c.ink, marginTop: 3 }}>
          {alert.last_lat != null ? `±${Math.round(alert.last_accuracy ?? 0)} m · ${seen === 0 ? "just now" : `${seen} min ago`}` : "Waiting for her phone to send a location"}
          {alert.battery != null ? ` · battery ${Math.round(alert.battery * 100)}%` : ""}
        </Text>
        {alert.last_lat != null && (
          <Button label="Open in Maps" style={{ marginTop: 12 }} onPress={() => Linking.openURL(mapsLink(alert.last_lat!, alert.last_lng!))} />
        )}
      </Card>
      <View style={{ gap: 10, marginTop: 14 }}>
        <Field label="Message to her" value={msg} onChangeText={setMsg} />
        <Button tone={sent ? "ok" : "primary"} label={sent ? "She can see you're on it" : "I'm on it"} onPress={ack} />
        <Button tone="danger" label="Call 112" onPress={() => Linking.openURL("tel:112")} />
        <ErrorText>{err}</ErrorText>
      </View>
      <Card style={{ marginTop: 14 }}>
        <Text style={{ fontFamily: f.bodyBold, fontSize: 14, color: c.ink, marginBottom: 6 }}>Who else was asked</Text>
        {recips.map((r) => (
          <Text key={r.id} style={{ fontFamily: f.body, fontSize: 13.5, color: c.ink }}>
            {r.name}: {r.status === "acknowledged" ? `on it${r.message ? ` ("${r.message}")` : ""}` : r.status}
          </Text>
        ))}
      </Card>
      <Note>Don't confront anyone yourself. If you can't reach her quickly, call 112 and share this location.</Note>
    </Screen>
  );
}
