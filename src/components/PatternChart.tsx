import { View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { byDay, KIND } from "@/lib/pattern";
import type { PatternEntry } from "@/lib/api";
import { c } from "@/lib/theme";

const W = 320;
const H = 140;
const LEFT = 22;
const BASE = 104;
const TOP = 16;

/** Stacked daily bars for the last 21 days, with a marker where she blocked the person. */
export function PatternChart({ entries }: { entries: PatternEntry[] }) {
  const { days, blockedIndex } = byDay(entries, 21);
  const max = Math.max(2, ...days.map((d) => d.kinds.length));
  const unit = (BASE - TOP) / max;
  const step = (W - LEFT - 4) / days.length;
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const ticks = [0, Math.ceil(max / 2), max];

  return (
    <View>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {ticks.map((tk) => (
          <Line key={`g${tk}`} x1={LEFT} x2={W - 4} y1={BASE - tk * unit} y2={BASE - tk * unit} stroke={c.ink} strokeOpacity={0.12} />
        ))}
        {ticks.map((tk) => (
          <SvgText key={`t${tk}`} x={LEFT - 6} y={BASE - tk * unit + 3} fontSize={9} fill={c.muted} textAnchor="end">
            {tk}
          </SvgText>
        ))}
        <Line x1={LEFT} x2={W - 4} y1={BASE} y2={BASE} stroke={c.ink} strokeWidth={2} />
        {days.map((d, i) =>
          d.kinds.map((k, j) => (
            <Rect
              key={`${i}-${j}`}
              x={LEFT + i * step + 2}
              y={BASE - (j + 1) * unit + 1}
              width={Math.max(4, step - 4)}
              height={unit - 2}
              rx={3}
              fill={KIND[k].color}
              stroke={c.ink}
              strokeWidth={1.4}
            />
          )),
        )}
        {blockedIndex != null && (
          <>
            <Line x1={LEFT + blockedIndex * step + step / 2} x2={LEFT + blockedIndex * step + step / 2} y1={TOP - 6} y2={BASE} stroke={c.sos} strokeWidth={1.5} strokeDasharray="3 3" />
            <SvgText
              x={LEFT + blockedIndex * step + step / 2 + (blockedIndex > 14 ? -4 : 4)}
              y={TOP - 2}
              fontSize={9}
              fontWeight="700"
              fill={c.sosDeep}
              textAnchor={blockedIndex > 14 ? "end" : "start"}
            >
              you blocked them
            </SvgText>
          </>
        )}
        <SvgText x={LEFT + step / 2} y={BASE + 16} fontSize={9} fill={c.muted} textAnchor="start">
          {fmt(days[0].date)}
        </SvgText>
        <SvgText x={W - 4} y={BASE + 16} fontSize={9} fill={c.muted} textAnchor="end">
          Today
        </SvgText>
      </Svg>
    </View>
  );
}
