import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { IconGear, IconHeart, IconPattern, IconPhone, IconWalk } from "@/components/icons";
import { SosButton } from "@/components/SosButton";
import { Button, Card, Chip, Screen, Section, TopBar, s as ui } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { nearbyCells } from "@/lib/geo";
import type { Lang } from "@/lib/i18n";
import { isWeb } from "@/lib/layout";
import { useSos } from "@/lib/sos";
import { supabase } from "@/lib/supabase";
import { c, f, hardShadow } from "@/lib/theme";

const CATEGORY: Record<string, string> = {
  poor_lighting: "Poor lighting reported",
  harassment: "Harassment reported",
  unsafe_transport: "Unsafe transport reported",
  no_security: "No security reported",
  isolated: "Isolated stretch reported",
};

type Area = { geohash6: string; area_label: string | null; category: string; time_band: string; reporters: number };
type GuardianAlert = { id: string; owner_id: string; started_at: string };
type Insight = { threadId: string; title: string; afterBlock: number; total: number } | null;

export default function Home() {
  const router = useRouter();
  const { profile, contacts, lang, setLang, t, session } = useApp();
  const sos = useSos();
  const [areas, setAreas] = useState<Area[]>([]);
  const [guardian, setGuardian] = useState<GuardianAlert[]>([]);
  const [insight, setInsight] = useState<Insight>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const uid = session?.user.id;
        if (!uid) return;
        // Alerts from people who list me as a guardian (RLS only returns those).
        const g = await supabase.from("alerts").select("id, owner_id, started_at").neq("owner_id", uid).eq("status", "active");
        if (alive && g.data) setGuardian(g.data as GuardianAlert[]);

        // Pattern insight: contact after blocking in the most active thread.
        const th = await supabase.from("pattern_threads").select("id, title").order("created_at", { ascending: false }).limit(5);
        for (const thread of th.data ?? []) {
          const e = await supabase.from("pattern_entries").select("kind, occurred_at").eq("thread_id", thread.id).order("occurred_at");
          const rows = e.data ?? [];
          const blocked = rows.find((r) => r.kind === "blocked");
          const after = blocked ? rows.filter((r) => r.occurred_at > blocked.occurred_at && r.kind !== "blocked").length : 0;
          if (rows.length) {
            if (alive) setInsight({ threadId: thread.id, title: thread.title, afterBlock: after, total: rows.length });
            break;
          }
        }

        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return;
        const loc = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000 });
        if (!loc) return;
        const { data } = await supabase.rpc("area_safety", { cells: nearbyCells(loc.coords.latitude, loc.coords.longitude) });
        if (alive && data) setAreas(data as Area[]);
      })().catch(() => {});
      return () => {
        alive = false;
      };
    }, [session?.user.id]),
  );

  const first = (profile?.display_name ?? "").split(" ")[0] || "there";
  const hasCircle = contacts.length > 0;

  return (
    <Screen>
      <TopBar
        title="saahi."
        onLogoLongPress={() => sos.alert && router.push("/sos")}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push("/settings")} hitSlop={8}>
            <IconGear />
          </Pressable>
        }
      />

      <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
        {(["en", "hi", "bn"] as Lang[]).map((l) => (
          <Chip key={l} label={l === "en" ? "EN" : l === "hi" ? "हिंदी" : "বাংলা"} active={lang === l} onPress={() => setLang(l)} />
        ))}
      </View>
      <Text style={{ fontFamily: f.display, fontSize: 36, color: c.ink, letterSpacing: -0.8, lineHeight: 38 }}>{t("hello", { name: first })}</Text>
      <Text style={[ui.sub, { marginTop: 6 }]}>{hasCircle ? t("ready") : t("notReady")}</Text>

      {guardian.map((g) => (
        <Pressable key={g.id} onPress={() => router.push({ pathname: "/guardian/[id]", params: { id: g.id } })} style={{ marginBottom: 12 }}>
          <Card bg={c.sos}>
            <Text style={{ fontFamily: f.displayBold, fontSize: 17, color: c.white }}>Someone in your care needs help</Text>
            <Text style={{ fontFamily: f.body, fontSize: 13.5, color: c.white, marginTop: 2 }}>
              Alert started {new Date(g.started_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}. Tap to see where she is.
            </Text>
          </Card>
        </Pressable>
      ))}

      <Pressable onPress={() => router.push("/contacts")} accessibilityRole="button" accessibilityLabel="Manage your circle">
        <Card bg={hasCircle ? c.sage : c.blush} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: hasCircle ? c.ok : c.sos }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: f.displayBold, fontSize: 16, color: c.ink }}>{hasCircle ? t("circleReady") : "Add your circle"}</Text>
            <Text style={{ fontFamily: f.body, fontSize: 13, color: c.ink }}>
              {hasCircle ? t("circleCount", { n: contacts.length }) : "No one will be alerted yet"}
            </Text>
          </View>
          <View style={{ flexDirection: "row" }}>
            {contacts.slice(0, 3).map((ct, i) => (
              <View
                key={ct.id}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  borderWidth: 2,
                  borderColor: c.ink,
                  marginLeft: i ? -8 : 0,
                  backgroundColor: [c.marigold, c.lilac, c.blush][i],
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontFamily: f.bodyBold, fontSize: 11, color: c.ink }}>{ct.name.slice(0, 2)}</Text>
              </View>
            ))}
          </View>
        </Card>
      </Pressable>

      <View style={{ alignItems: "center", marginVertical: 24, gap: 12 }}>
        <SosButton onFire={() => sos.start("hold")} sublabel={t("holdSos")} />
        <Text style={{ fontFamily: f.body, fontSize: 13, color: c.muted, textAlign: "center" }}>{isWeb ? t("sosHintWeb") : t("sosHint")}</Text>
      </View>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <Tile bg={c.marigold} Icon={IconWalk} title={t("walk")} sub={t("walkSub")} onPress={() => router.push("/walk")} />
        <Tile bg={c.lilac} Icon={IconPattern} title={t("log")} sub={t("logSub")} onPress={() => router.push("/entry")} />
      </View>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
        <Tile bg={c.blush} Icon={IconPhone} title={t("ghost")} sub={t("ghostSub")} onPress={() => router.push("/ghost-call")} />
        <Tile bg={c.sage} Icon={IconHeart} title={t("support")} sub={t("supportSub")} onPress={() => router.push("/support")} />
      </View>

      {insight && (
        <>
          <Section title="From your pattern" hint={insight.title} />
          <Card bg={c.blush}>
            <Text style={{ fontFamily: f.body, fontSize: 14, color: c.ink, lineHeight: 20 }}>
              {insight.afterBlock > 0 ? (
                <>
                  <Text style={{ fontFamily: f.bodyBold }}>Contact after blocking. </Text>
                  {insight.afterBlock} event{insight.afterBlock > 1 ? "s" : ""} logged since you blocked them, out of {insight.total} in this thread.
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: f.bodyBold }}>{insight.total} entries logged. </Text>
                  Open the thread to see the timeline and an AI summary.
                </>
              )}
            </Text>
            <View style={{ marginTop: 10 }}>
              <Chip label="Review the timeline →" onPress={() => router.push("/pattern")} />
            </View>
          </Card>
        </>
      )}

      <Section title="Around you" hint="private, area-level" />
      {areas.length ? (
        areas.slice(0, 3).map((a) => (
          <Card key={a.geohash6 + a.category} style={{ marginBottom: 10 }}>
            <Text style={{ fontFamily: f.bodyBold, fontSize: 14.5, color: c.ink }}>
              {CATEGORY[a.category] ?? a.category} · {a.time_band}
            </Text>
            <Text style={{ fontFamily: f.body, fontSize: 12.5, color: c.muted }}>
              {a.area_label ? `${a.area_label} · ` : ""}
              {a.reporters} women reported this. No names or routines are shared.
            </Text>
          </Card>
        ))
      ) : (
        <Text style={[ui.hint, { marginBottom: 10 }]}>
          No area reports near you yet. Areas show up once at least 3 women report the same problem.
        </Text>
      )}
      <Button tone="ghost" label="Report an unsafe spot" onPress={() => router.push("/report-area")} />
    </Screen>
  );
}

function Tile({ bg, Icon, title, sub, onPress }: { bg: string; Icon: ComponentType<{ size?: number }>; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          flex: 1,
          backgroundColor: bg,
          borderWidth: 2,
          borderColor: c.ink,
          borderRadius: 18,
          padding: 12,
          minHeight: 112,
          justifyContent: "space-between",
          ...hardShadow(3),
        },
        pressed && ui.pressed,
      ]}
    >
      <Icon size={26} />
      <View>
        <Text style={{ fontFamily: f.displayBold, fontSize: 16, color: c.ink, lineHeight: 18 }}>{title}</Text>
        <Text style={{ fontFamily: f.body, fontSize: 12, color: c.ink, opacity: 0.75, marginTop: 2 }}>{sub}</Text>
      </View>
    </Pressable>
  );
}
