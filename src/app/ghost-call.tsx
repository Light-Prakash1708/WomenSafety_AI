// A believable incoming call she can use to leave an uncomfortable situation.
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { IconPhone } from "@/components/icons";
import { usePrefs } from "@/lib/prefs";
import { f } from "@/lib/theme";

export default function GhostCall() {
  const router = useRouter();
  const [prefs] = usePrefs();
  const [phase, setPhase] = useState<"wait" | "ringing" | "talking">("wait");
  const [secs, setSecs] = useState(5);
  const [talk, setTalk] = useState(0);

  useEffect(() => {
    if (phase !== "wait") return;
    const id = setTimeout(() => {
      if (secs <= 1) setPhase("ringing");
      setSecs((s) => s - 1);
    }, 1000);
    return () => clearTimeout(id);
  }, [phase, secs]);

  useEffect(() => {
    if (phase !== "ringing") return;
    Vibration.vibrate([0, 900, 600], true);
    return () => Vibration.cancel();
  }, [phase]);

  useEffect(() => {
    if (phase !== "talking") return;
    const id = setInterval(() => setTalk((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const name = prefs.ghostCaller || "Didi";

  if (phase === "wait") {
    return (
      <SafeAreaView style={[st.root, { justifyContent: "center", alignItems: "center" }]}>
        <StatusBar style="light" />
        <Text style={st.small}>Your call from {name} rings in</Text>
        <Text style={[st.name, { fontSize: 72 }]}>{secs}</Text>
        <Text style={st.small}>Lock your screen or put the phone in your pocket.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 30 }}>
          <Text style={[st.small, { textDecorationLine: "underline" }]}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.root}>
      <StatusBar style="light" />
      <View style={{ alignItems: "center", marginTop: 70 }}>
        <View style={st.av}>
          <Text style={{ fontFamily: f.display, fontSize: 40, color: "#1C1633" }}>{name.slice(0, 1)}</Text>
        </View>
        <Text style={st.name}>{name}</Text>
        <Text style={st.small}>
          {phase === "ringing" ? "mobile · incoming call" : `${String(Math.floor(talk / 60)).padStart(2, "0")}:${String(talk % 60).padStart(2, "0")}`}
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      <View style={st.acts}>
        <Pressable accessibilityRole="button" accessibilityLabel="Decline" onPress={() => router.back()} style={[st.btn, { backgroundColor: "#FF3B30", transform: [{ rotate: "135deg" }] }]}>
          <IconPhone size={30} color="#fff" />
        </Pressable>
        {phase === "ringing" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Accept"
            onPress={() => {
              Vibration.cancel();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setPhase("talking");
            }}
            style={[st.btn, { backgroundColor: "#34C759" }]}
          >
            <IconPhone size={30} color="#fff" />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#211D33", paddingBottom: 50 },
  av: { width: 100, height: 100, borderRadius: 50, backgroundColor: "#FFC24B", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "#fff" },
  name: { color: "#fff", fontSize: 34, fontWeight: "500", marginTop: 18 },
  small: { color: "#C9C4DC", fontSize: 16, marginTop: 4, textAlign: "center", paddingHorizontal: 30 },
  acts: { flexDirection: "row", justifyContent: "space-evenly", width: "100%", maxWidth: 420, alignSelf: "center" },
  btn: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
});
