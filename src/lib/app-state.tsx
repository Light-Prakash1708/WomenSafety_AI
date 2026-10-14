import type { Session } from "@supabase/supabase-js";
import * as Localization from "expo-localization";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, type Key, type Lang } from "./i18n";
import { isConfigured, supabase, type Contact, type Profile } from "./supabase";

type Ctx = {
  ready: boolean;
  configured: boolean;
  session: Session | null;
  profile: Profile | null;
  contacts: Contact[];
  lang: Lang;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  refresh: () => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  setLang: (l: Lang) => Promise<void>;
};

const AppCtx = createContext<Ctx | null>(null);

function deviceLang(): Lang {
  const code = Localization.getLocales()[0]?.languageCode;
  return code === "hi" || code === "bn" ? code : "en";
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [localLang, setLocalLang] = useState<Lang>(deviceLang());

  const load = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      setContacts([]);
      return;
    }
    const [p, cts] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("trusted_contacts").select("*").eq("owner_id", uid).order("priority").order("created_at"),
    ]);
    if (p.data) setProfile(p.data as Profile);
    if (cts.data) setContacts(cts.data as Contact[]);
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await load(data.session?.user.id).catch(() => {});
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      load(s?.user.id).catch(() => {});
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(() => load(session?.user.id), [load, session?.user.id]);

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      if (!session) return;
      const { data, error } = await supabase
        .from("profiles")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", session.user.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      setProfile(data as Profile);
    },
    [session],
  );

  const lang: Lang = profile?.language ?? localLang;

  const setLang = useCallback(
    async (l: Lang) => {
      setLocalLang(l);
      if (session) await updateProfile({ language: l }).catch(() => {});
    },
    [session, updateProfile],
  );

  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const value = useMemo(
    () => ({ ready, configured: isConfigured, session, profile, contacts, lang, t, refresh, updateProfile, setLang }),
    [ready, session, profile, contacts, lang, t, refresh, updateProfile, setLang],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp must be used inside AppStateProvider");
  return v;
}
