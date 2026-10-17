import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconMic, IconPeople, IconPin, IconSignal } from "@/components/icons";
import { PinPad } from "@/components/PinPad";
import { useApp } from "@/lib/app-state";
import { isWeb } from "@/lib/layout";
import { useSos } from "@/lib/sos";
import type { Recipient } from "@/lib/api";
import { c, f } from "@/lib/theme";

const STATUS: Record<Recipient["status"], { label: string; tone: "wait" | "sent" | "ack" | "fail" }> = {
  queued: { label: "Queued", tone: "wait" },
  sent: { label: "Sent", tone: "sent" },
  opened: { label: "Opened link", tone: "sent" },
  acknowledged: { label: "On it", tone: "ack" },
  failed: { label: "Not delivered", tone: "fail" },
};

export default function SosScreen() {
  const router = useRouter();
  const { t, contacts, profile } = useApp();
  const sos = useSos();
  const [pinOpen, setPinOpen] = useState(false);
  const [ended, setEnded] = useState<null | "cancel" | "duress">(null);
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (ended) {
    return (
      <SafeAreaView style={[st.root, { justifyContent: "center", paddingHorizontal: 24, alignItems: "center" }]}>
        <View style={{ width: "100%", maxWidth: 480 }}>
        <Text style={st.title}>{t("cancelled")}</Text>
        <Text style={[st.sub, { marginBottom: 28 }]}>
          {ended === "cancel" ? "Sharing has stopped. Any audio was saved to your vault." : "Sharing has stopped."}
        </Text>
        {ended === "cancel" && contacts.length > 0 && isWeb && (
          <SendOptions message={`${(profile?.display_name || "I").split(" ")[0]} is safe now. Thank you. (SAAHI)`} title="Tell your circle you're safe" copyLabel="Copy message" />
        )}
        {ended === "cancel" && contacts.length > 0 && !isWeb && (
          <Pressable style={[st.btn, st.safe]} onPress={sos.sendSafeMessage}>
            <Text style={[st.btnTxt, { color: "#06210F" }]}>Tell my circle I'm safe</Text>
          </Pressable>
        )}
        <Pressable style={[st.btn, { marginTop: 10 }]} onPress={() => router.dismissTo("/(tabs)")}>
          <Text style={st.btnTxt}>Done</Text>
        </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!sos.alert) {
    return (
      <SafeAreaView style={[st.root, { justifyContent: "center", padding: 24 }]}>
        <Text style={st.title}>No active alert</Text>
        <Pressable style={[st.btn, { marginTop: 20 }]} onPress={() => router.dismissTo("/(tabs)")}>
          <Text style={st.btnTxt}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const loc = sos.location;
  const acked = sos.recipients.filter((r) => r.status === "acknowledged").length;
  const mm = String(Math.floor(sos.recordingSecs / 60)).padStart(2, "0");
  const ss = String(sos.recordingSecs % 60).padStart(2, "0");

  const smsLine =
    sos.sms === "sent"
      ? "Text sent from your phone"
      : sos.sms === "opened"
        ? "Text opened in Messages. Tap send if you haven't."
        : sos.sms === "cancelled"
          ? "Text not sent. Tap to try again."
          : sos.sms === "unavailable"
            ? isWeb
              ? "Send it to each person below"
              : "This phone can't send texts"
            : "Preparing text message";

  return (
    <SafeAreaView style={st.root} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, width: "100%", maxWidth: 560, alignSelf: "center" }}>
        <View style={st.pulseWrap}>
          {[0, 0.5].map((d) => (
            <Animated.View
              key={d}
              style={[
                st.ring,
                {
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55 + d * 0.2, 1.15] }) }],
                },
              ]}
            />
          ))}
          <View style={st.core}>
            <IconSignal />
          </View>
        </View>
        <Text style={st.title}>{sos.phase === "duress" ? "Still sharing quietly" : acked ? `${acked} ${acked === 1 ? "person is" : "people are"} coming` : t("helpOnWay")}</Text>
        <Text style={st.sub}>
          {loc
            ? `Live location ±${Math.round(loc.coords.accuracy ?? 0)} m · ${sos.backgroundSharing ? "keeps sharing when locked" : "keep SAAHI open to keep sharing"}`
            : "Finding your location…"}
        </Text>

        <View style={{ gap: 8 }}>
          <Row icon={<IconPin color={c.nightFg} />} title="Location" sub={loc ? `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}` : "Waiting for GPS"} status={loc ? { label: "Locked", tone: "ack" } : { label: "Searching", tone: "wait" }} />
          <Row
            icon={<IconSignal size={18} color={c.nightFg} />}
            title="Live link"
            sub={sos.alert.local ? "No internet. Your text has a map link instead. Retrying every 20 sec." : "Your circle can follow you live"}
            status={sos.alert.local ? { label: "Offline", tone: "fail" } : { label: "Live", tone: "ack" }}
          />
          <Pressable onPress={sos.sms === "cancelled" || sos.sms === "opened" ? sos.resendSms : undefined}>
            <Row
              icon={<IconPeople color={c.nightFg} />}
              title="Text to your circle"
              sub={smsLine}
              status={
                sos.sms === "sent"
                  ? { label: "Sent", tone: "sent" }
                  : sos.sms === "unavailable" && isWeb
                    ? { label: "Your turn", tone: "sent" }
                    : sos.sms === "cancelled" || sos.sms === "unavailable"
                      ? { label: "Not sent", tone: "fail" }
                    : { label: "Waiting", tone: "wait" }
              }
            />
          </Pressable>
          {sos.recipients.map((r) => (
            <Row
              key={r.id}
              icon={<Text style={{ fontFamily: f.bodyBold, color: c.nightFg }}>{r.name.slice(0, 2)}</Text>}
              title={r.name}
              sub={r.message || (r.channel === "push" ? "via SAAHI app" : "via text message")}
              status={STATUS[r.status]}
            />
          ))}
          <Row icon={<Text style={{ fontFamily: f.bodyBold, color: c.nightFg }}>112</Text>} title="112 India" sub="Police, ambulance and fire. Tap the button below to call." status={{ label: "Ready", tone: "wait" }} />
        </View>

        {sos.sms === "unavailable" && contacts.length > 0 && <SendOptions message={sos.messageText} />}

        {sos.recording && (
          <View style={st.rec}>
            <IconMic size={16} color={c.sos} />
            <Text style={st.recTxt}>
              Recording to your vault · {mm}:{ss}
            </Text>
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          <Pressable style={[st.btn, { flex: 1 }]} onPress={sos.call112} accessibilityRole="button">
            <Text style={st.btnTxt}>{t("call112")}</Text>
          </Pressable>
          <Pressable style={[st.btn, st.safe, { flex: 1 }]} onPress={() => setPinOpen(true)} accessibilityRole="button">
            <Text style={[st.btnTxt, { color: "#06210F" }]}>{t("imSafe")}</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => router.dismissTo("/(tabs)")} style={{ alignItems: "center", marginTop: 16 }}>
          <Text style={{ fontFamily: f.bodySemi, color: c.nightMuted, fontSize: 13 }}>Hide this screen (alert keeps running)</Text>
        </Pressable>
      </ScrollView>

      {pinOpen && (
        <PinPad
          title={t("enterPin")}
          onClose={() => setPinOpen(false)}
          onSubmit={async (pin) => {
            const r = await sos.submitPin(pin);
            if (r === "wrong") return "Wrong PIN. Your alert is still active.";
            setPinOpen(false);
            setEnded(r === "cancel" ? "cancel" : "duress");
            return null;
          }}
        />
      )}
    </SafeAreaView>
  );
}

