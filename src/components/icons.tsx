import Svg, { Circle, Path, Rect } from "react-native-svg";
import { c } from "@/lib/theme";

type P = { size?: number; color?: string };
const base = (size: number) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none" as const });
const st = (color: string, w = 2.2) => ({ stroke: color, strokeWidth: w, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

export const IconHome = ({ size = 22, color = c.ink }: P) => (
  <Svg {...base(size)}><Path d="M4 11l8-7 8 7v9H4z" {...st(color)} /></Svg>
);
export const IconPattern = ({ size = 22, color = c.ink }: P) => (
  <Svg {...base(size)}><Path d="M4 19h16M7 15l4-5 3 3 4-6" {...st(color)} /></Svg>
);
export const IconPin = ({ size = 22, color = c.ink }: P) => (
  <Svg {...base(size)}><Path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z" {...st(color)} /><Circle cx="12" cy="10" r="2.2" {...st(color)} /></Svg>
);
export const IconLock = ({ size = 22, color = c.ink }: P) => (
  <Svg {...base(size)}><Rect x="4" y="10" width="16" height="11" rx="2" {...st(color)} /><Path d="M8 10V7a4 4 0 0 1 8 0v3" {...st(color)} /></Svg>
);
export const IconHeart = ({ size = 22, color = c.ink }: P) => (
  <Svg {...base(size)}><Path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" {...st(color)} /></Svg>
);
export const IconWalk = ({ size = 26, color = c.ink }: P) => (
  <Svg {...base(size)}><Circle cx="13" cy="4" r="2" {...st(color)} /><Path d="M10 21l2-6 3 3v3M8 12l2-4 4 1 2 3h3M10 8l-2 7" {...st(color)} /></Svg>
);
export const IconPhone = ({ size = 26, color = c.ink }: P) => (
  <Svg {...base(size)}><Path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" {...st(color)} /></Svg>
);
export const IconPeople = ({ size = 20, color = c.ink }: P) => (
  <Svg {...base(size)}><Circle cx="9" cy="8" r="3" {...st(color)} /><Path d="M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M21 20a5 5 0 0 0-4-5" {...st(color)} /></Svg>
);
export const IconShield = ({ size = 20, color = c.ink }: P) => (
  <Svg {...base(size)}><Path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" {...st(color)} /></Svg>
);
export const IconMic = ({ size = 20, color = c.ink }: P) => (
  <Svg {...base(size)}><Rect x="9" y="3" width="6" height="11" rx="3" {...st(color)} /><Path d="M5 11a7 7 0 0 0 14 0M12 18v3" {...st(color)} /></Svg>
);
export const IconCamera = ({ size = 20, color = c.ink }: P) => (
  <Svg {...base(size)}><Rect x="3" y="6" width="18" height="13" rx="3" {...st(color)} /><Circle cx="12" cy="12.5" r="3.5" {...st(color)} /></Svg>
);
export const IconDoc = ({ size = 20, color = c.ink }: P) => (
  <Svg {...base(size)}><Rect x="5" y="2" width="14" height="20" rx="3" {...st(color)} /><Path d="M9 7h6M9 11h6M9 15h3" {...st(color)} /></Svg>
);
export const IconSpark = ({ size = 14, color = c.ink }: P) => (
  <Svg {...base(size)}><Path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z" fill={color} /></Svg>
);
export const IconSignal = ({ size = 30, color = c.white }: P) => (
  <Svg {...base(size)}>
    <Path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" {...st(color, 2.4)} />
    <Circle cx="12" cy="12" r="1.6" fill={color} />
  </Svg>
);
export const IconPlus = ({ size = 18, color = c.ink }: P) => (
  <Svg {...base(size)}><Path d="M12 5v14M5 12h14" {...st(color, 2.6)} /></Svg>
);
export const IconGear = ({ size = 20, color = c.ink }: P) => (
  <Svg {...base(size)}>
    <Circle cx="12" cy="12" r="3" {...st(color)} />
    <Path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" {...st(color)} />
  </Svg>
);
