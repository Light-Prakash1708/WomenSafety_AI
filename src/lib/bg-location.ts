// Background location for an active SOS or journey. Must be imported once at app start
// so TaskManager.defineTask runs in the top-level scope.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { supabase } from "./supabase";

export const BG_TASK = "saahi-live-location";
const ACTIVE_KEY = "saahi.active-share";

type Share = { alertId?: string; journeyId?: string; ownerId: string };

export async function setActiveShare(s: Share | null) {
  if (s) await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(s));
  else await AsyncStorage.removeItem(ACTIVE_KEY);
}

async function getActiveShare(): Promise<Share | null> {
  const raw = await AsyncStorage.getItem(ACTIVE_KEY);
  return raw ? (JSON.parse(raw) as Share) : null;
}

export async function pushLocation(loc: Location.LocationObject, share?: Share | null) {
  const s = share ?? (await getActiveShare());
  if (!s) return;
  const { latitude: lat, longitude: lng, accuracy } = loc.coords;
  if (s.alertId && !s.alertId.startsWith("local-")) {
    await supabase.from("alert_locations").insert({ alert_id: s.alertId, owner_id: s.ownerId, lat, lng, accuracy });
  }
  if (s.journeyId) {
    await supabase.from("journeys").update({ last_lat: lat, last_lng: lng }).eq("id", s.journeyId);
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BG_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const latest = data.locations[data.locations.length - 1];
  try {
    await pushLocation(latest);
  } catch {
    // Network can drop mid-emergency; the next update will try again.
  }
});

/** Starts background updates if allowed. Returns false if only foreground tracking is possible. */
export async function startBackgroundShare(): Promise<boolean> {
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted) return false;
    if (await Location.hasStartedLocationUpdatesAsync(BG_TASK)) return true;
    await Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 10000,
      distanceInterval: 10,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: "SAAHI is sharing your location",
        notificationBody: "Your circle can see where you are until you stop sharing.",
        notificationColor: "#E8372F",
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundShare() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_TASK)) await Location.stopLocationUpdatesAsync(BG_TASK);
  } catch {
    // Already stopped.
  }
}
