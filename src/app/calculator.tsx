// Quick exit: a fully working calculator. Long-press AC (about 1 second) to return to SAAHI.
// The Android back button is swallowed so the disguise can't be undone by accident.
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Op = "+" | "−" | "×" | "÷";
const ops: Record<Op, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "−": (a, b) => a - b,
  "×": (a, b) => a * b,
  "÷": (a, b) => (b === 0 ? NaN : a / b),
};

const KEYS: { k: string; kind: "fn" | "op" | "num"; wide?: boolean }[] = [
  { k: "AC", kind: "fn" }, { k: "±", kind: "fn" }, { k: "%", kind: "fn" }, { k: "÷", kind: "op" },
  { k: "7", kind: "num" }, { k: "8", kind: "num" }, { k: "9", kind: "num" }, { k: "×", kind: "op" },
  { k: "4", kind: "num" }, { k: "5", kind: "num" }, { k: "6", kind: "num" }, { k: "−", kind: "op" },
  { k: "1", kind: "num" }, { k: "2", kind: "num" }, { k: "3", kind: "num" }, { k: "+", kind: "op" },
  { k: "0", kind: "num", wide: true }, { k: ".", kind: "num" }, { k: "=", kind: "op" },
];

const fmt = (n: number) => (Number.isFinite(n) ? String(+n.toPrecision(10)) : "Error");

export default function Calculator() {
  const router = useRouter();
  const [cur, setCur] = useState("0");
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const press = (k: string) => {
    if (/^\d$/.test(k)) {
      setCur((c) => (c === "0" || fresh ? k : c.length < 12 ? c + k : c));
      setFresh(false);
    } else if (k === ".") {
      setCur((c) => (fresh ? "0." : c.includes(".") ? c : c + "."));
      setFresh(false);
    } else if (k === "AC") {
      setCur("0");
      setAcc(null);
      setOp(null);
    } else if (k === "±") setCur((c) => fmt(-parseFloat(c)));
    else if (k === "%") setCur((c) => fmt(parseFloat(c) / 100));
    else if (k === "=") {
      if (op && acc != null) {
        setCur(fmt(ops[op](acc, parseFloat(cur))));
        setAcc(null);
        setOp(null);
        setFresh(true);
      }
    } else {
      const v = parseFloat(cur);
      setAcc(op && acc != null && !fresh ? ops[op](acc, v) : v);
      if (op && acc != null && !fresh) setCur(fmt(ops[op](acc, v)));
      setOp(k as Op);
      setFresh(true);
    }
  };

  return (
    <SafeAreaView style={st.root}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }} />
      <Text style={st.disp} numberOfLines={1} adjustsFontSizeToFit>
        {cur}
      </Text>
      <View style={st.grid}>
        {KEYS.map(({ k, kind, wide }) => (
          <Pressable
            key={k}
            onPress={() => press(k)}
            onLongPress={k === "AC" ? () => router.replace("/(tabs)") : undefined}
            delayLongPress={900}
            style={({ pressed }) => [
              st.key,
              wide && st.wide,
              kind === "fn" && { backgroundColor: "#A5A5A5" },
              kind === "op" && { backgroundColor: op === k && fresh ? "#FFFFFF" : "#FF9F0A" },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[st.keyTxt, kind === "fn" && { color: "#000" }, kind === "op" && op === k && fresh && { color: "#FF9F0A" }, wide && { textAlign: "left", width: "100%", paddingLeft: 30 }]}>
              {k}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", paddingHorizontal: 16, paddingBottom: 24 },
  disp: { color: "#fff", fontSize: 80, fontWeight: "300", textAlign: "right", paddingHorizontal: 12, marginBottom: 12, fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 14 },
  key: { width: "22.5%", aspectRatio: 1, borderRadius: 999, backgroundColor: "#333", alignItems: "center", justifyContent: "center" },
  wide: { width: "48%", aspectRatio: undefined, height: undefined },
  keyTxt: { color: "#fff", fontSize: 32 },
});
