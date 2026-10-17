import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { Button, Card, Chip, ErrorText, Field, H1, Note, Screen, Sub } from "@/components/ui";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-state";
import { c, f } from "@/lib/theme";

type Mode = "signin" | "signup" | "recover";
type AuthResult = { token: string; recoveryCode?: string };

export default function SignIn() {
  const router = useRouter();
  const { signIn } = useApp();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newCode, setNewCode] = useState<{ code: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      if (mode === "signin") {
        const r = await api<AuthResult>("POST", "auth/login", { email: email.trim(), password });
        await signIn(r.token);
        router.replace("/");
      } else if (mode === "signup") {
        const r = await api<AuthResult>("POST", "auth/signup", { email: email.trim(), password });
        setNewCode({ code: r.recoveryCode!, token: r.token });
      } else {
        const r = await api<AuthResult>("POST", "auth/recover", { email: email.trim(), recoveryCode: code, password });
        setNewCode({ code: r.recoveryCode!, token: r.token });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await (globalThis.navigator as Navigator | undefined)?.clipboard?.writeText(newCode!.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // Shown once after sign-up or a reset: the only way back in if she forgets her password.
  if (newCode) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={{ marginTop: 48, gap: 14 }}>
          <H1>Save your recovery code</H1>
          <Sub>If you forget your password, this code is the only way back into your account. Write it down or save it somewhere private. We can't show it again.</Sub>
          <Card bg={c.marigold}>
            <Text selectable testID="recovery-code" style={{ fontFamily: f.mono, fontSize: 24, color: c.ink, textAlign: "center", letterSpacing: 1 }}>
              {newCode.code}
            </Text>
          </Card>
          {Platform.OS === "web" && <Button tone="ghost" label={copied ? "Copied" : "Copy code"} onPress={copy} />}
          <Button
            label="I've saved it"
            onPress={async () => {
              await signIn(newCode.token);
              router.replace("/");
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ marginTop: 56, marginBottom: 28 }}>
          <Text style={{ fontFamily: f.display, fontSize: 64, color: c.ink, letterSpacing: -2, lineHeight: 64 }}>saahi.</Text>
          <Text style={{ fontFamily: f.displaySemi, fontSize: 20, color: c.ink, marginTop: 10, lineHeight: 25 }}>
            A safety network that remembers the pattern, signals quietly and shows you help is coming.
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
          <Chip label="Sign in" active={mode === "signin"} onPress={() => { setMode("signin"); setErr(""); }} />
          <Chip label="Create account" active={mode === "signup"} onPress={() => { setMode("signup"); setErr(""); }} />
        </View>
        <View style={{ gap: 14 }}>
          <H1 style={{ fontSize: 22 }}>
            {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}
          </H1>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
          {mode === "recover" && (
            <Field label="Recovery code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="ABCD-EFGH-JKLM-NPQR" hint="The code you saved when you created your account." />
          )}
          <Field
            label={mode === "recover" ? "New password" : "Password"}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder="At least 8 characters"
            onSubmitEditing={submit}
          />
          <ErrorText>{err}</ErrorText>
          <Button
            label={mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password"}
            onPress={submit}
            loading={busy}
            disabled={!email.trim() || password.length < (mode === "signin" ? 1 : 8) || (mode === "recover" && !code.trim())}
          />
          {mode === "signin" && (
            <Pressable onPress={() => { setMode("recover"); setErr(""); }} accessibilityRole="button" style={{ alignSelf: "center", padding: 6 }}>
              <Text style={{ fontFamily: f.bodySemi, fontSize: 14, color: c.ink, textDecorationLine: "underline" }}>Forgot your password?</Text>
            </Pressable>
          )}
          {mode === "recover" && <Button tone="ghost" label="Back to sign in" onPress={() => setMode("signin")} />}
          <Note>Your email is only used to sign you in. In an emergency, call 112 directly.</Note>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
