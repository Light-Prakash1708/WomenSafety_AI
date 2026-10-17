// The SOS engine. One alert at a time, shared across every screen.
//
// What happens when she triggers SOS:
//  1. Location is fixed (fresh GPS, or last known if GPS is slow).
//  2. An alert row is created. If the server can't be reached, a local alert is used
//     and the text message carries a Google Maps link instead of the live link.
//  3. Guardians with the app get a push (sos-dispatch). Everyone gets a prefilled SMS from her phone.
//  4. Live location streams every ~10 s (background too, if she allowed it).
//  5. Audio records into her vault, if she turned that on.
//  6. Acknowledgements arrive over realtime, so she sees who is actually coming.
//
// Duress: the duress PIN makes her screen look cancelled while all of the above keeps running.
import * as Battery from "expo-battery";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as Network from "expo-network";
import { useRouter } from "expo-router";
import { Accelerometer } from "expo-sensors";
import * as SMS from "expo-sms";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Platform } from "react-native";
import { useApp } from "./app-state";
import { pushLocation, setActiveShare, startBackgroundShare, stopBackgroundShare } from "./bg-location";
import { mapsLink } from "./geo";
import { checkPin, type PinResult } from "./pins";
import { getPrefs, usePrefs } from "./prefs";
import { api, trackPageUrl, type AlertRow, type Recipient } from "./api";
import { addToVault } from "./vault";

export type Trigger = "hold" | "shake" | "walk" | "manual";
export type Phase = "idle" | "active" | "duress";

export type ActiveAlert = {
  id: string;
  token: string | null;
  local: boolean;
  startedAt: number;
  trigger: Trigger;
};

export type SmsState = "not-sent" | "opened" | "sent" | "cancelled" | "unavailable";

type Ctx = {
  phase: Phase;
  alert: ActiveAlert | null;
  recipients: Recipient[];
  location: Location.LocationObject | null;
  backgroundSharing: boolean;
  recordingSecs: number;
  recording: boolean;
  sms: SmsState;
  online: boolean;
  /** The SOS text as it would be sent, for web share buttons and copy. */
  messageText: string;
  start: (trigger: Trigger) => Promise<void>;
  resendSms: () => Promise<void>;
  submitPin: (pin: string) => Promise<PinResult>;
  sendSafeMessage: () => Promise<void>;
  call112: () => void;
};

const SosCtx = createContext<Ctx | null>(null);

