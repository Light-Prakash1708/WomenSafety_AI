// SAAHI design tokens. Outlined cards with offset ink shadows on a soft lilac-white paper.
export const c = {
  paper: "#FBF8FF",
  ink: "#1C1633",
  muted: "#6B6585",
  faint: "#E9E4F5",
  lilac: "#E4DAFB",
  marigold: "#FFC24B",
  sage: "#C7EBD3",
  blush: "#FFD9CF",
  sos: "#E8372F",
  sosDeep: "#B4211B",
  ok: "#2E9E5B",
  night: "#120F1F",
  night2: "#1E1A31",
  nightFg: "#F2EEFF",
  nightMuted: "#A49FBF",
  ackGreen: "#7BE3A3",
  white: "#FFFFFF",
};

export const f = {
  display: "BricolageGrotesque_800ExtraBold",
  displayBold: "BricolageGrotesque_700Bold",
  displaySemi: "BricolageGrotesque_600SemiBold",
  body: "HankenGrotesk_400Regular",
  bodyMed: "HankenGrotesk_500Medium",
  bodySemi: "HankenGrotesk_600SemiBold",
  bodyBold: "HankenGrotesk_700Bold",
  mono: "JetBrainsMono_500Medium",
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 };

/** The offset "sticker" shadow used across the app. */
export const hardShadow = (offset = 3) => ({
  shadowColor: c.ink,
  shadowOffset: { width: offset, height: offset },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 0,
});
