import { Platform, useWindowDimensions } from "react-native";

export const isWeb = Platform.OS === "web";

/** Widest a column of content gets, so lines stay readable on a laptop. */
export const CONTENT_MAX = 640;
/** From this width up, navigation moves to a left-hand rail. */
export const WIDE_BREAKPOINT = 900;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  return { width, height, wide, isWeb };
}
