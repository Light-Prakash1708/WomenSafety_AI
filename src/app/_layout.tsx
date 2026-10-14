import "@/lib/bg-location";
import "@/lib/notifications";
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppStateProvider, useApp } from "@/lib/app-state";
import { SosProvider } from "@/lib/sos";
import { c } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const { ready } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // A guardian tapping an SOS push lands on that alert.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data as { alertId?: string; kind?: string };
      if (data?.kind === "checkin") router.push("/walk");
      else if (data?.alertId) router.push({ pathname: "/guardian/[id]", params: { id: data.alertId } });
    });
    return () => sub.remove();
  }, [router]);

  if (!ready) return null;
  return (
    <SosProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sos" options={{ presentation: "fullScreenModal", gestureEnabled: false, animation: "fade" }} />
        <Stack.Screen name="calculator" options={{ presentation: "fullScreenModal", gestureEnabled: false, animation: "none" }} />
        <Stack.Screen name="ghost-call" options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }} />
        <Stack.Screen name="entry" options={{ presentation: "modal" }} />
        <Stack.Screen name="contacts" options={{ presentation: "modal" }} />
        <Stack.Screen name="settings" options={{ presentation: "modal" }} />
        <Stack.Screen name="report-area" options={{ presentation: "modal" }} />
        <Stack.Screen name="guardian/[id]" />
      </Stack>
    </SosProvider>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    JetBrainsMono_500Medium,
  });
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <Shell />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
