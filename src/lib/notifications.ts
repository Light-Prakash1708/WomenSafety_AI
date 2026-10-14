import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("sos", {
    name: "SOS alerts from your circle",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: "#E8372F",
    bypassDnd: true,
  });
  await Notifications.setNotificationChannelAsync("checkins", {
    name: "Walk with me check-ins",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Asks for notification permission and stores this phone's Expo push token on her profile. */
export async function registerPush(userId: string): Promise<boolean> {
  try {
    await setupChannels();
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return false;
    if (!Device.isDevice) return true;
    const projectId =
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID || (Constants.expoConfig?.extra?.eas?.projectId as string | undefined);
    if (!projectId) return true;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    await supabase.from("profiles").update({ expo_push_token: token.data }).eq("id", userId);
    return true;
  } catch {
    return false;
  }
}

export async function scheduleCheckin(seconds: number, destination: string): Promise<string | null> {
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: "Check in with SAAHI",
        body: `Tap "I'm okay" for your walk to ${destination}, or your circle will be alerted.`,
        data: { kind: "checkin" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(5, Math.round(seconds)),
        channelId: "checkins",
      },
    });
  } catch {
    return null;
  }
}

export async function cancelScheduled(id: string | null) {
  if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}
