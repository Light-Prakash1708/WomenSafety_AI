import { Tabs } from "expo-router";
import type { ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconHeart, IconHome, IconLock, IconPattern, IconPin } from "@/components/icons";
import { useApp } from "@/lib/app-state";
import type { Key } from "@/lib/i18n";
import { c, f } from "@/lib/theme";

const items: { name: string; label: Key; Icon: ComponentType<{ size?: number; color?: string }> }[] = [
  { name: "index", label: "tabHome", Icon: IconHome },
  { name: "pattern", label: "tabPattern", Icon: IconPattern },
  { name: "walk", label: "tabWalk", Icon: IconPin },
  { name: "vault", label: "tabVault", Icon: IconLock },
  { name: "support", label: "tabSupport", Icon: IconHeart },
];

export default function TabsLayout() {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.paper } }}
      tabBar={({ state, navigation }) => (
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
      )}
    >
      {items.map((it) => (
        <Tabs.Screen key={it.name} name={it.name} />
      ))}
    </Tabs>
  );
}
