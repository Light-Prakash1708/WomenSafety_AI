// The SOS engine. One alert at a time, shared across every screen.
//
// What happens when she triggers SOS:
//  1. A reference (client_ref) is made on the phone first. Every create, cancel and duress call
//     carries it, so retries never make a second alert and a cancel always reaches the right one,
//     even if it reaches the server before the create does.
//  2. Location is fixed (fresh GPS; if GPS is slow, the last known fix with its real age).
//  3. The alert is created. If the server can't be reached, a local alert is used, the text message
//     carries a Google Maps link instead, and creation is retried with the same reference.
//  4. Guardians with the app get a push. Everyone gets a prefilled SMS from her phone. The app reports
//     only what the phone tells it about that text (opened, sent, cancelled).
//  5. Live location streams with the time each fix was taken; a heartbeat says the phone is alive.
//  6. Audio records into her vault, if she turned that on.
//  7. "On it" replies arrive by polling, so she sees who is actually coming.
//
// Cancelling stops everything on this phone at once and queues the cancel in a persistent outbox,
// which is retried until the server confirms it. Duress makes the screen look cancelled while the
// alert keeps running, and is queued the same way.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Battery from "expo-battery";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as Crypto from "expo-crypto";
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
import { checkPin, hasPins, type PinResult } from "./pins";
import { getPrefs, usePrefs } from "./prefs";
import { api, ApiError, trackPageUrl, type AlertRow, type Recipient } from "./api";
import { addToVault } from "./vault";

export type Trigger = "hold" | "shake" | "walk" | "manual";
export type Phase = "idle" | "active" | "duress";

export type ActiveAlert = {
  id: string;
  /** The phone's own reference for this alert (client_ref). */
  ref: string;
  token: string | null;
  local: boolean;
  startedAt: number;
  trigger: Trigger;
};

export type SmsState = "not-sent" | "opened" | "sent" | "cancelled" | "unavailable";
export type PasswordResult = "cancel" | "wrong" | "offline" | "locked";

type Ctx = {
  phase: Phase;
  alert: ActiveAlert | null;
  recipients: Recipient[];
  location: Location.LocationObject | null;
  /** She refused location permission: helpers get no map, and the screen must say so. */
  locationDenied: boolean;
  backgroundSharing: boolean;
  recordingSecs: number;
  recording: boolean;
  sms: SmsState;
  online: boolean;
  /** No cancel PIN on this device (new phone or browser): cancelling needs her account password. */
  needsPassword: boolean;
  /** The SOS text as it would be sent, for web share buttons and copy. */
  messageText: string;
  start: (trigger: Trigger) => Promise<void>;
  resendSms: () => Promise<void>;
  submitPin: (pin: string) => Promise<PinResult>;
  cancelWithPassword: (password: string) => Promise<PasswordResult>;
  sendSafeMessage: () => Promise<void>;
  call112: () => void;
};

const SosCtx = createContext<Ctx | null>(null);

const withTimeout = <T,>(p: PromiseLike<T>, ms: number): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// ---------------------------------------------------------------------------
// Outbox: cancel and duress requests survive no signal, app restarts and server errors.
// ---------------------------------------------------------------------------
type OutboxItem = { id?: string; ref: string; action: "cancel" | "duress"; at: number };
const OUTBOX = "saahi.sos.outbox";
let flushing: Promise<void> | null = null;

