import { Tabs, useRouter } from "expo-router";
import type { ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconHeart, IconHome, IconLock, IconPattern, IconPin } from "@/components/icons";
import { SosButton } from "@/components/SosButton";
import { useApp } from "@/lib/app-state";
import type { Key } from "@/lib/i18n";
import { useLayout } from "@/lib/layout";
import { useSos } from "@/lib/sos";
import { c, f, hardShadow } from "@/lib/theme";

const items: { name: string; label: Key; Icon: ComponentType<{ size?: number; color?: string }> }[] = [
  { name: "index", label: "tabHome", Icon: IconHome },
  { name: "pattern", label: "tabPattern", Icon: IconPattern },
  { name: "walk", label: "tabWalk", Icon: IconPin },
  { name: "vault", label: "tabVault", Icon: IconLock },
  { name: "support", label: "tabSupport", Icon: IconHeart },
];

// react-native-web adds `hovered` to Pressable's state on desktop.
const hov = (state: object) => Boolean((state as { hovered?: boolean }).hovered);

export default function TabsLayout() {
  const { t } = useApp();
  const { wide } = useLayout();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const sos = useSos();

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.paper }, tabBarPosition: wide ? "left" : "bottom" }}
      tabBar={({ state, navigation }) =>
        wide ? (
          // Laptop and tablet: a left rail with the brand, the sections and an always-there SOS.
          <View
            style={{
              width: 248,
              borderRightWidth: 2,
              borderRightColor: c.ink,
              backgroundColor: c.paper,
              paddingTop: Math.max(insets.top, 28),
              paddingBottom: 24,
              paddingHorizontal: 18,
              justifyContent: "space-between",
            }}
          >
            <View style={{ gap: 6 }}>
              <Pressable testID="rail-logo" accessible={false} delayLongPress={900} onLongPress={() => sos.alert && router.push("/sos")}>
                <Text style={{ fontFamily: f.display, fontSize: 30, color: c.ink, letterSpacing: -0.8, marginBottom: 22, paddingHorizontal: 8 }}>
                  saahi.
                </Text>
              </Pressable>
              {state.routes.map((route, i) => {
                const item = items.find((x) => x.name === route.name);
                if (!item) return null;
                const focused = state.index === i;
                return (
                  <Pressable
                    key={route.key}
                    accessibilityRole="tab"
                    accessibilityLabel={t(item.label)}
                    accessibilityState={{ selected: focused }}
                    onPress={() => navigation.navigate(route.name)}
                    style={(state) => [
                      {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 14,
                        borderWidth: 2,
                        borderColor: focused ? c.ink : "transparent",
                        backgroundColor: focused ? c.marigold : hov(state) ? c.faint : "transparent",
                      },
                      focused && hardShadow(3),
                    ]}
                  >
                    <item.Icon size={22} color={c.ink} />
                    <Text style={{ fontFamily: focused ? f.bodyBold : f.bodySemi, fontSize: 15.5, color: c.ink }}>{t(item.label)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ alignItems: "center", gap: 12 }}>
              {state.routes[state.index]?.name !== "index" && (
                <SosButton size={132} onFire={() => sos.start("hold")} sublabel={t("holdSos")} />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Quick exit to calculator"
                onPress={() => router.push("/calculator")}
                style={(state) => ({
                  borderWidth: 2,
                  borderColor: c.ink,
                  borderRadius: 999,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  backgroundColor: hov(state) ? c.faint : c.paper,
                  ...hardShadow(2),
                })}
              >
                <Text style={{ fontFamily: f.bodyBold, fontSize: 12.5, color: c.ink }}>⇥ Quick exit</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-around",
              borderTopWidth: 2,
              borderTopColor: c.ink,
              backgroundColor: c.paper,
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 10),
            }}
          >
            {state.routes.map((route, i) => {
              const item = items.find((x) => x.name === route.name);
              if (!item) return null;
              const focused = state.index === i;
              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="tab"
                  accessibilityLabel={t(item.label)}
                  accessibilityState={{ selected: focused }}
                  onPress={() => navigation.navigate(route.name)}
                  style={{ alignItems: "center", gap: 3, paddingHorizontal: 8, minWidth: 56 }}
                >
                  <View
                    style={{
                      padding: 3,
                      borderRadius: 9,
                      borderWidth: 2,
                      borderColor: focused ? c.ink : "transparent",
                      backgroundColor: focused ? c.marigold : "transparent",
                    }}
                  >
                    <item.Icon size={22} color={focused ? c.ink : c.muted} />
                  </View>
                  <Text style={{ fontFamily: f.bodyBold, fontSize: 11, color: focused ? c.ink : c.muted }}>{t(item.label)}</Text>
                </Pressable>
              );
            })}
          </View>
        )
      }
    >
      {items.map((it) => (
        <Tabs.Screen key={it.name} name={it.name} />
      ))}
    </Tabs>
  );
}
