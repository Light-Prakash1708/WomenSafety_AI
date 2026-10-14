import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { c, f } from "@/lib/theme";

const SIZE = 210;
const STROKE = 12;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const HOLD_MS = 2000;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Press and hold for two seconds. Releasing early cancels, so a pocket tap can't fire it. */
export function SosButton({ onFire, sublabel }: { onFire: () => void; sublabel: string }) {
  const [progress] = useState(() => new Animated.Value(0));
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const [scale] = useState(() => new Animated.Value(1));
  const ticks = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (ticks.current) clearInterval(ticks.current);
  }, []);

  const begin = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true }).start();
    ticks.current = setInterval(() => Haptics.selectionAsync().catch(() => {}), 400);
    anim.current = Animated.timing(progress, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false });
    anim.current.start(({ finished }) => {
      if (ticks.current) clearInterval(ticks.current);
      if (finished) {
        progress.setValue(0);
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
        onFire();
      }
    });
  };

  const release = () => {
    anim.current?.stop();
    if (ticks.current) clearInterval(ticks.current);
    Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: false }).start();
    Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
  };

  const dash = progress.interpolate({ inputRange: [0, 1], outputRange: [CIRC, 0] });

  return (
    <Pressable
      onPressIn={begin}
      onPressOut={release}
      accessibilityRole="button"
      accessibilityLabel="SOS. Press and hold for two seconds to alert your circle."
      accessibilityActions={[{ name: "activate", label: "Send SOS now" }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === "activate" && onFire()}
    >
      <Animated.View style={{ width: SIZE, height: SIZE, transform: [{ scale }] }}>
        <Svg width={SIZE} height={SIZE} style={{ position: "absolute" }}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="#F7C9C5" strokeWidth={STROKE} fill="none" />
          <AnimatedCircle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={c.ink}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${CIRC} ${CIRC}`}
            strokeDashoffset={dash}
            strokeLinecap="round"
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View
          style={{
            position: "absolute",
            top: STROKE + 4,
            left: STROKE + 4,
            right: STROKE + 4,
            bottom: STROKE + 4,
            borderRadius: SIZE,
            backgroundColor: c.sos,
            borderWidth: 2.5,
            borderColor: c.ink,
            alignItems: "center",
            justifyContent: "center",
            borderBottomWidth: 7,
          }}
        >
          <Text style={{ fontFamily: f.display, fontSize: 44, color: c.white, letterSpacing: 1 }}>SOS</Text>
          <Text style={{ fontFamily: f.bodySemi, fontSize: 12.5, color: c.white, opacity: 0.92 }}>{sublabel}</Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}
