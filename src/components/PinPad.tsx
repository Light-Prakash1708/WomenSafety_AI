import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { c, f } from "@/lib/theme";

/** Full-screen 4-digit keypad. onSubmit returns an error message, or null to close. */
export function PinPad({ title, onSubmit, onClose }: { title: string; onSubmit: (pin: string) => Promise<string | null>; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const press = async (k: string) => {
    if (k === "del") return setPin((p) => p.slice(0, -1));
    if (pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) {
      const e = await onSubmit(next);
      if (e) {
        setErr(e);
        setPin("");
      }
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <View style={st.root}>
      <Text style={st.title}>{title}</Text>
      <View style={st.dots}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[st.dot, i < pin.length && { backgroundColor: c.nightFg }]} />
        ))}
      </View>
      <Text style={st.err}>{err}</Text>
      <View style={st.grid}>
        {keys.map((k, i) =>
          k === "" ? (
            <View key={i} style={st.key} />
          ) : (
            <Pressable
              key={i}
              onPress={() => press(k)}
              accessibilityRole="button"
              accessibilityLabel={k === "del" ? "Delete" : k}
              style={({ pressed }) => [st.key, st.keyBg, pressed && { opacity: 0.6 }]}
            >
              <Text style={st.keyTxt}>{k === "del" ? "⌫" : k}</Text>
            </Pressable>
          ),
        )}
      </View>
      <Pressable onPress={onClose} style={{ marginTop: 24 }}>
        <Text style={{ fontFamily: f.bodySemi, color: c.nightMuted }}>Back to alert</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: c.night, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontFamily: f.displayBold, fontSize: 22, color: c.nightFg },
  dots: { flexDirection: "row", gap: 16, marginTop: 22 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: c.nightFg },
  err: { fontFamily: f.bodySemi, color: "#FF8A82", fontSize: 13, minHeight: 22, marginTop: 12, textAlign: "center" },
  grid: { width: 264, flexDirection: "row", flexWrap: "wrap", gap: 18, justifyContent: "center", marginTop: 6 },
  key: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  keyBg: { backgroundColor: c.night2 },
  keyTxt: { fontFamily: f.displaySemi, fontSize: 28, color: c.nightFg },
});