/** When this device can't send texts (a computer, a tablet), give one tap per person instead. */
function SendOptions({ message, title = "Send your alert", copyLabel = "Copy alert message" }: { message: string; title?: string; copyLabel?: string }) {
  const { contacts } = useApp();
  const [copied, setCopied] = useState(false);
  const text = encodeURIComponent(message);
  const copy = async () => {
    try {
      await (globalThis.navigator as Navigator | undefined)?.clipboard?.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <View style={st.send}>
      <Text style={st.rowTitle}>{title}</Text>
      <Text style={[st.rowSub, { marginBottom: 10 }]}>Each button opens a message ready to send.</Text>
      {contacts.map((ct) => {
        const digits = ct.phone.replace(/\D/g, "");
        return (
          <View key={ct.id} style={st.sendRow}>
            <Text style={[st.rowTitle, { flex: 1 }]} numberOfLines={1}>
              {ct.name}
            </Text>
            <Pressable style={[st.chip, { backgroundColor: "#25D366" }]} accessibilityRole="link" onPress={() => Linking.openURL(`https://wa.me/${digits}?text=${text}`)}>
              <Text style={[st.chipTxt, { color: "#06210F" }]}>WhatsApp</Text>
            </Pressable>
            <Pressable style={st.chip} accessibilityRole="link" onPress={() => Linking.openURL(`sms:${ct.phone}?&body=${text}`)}>
              <Text style={st.chipTxt}>Text</Text>
            </Pressable>
          </View>
        );
      })}
      <Pressable style={[st.btn, { marginTop: 10 }]} onPress={copy} accessibilityRole="button">
        <Text style={st.btnTxt}>{copied ? "Copied. Paste it anywhere." : copyLabel}</Text>
      </Pressable>
    </View>
  );
}

function Row({ icon, title, sub, status }: { icon: ReactNode; title: string; sub: string; status: { label: string; tone: "wait" | "sent" | "ack" | "fail" } }) {
  const tone = {
    wait: { bg: "rgba(242,238,255,0.12)", fg: c.nightMuted },
    sent: { bg: "rgba(255,194,75,0.22)", fg: c.marigold },
    ack: { bg: "rgba(91,211,138,0.2)", fg: c.ackGreen },
    fail: { bg: "rgba(232,55,47,0.25)", fg: "#FF8A82" },
  }[status.tone];
  return (
    <View style={st.row}>
      <View style={st.ico}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle}>{title}</Text>
        <Text style={st.rowSub}>{sub}</Text>
      </View>
      <View style={[st.pill, { backgroundColor: tone.bg }]}>
        <Text style={[st.pillTxt, { color: tone.fg }]}>{status.label}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.night },
  pulseWrap: { width: 130, height: 130, alignSelf: "center", alignItems: "center", justifyContent: "center", marginTop: 12 },
  ring: { position: "absolute", width: 130, height: 130, borderRadius: 65, borderWidth: 2, borderColor: c.sos },
  core: { width: 68, height: 68, borderRadius: 34, backgroundColor: c.sos, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: f.display, fontSize: 28, color: c.nightFg, textAlign: "center", marginTop: 8 },
  sub: { fontFamily: f.body, fontSize: 13.5, color: c.nightMuted, textAlign: "center", marginTop: 4, marginBottom: 18, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.night2, borderRadius: 16, padding: 12, borderWidth: 1.5, borderColor: "rgba(242,238,255,0.1)" },
  ico: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(242,238,255,0.08)", alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: f.bodyBold, fontSize: 14.5, color: c.nightFg },
  rowSub: { fontFamily: f.body, fontSize: 12.5, color: c.nightMuted, marginTop: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  pillTxt: { fontFamily: f.bodyBold, fontSize: 11 },
  rec: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14 },
  recTxt: { fontFamily: f.mono, fontSize: 12, color: c.nightMuted },
  btn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", backgroundColor: c.night2, borderWidth: 1.5, borderColor: "rgba(242,238,255,0.2)" },
  safe: { backgroundColor: "#2FBF6B", borderColor: "#2FBF6B" },
  btnTxt: { fontFamily: f.bodyBold, fontSize: 15, color: c.nightFg },
  send: { marginTop: 14, backgroundColor: c.night2, borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: "rgba(255,194,75,0.45)" },
  sendRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "rgba(242,238,255,0.12)" },
  chipTxt: { fontFamily: f.bodyBold, fontSize: 12.5, color: c.nightFg },
});
