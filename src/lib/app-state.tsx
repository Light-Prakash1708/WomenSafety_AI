import * as Localization from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, onTokenChange, setToken, type Contact, type Profile } from "./api";
import { translate, type Key, type Lang } from "./i18n";

type Session = { user: { id: string; email: string } };

type Ctx = {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  contacts: Contact[];
  /** Set when the server can't be reached at start-up. */
  offline: boolean;
  lang: Lang;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  refresh: () => Promise<void>;
  setContacts: (c: Contact[]) => void;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  setLang: (l: Lang) => Promise<void>;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AppCtx = createContext<Ctx | null>(null);

function deviceLang(): Lang {
  const code = Localization.getLocales()[0]?.languageCode;
  return code === "hi" || code === "bn" ? code : "en";
}

type Me = { user: { id: string; email: string }; profile: Profile; contacts: Contact[] };

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [offline, setOffline] = useState(false);
  const [localLang, setLocalLang] = useState<Lang>(deviceLang());

  const load = useCallback(async () => {
    const t = await getToken();
    if (!t) {
      setSession(null);
      setProfile(null);
      setContacts([]);
      return;
    }
    try {
      const me = await api<Me>("GET", "me");
      setSession({ user: me.user });
      setProfile(me.profile);
      setContacts(me.contacts);
      setOffline(false);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) {
        setSession(null);
        setProfile(null);
      } else {
        setOffline(true);
      }
    }
  }, []);

  useEffect(() => {
    // Start after the first render; load() only sets state once storage and the network answer.
    const id = setTimeout(() => {
      load().finally(() => setReady(true));
    }, 0);
    const off = onTokenChange((t) => {
      if (!t) {
        setSession(null);
        setProfile(null);
        setContacts([]);
      }
    });
    return () => {
      clearTimeout(id);
      off();
    };
  }, [load]);

  const updateProfile = useCallback(async (patch: Partial<Profile>) => {
    const r = await api<{ profile: Profile }>("PATCH", "profile", patch);
    setProfile(r.profile);
  }, []);

  const lang: Lang = profile?.language ?? localLang;

  const setLang = useCallback(
    async (l: Lang) => {
      setLocalLang(l);
      if (session) await updateProfile({ language: l }).catch(() => {});
    },
    [session, updateProfile],
  );

  const signIn = useCallback(
    async (token: string) => {
      await setToken(token);
      await load();
    },
    [load],
  );

  const signOut = useCallback(async () => {
    await setToken(null);
  }, []);

  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const value = useMemo(
    () => ({ ready, session, profile, contacts, offline, lang, t, refresh: load, setContacts, updateProfile, setLang, signIn, signOut }),
    [ready, session, profile, contacts, offline, lang, t, load, updateProfile, setLang, signIn, signOut],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp must be used inside AppStateProvider");
  return v;
}