async function readOutbox(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}
async function writeOutbox(items: OutboxItem[]) {
  try {
    if (items.length) await AsyncStorage.setItem(OUTBOX, JSON.stringify(items));
    else await AsyncStorage.removeItem(OUTBOX);
  } catch {
    // Storage unavailable (private browsing): the in-memory attempt below still runs.
  }
}
async function enqueue(item: Omit<OutboxItem, "at">) {
  const items = (await readOutbox()).filter((i) => !(i.ref === item.ref && i.action === item.action));
  await writeOutbox([...items, { ...item, at: Date.now() }]);
}
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const items = await readOutbox();
    const keep: OutboxItem[] = [];
    for (const it of items) {
      // By server id when we know it; otherwise by reference, which works even if the create never got a reply.
      const path = it.id ? `alerts/${it.id}/${it.action}` : `alerts/by-ref/${it.ref}/${it.action}`;
      try {
        await api("POST", path, undefined, { timeoutMs: 8000 });
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        // Network, rate limit, server error or signed out: keep it and try again later.
        // Other 4xx can never succeed (e.g. alert belongs to an account no longer signed in here).
        if (status === 0 || status === 401 || status === 429 || status >= 500) keep.push(it);
      }
    }
    const after = await readOutbox();
    // Keep anything added while we were sending.
    await writeOutbox([...keep, ...after.filter((a) => !items.some((i) => i.ref === a.ref && i.action === a.action))]);
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export function SosProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session, profile, contacts, t } = useApp();
  const [prefs] = usePrefs();
  const recorder = useAudioRecorder({ ...RecordingPresets.LOW_QUALITY, directory: "document" } as typeof RecordingPresets.LOW_QUALITY);

  const [phase, setPhase] = useState<Phase>("idle");
  const [alert, setAlert] = useState<ActiveAlert | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [backgroundSharing, setBackgroundSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSecs, setRecordingSecs] = useState(0);
  const [sms, setSms] = useState<SmsState>("not-sent");
  const [online, setOnline] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);

  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPushRef = useRef(0);
  const alertRef = useRef<ActiveAlert | null>(null);
  const backgroundSharingRef = useRef(false);
  /** Bumped on every start and every end. A start that resumes after an end sees a new number and stops. */
  const genRef = useRef(0);
  const duressRef = useRef(false);
  /** What her phone said about the SOS text, waiting to be reported once the server alert exists. */
  const smsResultRef = useRef<"sent" | "unknown" | "cancelled" | null>(null);
  useEffect(() => {
    backgroundSharingRef.current = backgroundSharing;
  }, [backgroundSharing]);

  const uid = session?.user.id;
  const name = profile?.display_name || "your contact";

  const commitAlert = useCallback((a: ActiveAlert | null) => {
    alertRef.current = a;
    setAlert(a);
  }, []);

  useEffect(() => {
    hasPins()
      .then((p) => setNeedsPassword(!p))
      .catch(() => setNeedsPassword(true));
  }, [phase]);

  // ---------------- helpers ----------------
  const getFix = useCallback(async (): Promise<Location.LocationObject | null> => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setLocationDenied(true);
        return null;
      }
      setLocationDenied(false);
    } catch {
      return null;
    }
    try {
      return await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 8000);
    } catch {
      // Keeps its own timestamp, so helpers see how old it is.
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

  const reportSms = useCallback(async (a: ActiveAlert | null) => {
    const result = smsResultRef.current;
    if (!result || !a || a.local) return;
    await api("POST", `alerts/${a.id}/device-sms`, { result })
      .then(() => {
        smsResultRef.current = null;
      })
      .catch(() => {});
  }, []);

  const sendSms = useCallback(
    async (a: ActiveAlert | null, loc: Location.LocationObject | null) => {
      const phones = contacts.map((c) => c.phone);
      if (!phones.length || !(await SMS.isAvailableAsync().catch(() => false))) {
        setSms("unavailable");
        return;
      }
      setSms("opened");
      try {
        const { result } = await SMS.sendSMSAsync(phones, smsBody(a, loc));
        // iOS reports sent/cancelled. Android always reports "unknown": Messages opened, outcome not known.
        setSms(result === "sent" ? "sent" : result === "cancelled" ? "cancelled" : "opened");
        smsResultRef.current = result === "sent" || result === "cancelled" ? result : "unknown";
        await reportSms(alertRef.current);
      } catch {
        setSms("unavailable");
      }
    },
    [contacts, smsBody, reportSms],
  );

  /** Creates (or finds) the server alert for this reference. Null if the server can't be reached. */
  const createServerAlert = useCallback(
    async (trigger: Trigger, loc: Location.LocationObject | null, ref: string): Promise<{ alert: ActiveAlert; status: AlertRow["status"] } | null> => {
      if (!uid) return null;
      try {
        const battery = await Battery.getBatteryLevelAsync().catch(() => null);
        const r = await api<{ alert: AlertRow; recipients: Recipient[] }>(
          "POST",
          "alerts",
          {
            client_ref: ref,
            trigger,
            duress: duressRef.current,
            battery: typeof battery === "number" && battery >= 0 ? battery : null,
            lat: loc?.coords.latitude ?? null,
            lng: loc?.coords.longitude ?? null,
            accuracy: loc?.coords.accuracy ?? null,
            fix_at: loc ? new Date(loc.timestamp || Date.now()).toISOString() : null,
          },
          { timeoutMs: 8000 },
        );
        setRecipients(r.recipients);
        return {
          status: r.alert.status,
          alert: {
            id: r.alert.id,
            // If she already had an alert running (another device), adopt that one's reference.
            ref: r.alert.client_ref ?? ref,
            token: r.alert.public_token,
            local: false,
            startedAt: Date.parse(r.alert.started_at) || Date.now(),
            trigger,
          },
        };
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

  /** Location streaming for an alert. Stops itself if the alert ended while it was starting. */
  const beginStreaming = useCallback(
    async (gen: number) => {
      const alive = () => genRef.current === gen && alertRef.current != null;
      if (!uid || !alive()) return;
      await setActiveShare({ alertId: alertRef.current!.id, ownerId: uid });
      const bg = await startBackgroundShare();
      if (!alive()) {
        await stopBackgroundShare();
        await setActiveShare(null);
        return;
      }
      setBackgroundSharing(bg);
      const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 }, (l) => {
        if (!alive()) return;
        setLocation(l);
        if (!backgroundSharingRef.current && Date.now() - lastPushRef.current > 9000) {
          lastPushRef.current = Date.now();
          pushLocation(l, { alertId: alertRef.current?.id, ownerId: uid }).catch(() => {});
        }
      }).catch(() => null);
      if (!alive()) {
        sub?.remove();
        return;
      }
      watchRef.current?.remove();
      watchRef.current = sub;
      if (!tickRef.current) tickRef.current = setInterval(() => setRecordingSecs((s) => s + 1), 1000);
    },
    [uid],
  );

  /** Ends the alert on this phone at once; the server is told through the outbox. */
  const finish = useCallback(
    async (a: ActiveAlert) => {
      genRef.current++;
      commitAlert(null);
      setPhase("idle");
      setRecipients([]);
      duressRef.current = false;
      await enqueue({ id: a.local ? undefined : a.id, ref: a.ref, action: "cancel" });
      flushOutbox().catch(() => {});
      await stopRecordingToVault(a.id);
      await stopStreams();
    },
    [commitAlert, stopRecordingToVault, stopStreams],
  );

  // ---------------- start ----------------
  const start = useCallback(
    async (trigger: Trigger) => {
      if (alertRef.current) {
        // Already running (including a duress-hidden alert): bring the screen back.
        router.push("/sos");
        return;
      }
      const gen = ++genRef.current;
      const alive = () => genRef.current === gen;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      const startedAt = Date.now();
      const ref = Crypto.randomUUID();
      duressRef.current = false;
      smsResultRef.current = null;
      commitAlert({ id: `local-${startedAt}`, ref, token: null, local: true, startedAt, trigger });
      setPhase("active");
      setSms("not-sent");
      setRecipients([]);
      setRecordingSecs(0);
      setLocation(null);
      router.push("/sos");

      const net = await Network.getNetworkStateAsync().catch(() => null);
      setOnline(Boolean(net?.isInternetReachable ?? net?.isConnected ?? true));

      const loc = await getFix();
      if (!alive()) return;
      if (loc) setLocation(loc);

      const server = await createServerAlert(trigger, loc, ref);
      // Cancelled while the request was in flight: the outbox cancel (by the same ref) ends it server-side.
      if (!alive()) return;
      if (server) {
        commitAlert(server.alert);
        if (server.status !== "active") {
          // Cancelled from another device before this create landed.
          await finish(server.alert);
          return;
        }
      } else {
        setOnline(false);
      }

      // SMS goes out regardless of the server, so it works with no data.
      sendSms(alertRef.current, loc);
      await beginStreaming(gen);
      if (alive() && (await getPrefs()).recordAudio) startRecording();
    },
    [router, getFix, createServerAlert, sendSms, beginStreaming, startRecording, commitAlert, finish],
  );

  // Retry creating the server alert while offline, with the same reference, so it can never duplicate.
  const locationRef = useRef<Location.LocationObject | null>(null);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);
  const isLocal = Boolean(alert?.local);
  useEffect(() => {
    if (!isLocal || phase === "idle") return;
    const gen = genRef.current;
    const id = setInterval(async () => {
      const current = alertRef.current;
      if (!current?.local || genRef.current !== gen) return;
      const server = await createServerAlert(current.trigger, locationRef.current, current.ref);
      if (!server || genRef.current !== gen) return;
      if (server.status !== "active") {
        await finish(server.alert);
        return;
      }
      commitAlert(server.alert);
      setOnline(true);
      if (uid) await setActiveShare({ alertId: server.alert.id, ownerId: uid });
      await reportSms(server.alert);
    }, 20000);
    return () => clearInterval(id);
  }, [isLocal, phase, createServerAlert, uid, commitAlert, finish, reportSms]);

  // Poll for "On it" from her circle, and notice if the alert was ended elsewhere.
  const serverAlertId = alert && !alert.local ? alert.id : null;
  useEffect(() => {
    if (!serverAlertId || phase === "idle") return;
    let lastAcked = -1;
    const poll = async () => {
      const r = await api<{ alert: AlertRow; recipients: Recipient[] }>("GET", `alerts/${serverAlertId}`).catch(() => null);
      if (!r || alertRef.current?.id !== serverAlertId) return;
      if (r.alert.status !== "active") {
        // Cancelled on another device, or expired after 24 h without contact.
        await finish(alertRef.current);
        return;
      }
      const acked = r.recipients.filter((x) => x.status === "acknowledged").length;
      if (lastAcked >= 0 && acked > lastAcked) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      lastAcked = acked;
      setRecipients(r.recipients);
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [serverAlertId, phase, finish]);

  // Heartbeat: tells helpers the phone is still alive even when it isn't moving.
  useEffect(() => {
    if (!serverAlertId || phase === "idle") return;
    const beat = async () => {
      const battery = await Battery.getBatteryLevelAsync().catch(() => null);
      await api("POST", `alerts/${serverAlertId}/heartbeat`, { battery: typeof battery === "number" && battery >= 0 ? battery : null }).catch(() => {});
    };
    const id = setInterval(beat, 60_000);
    return () => clearInterval(id);
  }, [serverAlertId, phase]);

  // Outbox: send anything queued (a cancel made with no signal, before the app was closed, ...).
  useEffect(() => {
    if (!uid) return;
    flushOutbox().catch(() => {});
    const id = setInterval(() => flushOutbox().catch(() => {}), 15_000);
    return () => clearInterval(id);
  }, [uid]);

  // Reopened app, new device or browser: pick up an alert that is still running so she can see and end it.
  // A duress alert stays hidden (only the logo long-press shows it).
  useEffect(() => {
    if (!uid) return;
    let stop = false;
    (async () => {
      await flushOutbox().catch(() => {});
      const pending = await readOutbox();
      const r = await api<{ alert: AlertRow | null; recipients?: Recipient[] }>("GET", "alerts/active").catch(() => null);
      if (stop || !r?.alert || alertRef.current) return;
      const a = r.alert;
      // A cancel for it is still queued: it's ending, don't bring it back.
      if (pending.some((p) => p.action === "cancel" && (p.id === a.id || p.ref === a.client_ref))) return;
      const gen = ++genRef.current;
      duressRef.current = Boolean(a.duress);
      commitAlert({ id: a.id, ref: a.client_ref ?? a.id, token: a.public_token, local: false, startedAt: Date.parse(a.started_at) || Date.now(), trigger: (a.trigger as Trigger) ?? "hold" });
      setRecipients(r.recipients ?? []);
      setPhase(a.duress ? "duress" : "active");
      setSms("not-sent");
      setRecordingSecs(Math.max(0, Math.round((Date.now() - (Date.parse(a.started_at) || Date.now())) / 1000)));
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (perm?.granted) await beginStreaming(gen);
      else setLocationDenied(true);
    })();
    return () => {
      stop = true;
    };
  }, [uid, beginStreaming, commitAlert]);

  // ---------------- end ----------------
  const submitPin = useCallback(
    async (pin: string): Promise<PinResult> => {
      const res = await checkPin(pin);
      const a = alertRef.current;
      if (!a || res === "wrong") return res;
      if (res === "duress") {
        // Looks cancelled on her screen. Helpers are told it may have been forced.
        duressRef.current = true;
        setPhase("duress");
        await enqueue({ id: a.local ? undefined : a.id, ref: a.ref, action: "duress" });
        flushOutbox().catch(() => {});
        return res;
      }
      await finish(a);
      return res;
    },
    [finish],
  );

  const cancelWithPassword = useCallback(
    async (password: string): Promise<PasswordResult> => {
      const a = alertRef.current;
      if (!a) return "cancel";
      try {
        await api("POST", "auth/verify-password", { password }, { timeoutMs: 10000 });
      } catch (e) {
        const s = e instanceof ApiError ? e.status : 0;
        return s === 403 ? "wrong" : s === 429 ? "locked" : "offline";
      }
      await finish(a);
      return "cancel";
    },
    [finish],
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
      locationDenied,
      backgroundSharing,
      recordingSecs,
      recording,
      sms,
      online,
      needsPassword,
      start,
      resendSms,
      submitPin,
      cancelWithPassword,
      sendSafeMessage,
      call112,
    }),
    [messageText, phase, alert, recipients, location, locationDenied, backgroundSharing, recordingSecs, recording, sms, online, needsPassword, start, resendSms, submitPin, cancelWithPassword, sendSafeMessage, call112],
  );

  return <SosCtx.Provider value={value}>{children}</SosCtx.Provider>;
}

export function useSos(): Ctx {
  const v = useContext(SosCtx);
  if (!v) throw new Error("useSos must be used inside SosProvider");
  return v;
}
