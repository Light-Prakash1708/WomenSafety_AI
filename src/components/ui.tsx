import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { c, f, hardShadow, radius } from "@/lib/theme";

export function Screen({
  children,
  scroll = true,
  bg = c.paper,
  padded = true,
  edges = ["top"],
}: {
  children: ReactNode;
  scroll?: boolean;
  bg?: string;
  padded?: boolean;
  edges?: ("top" | "bottom")[];
}) {
  const inner = padded ? { paddingHorizontal: 20, paddingBottom: 32 } : undefined;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function TopBar({ title, right, onLogoLongPress }: { title: string; right?: ReactNode; onLogoLongPress?: () => void }) {
  const router = useRouter();
  return (
    <View style={s.topbar}>
      <Pressable onLongPress={onLogoLongPress} delayLongPress={900} accessible={false}>
        <Text style={s.logo}>{title}</Text>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        {right}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quick exit to calculator"
          onPress={() => router.push("/calculator")}
          style={({ pressed }) => [s.exit, pressed && s.pressed]}
        >
          <Text style={s.exitTxt}>⇥ Quick exit</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.h1, style]}>{children}</Text>;
}

export function Sub({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.sub, style]}>{children}</Text>;
}

export function Section({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {hint ? <Text style={s.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, bg = c.paper, style }: { children: ReactNode; bg?: string; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, { backgroundColor: bg }, style]}>{children}</View>;
}

type BtnProps = Omit<PressableProps, "style" | "children"> & {
  label: string;
  tone?: "primary" | "ghost" | "danger" | "ok";
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, tone = "primary", loading, style, disabled, ...rest }: BtnProps) {
  const bg = tone === "primary" ? c.marigold : tone === "danger" ? c.sos : tone === "ok" ? c.sage : c.paper;
  const fg = tone === "danger" ? c.white : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, pressed && s.pressed, style]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnTxt, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Chip({ label, onPress, active, bg }: { label: string; onPress?: () => void; active?: boolean; bg?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [s.chip, { backgroundColor: active ? c.ink : bg ?? c.paper }, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.chipTxt, active && { color: c.paper }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...rest }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={c.muted} style={[s.input, rest.multiline && { minHeight: 96, textAlignVertical: "top" }]} {...rest} />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={s.toggleRow}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.toggleLabel}>{label}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
      <View style={[s.sw, value && { backgroundColor: c.sage }]}>
        <View style={[s.knob, value && { left: 20 }]} />
      </View>
    </Pressable>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <View style={s.note}>
      <Text style={s.noteTxt}>{children}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={s.err}>{children}</Text>;
}

export const s = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 14 },
  logo: { fontFamily: f.display, fontSize: 24, color: c.ink, letterSpacing: -0.5 },
  exit: { borderWidth: 2, borderColor: c.ink, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: c.paper, ...hardShadow(2) },
  exitTxt: { fontFamily: f.bodyBold, fontSize: 12, color: c.ink },
  pressed: { transform: [{ translateX: 2 }, { translateY: 2 }], shadowOffset: { width: 1, height: 1 } },
  h1: { fontFamily: f.display, fontSize: 30, lineHeight: 33, color: c.ink, letterSpacing: -0.6, marginTop: 4, marginBottom: 6 },
  sub: { fontFamily: f.body, fontSize: 15, color: c.muted, marginBottom: 16, lineHeight: 21 },
  section: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 24, marginBottom: 10 },
  sectionTitle: { fontFamily: f.displayBold, fontSize: 19, color: c.ink },
  sectionHint: { fontFamily: f.bodySemi, fontSize: 12, color: c.muted },
  card: { borderWidth: 2, borderColor: c.ink, borderRadius: radius.xl, padding: 14, ...hardShadow(3) },
  btn: { borderWidth: 2, borderColor: c.ink, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 50, ...hardShadow(3) },
  btnTxt: { fontFamily: f.bodyBold, fontSize: 15.5 },
  chip: { borderWidth: 2, borderColor: c.ink, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" },
  chipTxt: { fontFamily: f.bodyBold, fontSize: 12.5, color: c.ink },
  label: { fontFamily: f.bodyBold, fontSize: 13.5, color: c.ink },
  hint: { fontFamily: f.body, fontSize: 12.5, color: c.muted, lineHeight: 17 },
  input: { borderWidth: 2, borderColor: c.ink, borderRadius: radius.md, backgroundColor: c.white, paddingHorizontal: 14, paddingVertical: 12, fontFamily: f.bodyMed, fontSize: 16, color: c.ink },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  toggleLabel: { fontFamily: f.bodySemi, fontSize: 15, color: c.ink },
  sw: { width: 46, height: 28, borderRadius: 14, borderWidth: 2, borderColor: c.ink, backgroundColor: c.paper, justifyContent: "center" },
  knob: { position: "absolute", left: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: c.ink },
  note: { marginTop: 14, padding: 12, borderRadius: radius.md, borderWidth: 2, borderStyle: "dashed", borderColor: "#B8B2CC" },
  noteTxt: { fontFamily: f.body, fontSize: 12.5, color: c.muted, lineHeight: 18 },
  err: { fontFamily: f.bodySemi, fontSize: 13.5, color: c.sosDeep, marginTop: 8 },
});
