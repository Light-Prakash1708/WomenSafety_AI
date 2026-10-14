import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { Button, ErrorText, Field, H1, Screen, Sub } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { c, f } from "@/lib/theme";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const send = async () => {
    setErr("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr("Enter a valid email address.");
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) return setErr(error.message);
    setStep("code");
  };

  const verify = async () => {
    setErr("");
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return setErr("That code didn't work. Check the latest email, or send a new code.");
    router.replace("/");
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ marginTop: 56, marginBottom: 28 }}>
          <Text style={{ fontFamily: f.display, fontSize: 64, color: c.ink, letterSpacing: -2, lineHeight: 64 }}>saahi.</Text>
          <Text style={{ fontFamily: f.displaySemi, fontSize: 20, color: c.ink, marginTop: 10, lineHeight: 25 }}>
            A safety network that remembers the pattern, signals quietly and shows you help is coming.
          </Text>
        </View>
        {step === "email" ? (
          <View style={{ gap: 14 }}>
            <H1 style={{ fontSize: 22 }}>Sign in or create an account</H1>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
            <ErrorText>{err}</ErrorText>
            <Button label="Send me a code" onPress={send} loading={busy} />
            <Sub style={{ fontSize: 12.5 }}>We use your email only to sign you in. No passwords to remember.</Sub>
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <H1 style={{ fontSize: 22 }}>Enter the 6-digit code</H1>
            <Sub>Sent to {email.trim()}</Sub>
            <Field label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" placeholder="123456" />
            <ErrorText>{err}</ErrorText>
            <Button label="Continue" onPress={verify} loading={busy} disabled={code.trim().length < 6} />
            <Button label="Use a different email" tone="ghost" onPress={() => setStep("email")} />
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
