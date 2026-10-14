import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

export type Prefs = {
  shakeToSos: boolean;
  recordAudio: boolean;
  ghostCaller: string;
  checkinMinutes: number;
};

const KEY = "saahi.prefs";
const defaults: Prefs = { shakeToSos: true, recordAudio: true, ghostCaller: "Didi", checkinMinutes: 5 };

let cache: Prefs | null = null;
const listeners = new Set<(p: Prefs) => void>();

export async function getPrefs(): Promise<Prefs> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    cache = { ...defaults };
  }
  return cache!;
}

export async function setPrefs(patch: Partial<Prefs>) {
  const next = { ...(await getPrefs()), ...patch };
  cache = next;
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l(next));
}

export function usePrefs(): [Prefs, (p: Partial<Prefs>) => Promise<void>] {
  const [p, setP] = useState<Prefs>(cache ?? defaults);
  useEffect(() => {
    getPrefs().then(setP);
    listeners.add(setP);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  return [p, useCallback((patch: Partial<Prefs>) => setPrefs(patch), [])];
}
