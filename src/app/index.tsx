import { Redirect } from "expo-router";
import { Text, View } from "react-native";
import { useApp } from "@/lib/app-state";
import { c, f } from "@/lib/theme";

export default function Gate() {
  const { configured, session, profile } = useApp();

  if (!configured) {
    return (
      <View style={{ flex: 1, padding: 28, justifyContent: "center", backgroundColor: c.paper, gap: 12 }}>
        <Text style={{ fontFamily: f.display, fontSize: 28, color: c.ink }}>Connect your backend</Text>
        <Text style={{ fontFamily: f.body, fontSize: 15, color: c.muted, lineHeight: 22 }}>
          SAAHI needs a Supabase project. Copy .env.example to .env, add EXPO_PUBLIC_SUPABASE_URL and
          EXPO_PUBLIC_SUPABASE_ANON_KEY, then restart with npx expo start --clear. The README walks through it.
        </Text>
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;
  if (!profile) return null;
  if (!profile.onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
