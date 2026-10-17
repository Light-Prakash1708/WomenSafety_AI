import type { EntryKind, PatternEntry } from "./api";
import { c } from "./theme";

export const KIND: Record<EntryKind, { label: string; color: string }> = {
  message: { label: "Message", color: c.lilac },
  new_account: { label: "New account or number", color: c.marigold },
  call: { label: "Call", color: "#B9D7F5" },
  in_person: { label: "Seen in person", color: c.sos },
  threat: { label: "Threat", color: c.sosDeep },
  blocked: { label: "I blocked them", color: c.paper },
  other: { label: "Other", color: c.faint },
};

export type PatternStats = {
  total: number;
  days: number;
  afterBlock: number;
  inPerson: number;
  threats: number;
};

export function stats(entries: PatternEntry[]): PatternStats {
  const events = entries.filter((e) => e.kind !== "blocked");
  const sorted = [...entries].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const blocked = sorted.find((e) => e.kind === "blocked");
  const first = sorted[0] ? new Date(sorted[0].occurred_at) : new Date();
  const last = sorted.length ? new Date(sorted[sorted.length - 1].occurred_at) : new Date();
  return {
    total: events.length,
    days: Math.max(1, Math.round((+last - +first) / 86400000) + 1),
    afterBlock: blocked ? events.filter((e) => e.occurred_at > blocked.occurred_at).length : 0,
    inPerson: events.filter((e) => e.kind === "in_person").length,
    threats: events.filter((e) => e.kind === "threat").length,
  };
}

/** Buckets entries per day across the last `span` days, ending today. */
export function byDay(entries: PatternEntry[], span = 21) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = +today - (span - 1) * 86400000;
  const days: { date: Date; kinds: EntryKind[] }[] = Array.from({ length: span }, (_, i) => ({ date: new Date(start + i * 86400000), kinds: [] }));
  let blockedIndex: number | null = null;
  for (const e of entries) {
    const d = new Date(e.occurred_at);
    d.setHours(0, 0, 0, 0);
    const i = Math.round((+d - start) / 86400000);
    if (i < 0 || i >= span) continue;
    if (e.kind === "blocked") blockedIndex = i;
    else days[i].kinds.push(e.kind);
  }
  return { days, blockedIndex };
}
