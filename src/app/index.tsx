import { Redirect } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { c, f } from "@/lib/theme";

export default function Gate() {
  const { session, profile, offline, refresh } = useApp();
  const [busy, setBusy] = useState(false);

  if (offline && !profile) {
    return (
      <View style={{ flex: 1, padding: 28, justifyContent: "center", alignItems: "center", backgroundColor: c.paper }}>
        <View style={{ width: "100%", maxWidth: 420, gap: 12 }}>
          <Text style={{ fontFamily: f.display, fontSize: 28, color: c.ink }}>Can't reach SAAHI</Text>
          <Text style={{ fontFamily: f.body, fontSize: 15, color: c.muted, lineHeight: 22 }}>
            Check your internet connection and try again. In an emergency, call 112 directly.
          </Text>
          <Button
            label="Try again"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              await refresh();
              setBusy(false);
            }}
          />
        </View>
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;
  if (!profile) return null;
  if (!profile.onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
