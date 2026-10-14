import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, Chip, ErrorText, Field, H1, Note, Screen, Section, Sub, TopBar } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { pushLocation, setActiveShare, startBackgroundShare, stopBackgroundShare } from "@/lib/bg-location";
import { cancelScheduled, scheduleCheckin } from "@/lib/notifications";
import { usePrefs } from "@/lib/prefs";
import { useSos } from "@/lib/sos";
import { supabase } from "@/lib/supabase";
import { c, f } from "@/lib/theme";

type Journey = { id: string; destination: string; interval_minutes: number; next_checkin_at: string; started_at: string };

const GRACE_S = 30;

export default function Walk() {
  const { session, contacts } = useApp();
  const sos = useSos();
  const [prefs, setPrefs] = usePrefs();
  const [journey, setJourney] = useState<Journey | null>(null);
  const [dest, setDest] = useState("");
  const [picked, setMinutes] = useState<number | null>(null);
  const minutes = picked ?? prefs.checkinMinutes;
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const notifId = useRef<string | null>(null);
  const escalated = useRef(false);
  const startSos = useRef(sos.start);
  useEffect(() => {
    startSos.current = sos.start;
  }, [sos.start]);

  useFocusEffect(
    useCallback(() => {
      supabase
        .from("journeys")
        .select("id, destination, interval_minutes, next_checkin_at, started_at")
        .eq("owner_id", session?.user.id ?? "")
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .then(({ data }) => setJourney((data?.[0] as Journey) ?? null));
    }, [session?.user.id]),
  );

  // Countdown, then a 30-second grace, then SOS.
  useEffect(() => {
    if (!journey) return;
    escalated.current = false;
    const tick = () => {
      const s = Math.round((+new Date(journey.next_checkin_at) - Date.now()) / 1000);
      setLeft(s);
      if (s <= 0 && s > -GRACE_S && s % 5 === 0) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      if (s <= -GRACE_S && !escalated.current) {
        escalated.current = true;
        startSos.current("walk").then(async () => {
          await supabase.from("journeys").update({ status: "missed", ended_at: new Date().toISOString() }).eq("id", journey.id);
        });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [journey]);

  const start = async () => {
    setErr("");
    if (!dest.trim()) return setErr("Where are you headed?");
    if (!contacts.length) return setErr("Add someone to your circle first, so a missed check-in reaches a person.");
    setBusy(true);
    const perm = await Location.requestForegroundPermissionsAsync();
    const next = new Date(Date.now() + minutes * 60000).toISOString();
    const { data, error } = await supabase
      .from("journeys")
      .insert({ owner_id: session!.user.id, destination: dest.trim(), interval_minutes: minutes, next_checkin_at: next })
      .select("id, destination, interval_minutes, next_checkin_at, started_at")
      .single();
    setBusy(false);
    if (error || !data) return setErr("Couldn't start the journey. Check your internet; the SOS button still works offline.");
    await setPrefs({ checkinMinutes: minutes });
    setJourney(data as Journey);
    notifId.current = await scheduleCheckin(minutes * 60, data.destination);
    await setActiveShare({ journeyId: data.id, ownerId: session!.user.id });
    if (perm.granted) {
      await startBackgroundShare();
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (loc) pushLocation(loc, { journeyId: data.id, ownerId: session!.user.id }).catch(() => {});
    }
  };

  const checkIn = async () => {
    if (!journey) return;
    const next = new Date(Date.now() + journey.interval_minutes * 60000).toISOString();
    await supabase.from("journeys").update({ next_checkin_at: next }).eq("id", journey.id);
    await cancelScheduled(notifId.current);
    notifId.current = await scheduleCheckin(journey.interval_minutes * 60, journey.destination);
    setJourney({ ...journey, next_checkin_at: next });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const end = async (status: "arrived" | "cancelled") => {
    if (!journey) return;
    await supabase.from("journeys").update({ status, ended_at: new Date().toISOString() }).eq("id", journey.id);
    await cancelScheduled(notifId.current);
    if (!sos.alert) {
      await stopBackgroundShare();
      await setActiveShare(null);
    }
    setJourney(null);
  };

  const mm = String(Math.floor(Math.max(0, left) / 60)).padStart(2, "0");
  const ss = String(Math.max(0, left) % 60).padStart(2, "0");
  const overdue = left <= 0;

  return (
    <Screen>
      <TopBar title="walk" />
      {!journey ? (
        <>
          <H1>Walk with me</H1>
          <Sub>Check in as you go. If you stop checking in, your circle is alerted, even if your phone dies.</Sub>
          <View style={{ gap: 14 }}>
            <Field label="Where are you headed?" value={dest} onChangeText={setDest} placeholder="Kalighat Metro" />
            <Text style={{ fontFamily: f.bodyBold, fontSize: 13.5, color: c.ink }}>Check in every</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[2, 5, 10, 15].map((m) => (
                <Chip key={m} label={`${m} min`} active={minutes === m} onPress={() => setMinutes(m)} />
              ))}
            </View>
            <ErrorText>{err}</ErrorText>
            <Button label="Start journey" onPress={start} loading={busy} />
          </View>
          <Ladder />
        </>
      ) : (
        <>
          <H1>Walking to {journey.destination}</H1>
          <Sub>Started {new Date(journey.started_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</Sub>
          <Card bg={overdue ? c.sos : c.marigold} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: f.displayBold, fontSize: 17, color: overdue ? c.white : c.ink }}>
                {overdue ? "Check in now" : "Next check-in"}
              </Text>
              <Text style={{ fontFamily: f.body, fontSize: 13, color: overdue ? c.white : c.ink }}>
                {overdue ? `Your circle will be alerted in ${Math.max(0, GRACE_S + left)} sec` : 'Tap "I\'m okay" before the timer ends.'}
              </Text>
            </View>
            <Text style={{ fontFamily: f.mono, fontSize: 28, color: overdue ? c.white : c.ink }}>
              {mm}:{ss}
            </Text>
          </Card>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Button tone="ok" label="I'm okay" onPress={checkIn} style={{ flex: 1 }} />
            <Button tone="ghost" label="I've arrived" onPress={() => end("arrived")} style={{ flex: 1 }} />
          </View>
          <Button tone="danger" label="I don't feel safe: send SOS" onPress={() => sos.start("manual")} style={{ marginTop: 12 }} />
          <Ladder />
          <Button tone="ghost" label="Cancel journey" onPress={() => end("cancelled")} style={{ marginTop: 14 }} />
        </>
      )}
      <Note>If the app is closed or your phone switches off, our server notices the missed check-in within about 3 minutes and alerts everyone in your circle who has SAAHI.</Note>
    </Screen>
  );
}

function Ladder() {
  const steps = [
    ["A buzz and a 30-second grace", "Easy to dismiss if you're just busy"],
    ["SOS starts: your circle gets your live location", "By text from your phone, and push for anyone with SAAHI"],
    ["They tap \"On it\" so you know who is coming", "You see each person's status on the SOS screen"],
    ["One tap to call 112", "From the SOS screen at any time"],
  ];
  return (
    <>
      <Section title="If I miss a check-in" />
      <View style={{ gap: 8 }}>
        {steps.map(([t, s], i) => (
          <View key={t} style={{ flexDirection: "row", gap: 10, alignItems: "center", borderWidth: 2, borderColor: c.ink, borderRadius: 14, padding: 12, backgroundColor: c.paper }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: f.bodyBold, color: c.paper, fontSize: 12 }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: f.bodySemi, fontSize: 14, color: c.ink }}>{t}</Text>
              <Text style={{ fontFamily: f.body, fontSize: 12, color: c.muted }}>{s}</Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );
}
