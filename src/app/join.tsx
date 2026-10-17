// A guardian opens the invite link (or types the code) to receive someone's alerts in the app.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button, Card, ErrorText, Field, H1, Note, Screen, Sub } from "@/components/ui";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-state";
import { registerPush } from "@/lib/notifications";
import { c } from "@/lib/theme";

export default function Join() {
  const params = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const { session } = useApp();
  const [code, setCode] = useState((params.code ?? "").toUpperCase());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const join = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await api<{ name: string }>("POST", "guardian/join", { code });
      if (session) registerPush(session.user.id).catch(() => {});
      setDone(r.name);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ height: 24 }} />
      {done ? (
        <View style={{ gap: 14 }}>
          <H1>You're {done}'s guardian</H1>
          <Card bg={c.sage}>
            <Sub style={{ color: c.ink, marginBottom: 0 }}>If {done} sends an SOS, it shows up on your SAAHI home screen with her live location, and you can tell her you're on your way.</Sub>
          </Card>
          <Button label="Go to SAAHI" onPress={() => router.replace("/")} />
        </View>
      ) : !session ? (
        <View style={{ gap: 14 }}>
          <H1>Become a guardian</H1>
          <Sub>Sign in or create a free account first, then open this invite again.</Sub>
          <Button label="Sign in or create account" onPress={() => router.push("/sign-in")} />
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          <H1>Become a guardian</H1>
          <Sub>Enter the 8-character code someone sent you. You'll see their SOS alerts in this app.</Sub>
          <Field label="Guardian code" value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" maxLength={9} placeholder="ABCD2345" />
          <ErrorText>{err}</ErrorText>
          <Button label="Join their circle" onPress={join} loading={busy} disabled={code.replace(/[^A-Z0-9]/g, "").length !== 8} />
          <Button tone="ghost" label="Not now" onPress={() => router.replace("/")} />
          <Note>Guardians only see an alert while it's active. Nothing else in her account is shared with you.</Note>
        </View>
      )}
    </Screen>
  );
}
