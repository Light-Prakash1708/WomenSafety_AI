// AI helpers, deliberately bounded. Summaries describe her own logged entries; the guide gives
// general information about options in India. The model never labels anyone a criminal or judges
// whether a crime happened. Without ANTHROPIC_API_KEY both fall back to deterministic text.
const SUMMARY_SYSTEM = `You help a woman organise records she chose to log about unwanted contact or harassment.
Write a short, factual summary (under 120 words) followed by 3 to 5 bullet observations about frequency, channels,
contact after blocking, in-person contact, and any change over time. Use only the entries given.
Rules: Never call anyone a criminal, stalker, rapist or abuser. Never guess identities. Never say whether a crime
occurred or whether evidence proves anything. Describe behaviour, dates and counts. If an entry mentions a threat
of harm, say so plainly and add one bullet: "Consider calling 112 or talking to someone you trust today."
Output plain text: summary paragraph, a blank line, then bullets starting with "- ".`;

const GUIDE_SYSTEM = `You are SAAHI's support guide for women in India. Give general information in simple language, in the
same language as the question (English, Hindi or Bengali). Keep answers under 150 words.
Cover practical options: 112 for emergencies, 181 Women Helpline, 14490 NCW helpline, 1930 cyber crime, One Stop Centres,
Zero FIR at any police station, the Internal Committee at workplaces and colleges, free legal aid via the District Legal
Services Authority, medical care within 72 hours. Never tell her what she must do, never judge whether something
"counts", never advise confronting anyone. End with one line saying this is general information and offering a
counsellor or legal aid for her specific situation. If she may be in danger now, start with "If you're in danger now, call 112."`;

async function claude(system: string, user: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.AI_MODEL ?? "claude-sonnet-5-5", max_tokens: 600, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { content?: { text?: string }[] };
    return (out.content ?? []).map((c) => c.text ?? "").join("").trim() || null;
  } catch {
    return null;
  }
}

export type Entry = { kind: string; occurred_at: string; channel: string | null; handle: string | null; note: string | null };

function rulesSummary(entries: Entry[]): string {
  if (!entries.length) return "No entries yet.";
  const sorted = [...entries].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const first = new Date(sorted[0].occurred_at);
  const last = new Date(sorted[sorted.length - 1].occurred_at);
  const days = Math.max(1, Math.round((+last - +first) / 86400000) + 1);
  const count = (k: string) => sorted.filter((e) => e.kind === k).length;
  const blockedAt = sorted.find((e) => e.kind === "blocked")?.occurred_at;
  const afterBlock = blockedAt ? sorted.filter((e) => e.occurred_at > blockedAt && e.kind !== "blocked").length : 0;
  const half = +first + (+last - +first) / 2;
  const early = sorted.filter((e) => +new Date(e.occurred_at) <= half && e.kind !== "blocked").length;
  const late = sorted.filter((e) => +new Date(e.occurred_at) > half && e.kind !== "blocked").length;
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const lines = [
    `${sorted.length} entries over ${days} days, from ${fmt(first)} to ${fmt(last)}.`,
    "",
    `- Messages: ${count("message")}, calls: ${count("call")}, new accounts or numbers: ${count("new_account")}.`,
    `- In-person contact logged: ${count("in_person")}.`,
  ];
  if (blockedAt) lines.push(`- ${afterBlock} event(s) logged after you blocked someone.`);
  if (late > early) lines.push(`- Contact increased in the second half of this period (${early} then ${late}).`);
  if (count("threat") > 0) lines.push(`- ${count("threat")} entry(ies) mention a threat. Consider calling 112 or talking to someone you trust today.`);
  return lines.join("\n");
}


const CURATED_GUIDE =
  "If you're in danger now, call 112.\n\nYou can file a Zero FIR at any police station, wherever it happened. For harassment at work or college, the Internal Committee is another route. 181 is the Women Helpline and 1930 is for cyber crime. Medical care within 72 hours matters, with or without a police report.\n\nThis is general information. A counsellor or the legal aid desk can help with your situation.";

export async function summarize(entries: Entry[]): Promise<{ body: string; source: "ai" | "rules" }> {
  if (!entries.length) return { body: "No entries yet.", source: "rules" };
  const prompt = entries
    .map((e) => `${e.occurred_at} | ${e.kind} | ${e.channel ?? ""} | ${e.handle ?? ""} | ${(e.note ?? "").slice(0, 400)}`)
    .join("\n");
  const ai = await claude(SUMMARY_SYSTEM, `Entries (time | kind | channel | handle | note):\n${prompt}`);
  return ai ? { body: ai, source: "ai" } : { body: rulesSummary(entries), source: "rules" };
}

export async function guide(question: string): Promise<{ body: string; source: "ai" | "curated" }> {
  const ai = await claude(GUIDE_SYSTEM, question);
  return ai ? { body: ai, source: "ai" } : { body: CURATED_GUIDE, source: "curated" };
}