const withTimeout = <T,>(p: PromiseLike<T>, ms: number): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export function SosProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session, profile, contacts, t } = useApp();
  const [prefs] = usePrefs();
  const recorder = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, directory: "document" } as typeof RecordingPresets.LOW_QUALITY);

  const [phase, setPhase] = useState<Phase>("idle");
  const [alert, setAlert] = useState<ActiveAlert | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [backgroundSharing, setBackgroundSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const [sms, setSms] = useState<SmsState>("not-sent");
  const [online, setOnline] = useState(true);

  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPushRef = useRef(0);
  const alertRef = useRef<ActiveAlert | null>(null);
  const backgroundSharingRef = useRef(false);
  useEffect(() => {
    alertRef.current = alert;
  }, [alert]);
  useEffect(() => {
    backgroundSharingRef.current = backgroundSharing;
  }, [backgroundSharing]);

  const uid = session?.user.id;
  const name = profile?.display_name || "your contact";

  // ---------------- helpers ----------------
  const getFix = useCallback(async (): Promise<Location.LocationObject | null> => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        const asked = await Location.requestForegroundPermissionsAsync();
        if (!asked.granted) return null;
      }
      return await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 8000);
    } catch {
      return Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }).catch(() => null);
    }
  }, []);

  const smsBody = useCallback(
    (a: ActiveAlert | null, loc: Location.LocationObject | null) => {
      const link = a?.token ? trackPageUrl(a.token) : "";
      const maps = loc ? mapsLink(loc.coords.latitude, loc.coords.longitude) : "(location unavailable)";
      return link ? `${t("sosSms", { name, link })}\n${maps}` : t("sosSmsNoLink", { name, maps });
    },
    [name, t],
  );

  const sendSms = useCallback(
    async (a: ActiveAlert | null, loc: Location.LocationObject | null) => {
      const phones = contacts.map((c) => c.phone);
      if (!phones.length) {
        setSms("unavailable");
        return;
      }
      if (!(await SMS.isAvailableAsync())) {
        setSms("unavailable");
        return;
      }
      setSms("opened");
      try {
        const { result } = await SMS.sendSMSAsync(phones, smsBody(a, loc));
        // iOS reports sent/cancelled. Android always reports "unknown", so we say "opened".
        const state: SmsState = result === "sent" ? "sent" : result === "cancelled" ? "cancelled" : "opened";
        setSms(state);
        if (a && !a.local && state !== "cancelled") {
          await api("POST", `alerts/${a.id}/sms-sent`).catch(() => {});
        }
      } catch {
        setSms("unavailable");
      }
    },
    [contacts, smsBody],
  );

  const createServerAlert = useCallback(
    async (trigger: Trigger, loc: Location.LocationObject | null): Promise<ActiveAlert | null> => {
      if (!uid) return null;
      try {
        const battery = await Battery.getBatteryLevelAsync().catch(() => null);
        const r = await api<{ alert: AlertRow; recipients: Recipient[] }>(
          "POST",
          "alerts",
          {
            trigger,
            battery: typeof battery === "number" && battery >= 0 ? battery : null,
            lat: loc?.coords.latitude ?? null,
            lng: loc?.coords.longitude ?? null,
            accuracy: loc?.coords.accuracy ?? null,
          },
          { timeoutMs: 8000 },
        );
        setRecipients(r.recipients);
        return { id: r.alert.id, token: r.alert.public_token, local: false, startedAt: Date.now(), trigger };
      } catch {
        return null;
      }
    },
    [uid],
  );

  const startRecording = useCallback(async () => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, allowsBackgroundRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }, [recorder]);

  const stopRecordingToVault = useCallback(
    async (alertId: string | null) => {
      if (!recording) return;
      try {
        await recorder.stop();
        setRecording(false);
        const uri = recorder.uri;
        if (uri) {
          await addToVault({
            uri,
            kind: "audio",
            mime: "audio/mp4",
            label: `Audio recorded during SOS`,
            source: "sos_recording",
            alertId: alertId && !alertId.startsWith("local-") ? alertId : null,
          }).catch(() => {});
        }
      } catch {
        setRecording(false);
      }
    },
    [recorder, recording],
  );

  const stopStreams = useCallback(async () => {
    watchRef.current?.remove();
    watchRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    await stopBackgroundShare();
    await setActiveShare(null);
    setBackgroundSharing(false);
  }, []);

  // ---------------- start ----------------
  const start = useCallback(
    async (trigger: Trigger) => {
      if (alertRef.current) {
        // Already running (including a duress-hidden alert): bring the screen back.
        router.push("/sos");
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      const startedAt = Date.now();
      const local: ActiveAlert = { id: `local-${startedAt}`, token: null, local: true, startedAt, trigger };
      alertRef.current = local;
      setAlert(local);
      setPhase("active");
      setSms("not-sent");
      setRecipients([]);
      setRecordingSecs(0);
      router.push("/sos");

      const net = await Network.getNetworkStateAsync().catch(() => null);
      setOnline(Boolean(net?.isInternetReachable ?? net?.isConnected ?? true));

      const loc = await getFix();
      if (loc) setLocation(loc);

      const server = await createServerAlert(trigger, loc);
      const a = server ?? local;
      alertRef.current = a;
      setAlert(a);
      if (!server) setOnline(false);

      // SMS goes out regardless of the server, so it works with no data.
      sendSms(a, loc);

      if (uid) {
        await setActiveShare({ alertId: a.id, ownerId: uid });
        const bg = await startBackgroundShare();
        setBackgroundSharing(bg);
      }
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 },
        (l) => {
          setLocation(l);
          if (!backgroundSharingRef.current && Date.now() - lastPushRef.current > 9000 && uid) {
            lastPushRef.current = Date.now();
            pushLocation(l, { alertId: alertRef.current?.id, ownerId: uid }).catch(() => {});
          }
        },
      ).catch(() => null);

      tickRef.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000);
      if ((await getPrefs()).recordAudio) startRecording();
    },
    [router, getFix, createServerAlert, sendSms, uid, startRecording],
  );

  // Retry creating the server alert while offline, so the live link starts working once data returns.
  const locationRef = useRef<Location.LocationObject | null>(null);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);
  const isLocal = Boolean(alert?.local);
  useEffect(() => {
    if (!isLocal || phase === "idle") return;
    const id = setInterval(async () => {
      const current = alertRef.current;
      if (!current?.local) return;
      const server = await createServerAlert(current.trigger, locationRef.current);
      if (server) {
        const next = { ...server, startedAt: current.startedAt };
        alertRef.current = next;
        setAlert(next);
        setOnline(true);
        if (uid) await setActiveShare({ alertId: server.id, ownerId: uid });
      }
    }, 20000);
    return () => clearInterval(id);
  }, [isLocal, phase, createServerAlert, uid]);

  // Poll for "On it" from her circle. Short interval: this is the update she most needs to see.
  const serverAlertId = alert && !alert.local ? alert.id : null;
  useEffect(() => {
    if (!serverAlertId || phase === "idle") return;
    let lastAcked = -1;
    const poll = async () => {
      const r = await api<{ recipients: Recipient[] }>("GET", `alerts/${serverAlertId}`).catch(() => null);
      if (!r) return;
      const rows = r.recipients;
      const acked = rows.filter((r) => r.status === "acknowledged").length;
      if (lastAcked >= 0 && acked > lastAcked) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      lastAcked = acked;
      setRecipients(rows);
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [serverAlertId, phase]);

  // ---------------- end ----------------
  const submitPin = useCallback(
    async (pin: string): Promise<PinResult> => {
      const res = await checkPin(pin);
      const a = alertRef.current;
      if (!a || res === "wrong") return res;
      if (res === "duress") {
        // Looks cancelled on her screen. Helpers are told it may have been forced.
        if (!a.local) await api("POST", `alerts/${a.id}/duress`).catch(() => {});
        setPhase("duress");
        return res;
      }
      await stopRecordingToVault(a.id);
      await stopStreams();
      if (!a.local) await api("POST", `alerts/${a.id}/cancel`).catch(() => {});
      alertRef.current = null;
      setAlert(null);
      setPhase("idle");
      return res;
    },
    [stopRecordingToVault, stopStreams],
  );

  const sendSafeMessage = useCallback(async () => {
    const phones = contacts.map((c) => c.phone);
    if (!phones.length || !(await SMS.isAvailableAsync())) return;
    await SMS.sendSMSAsync(phones, `${name} is safe now. Thank you. (SAAHI)`).catch(() => {});
  }, [contacts, name]);

  const call112 = useCallback(() => {
    Linking.openURL(Platform.OS === "ios" ? "telprompt:112" : "tel:112").catch(() => Linking.openURL("tel:112"));
  }, []);

  const resendSms = useCallback(() => sendSms(alertRef.current, location), [sendSms, location]);

  // ---------------- shake to SOS ----------------
  useEffect(() => {
    if (!prefs.shakeToSos || phase !== "idle" || !session || Platform.OS === "web") return;
    let hits: number[] = [];
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    Accelerometer.isAvailableAsync()
      .then((ok) => {
        if (!ok || cancelled) return;
        Accelerometer.setUpdateInterval(100);
        sub = Accelerometer.addListener(({ x, y, z }) => {
          const g = Math.sqrt(x * x + y * y + z * z);
          if (g > 2.6) {
            const now = Date.now();
            hits = [...hits.filter((h) => now - h < 1500), now];
            // Debounce hits that belong to the same jolt.
            const distinct = hits.filter((h, i) => i === 0 || h - hits[i - 1] > 200);
            if (distinct.length >= 3) {
              hits = [];
              start("shake");
            }
          }
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [prefs.shakeToSos, phase, session, start]);

  const messageText = useMemo(() => smsBody(alert, location), [smsBody, alert, location]);

  const value = useMemo(
    () => ({
      messageText,
      phase,
      alert,
      recipients,
      location,
      backgroundSharing,
      recordingSecs,
      recording,
      sms,
      online,
      start,
      resendSms,
      submitPin,
      sendSafeMessage,
      call112,
    }),
    [messageText, phase, alert, recipients, location, backgroundSharing, recordingSecs, recording, sms, online, start, resendSms, submitPin, sendSafeMessage, call112],
  );

  return <SosCtx.Provider value={value}>{children}</SosCtx.Provider>;
}

export function useSos(): Ctx {
  const v = useContext(SosCtx);
  if (!v) throw new Error("useSos must be used inside SosProvider");
  return v;
}
