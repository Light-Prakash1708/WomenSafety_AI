// AI helpers. Two jobs, both bounded:
//   { mode: "summary", thread_id }        -> drafts a factual summary of her own pattern entries
//   { mode: "guide", question, language } -> plain-language general information about options in India
// The model never labels anyone a criminal, never judges whether an assault happened,
// and always points high-stakes questions to people. If ANTHROPIC_API_KEY is not set,
// the summary falls back to a rules-based one and the guide returns curated text.
import { asUser, cors, currentUserId, json } from "../_shared/util.ts";

const MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-5-5";
const KEY = Deno.env.get("ANTHROPIC_API_KEY");

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
  if (!KEY) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) return null;
  const out = await res.json();
  return (out.content ?? []).map((c: { text?: string }) => c.text ?? "").join("").trim() || null;
}

type Entry = { kind: string; occurred_at: string; channel: string | null; handle: string | null; note: string | null };

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const uid = await currentUserId(req);
  if (!uid) return json({ error: "Sign in again." }, 401);
  const body = await req.json().catch(() => ({}));
  const db = asUser(req);

  if (body.mode === "summary") {
    const { data: entries, error } = await db
      .from("pattern_entries")
      .select("kind, occurred_at, channel, handle, note")
      .eq("thread_id", body.thread_id)
      .order("occurred_at");
    if (error) return json({ error: "Couldn't read this thread." }, 400);
    const list = (entries ?? []) as Entry[];
    const prompt = list
      .map((e) => `${e.occurred_at} | ${e.kind} | ${e.channel ?? ""} | ${e.handle ?? ""} | ${(e.note ?? "").slice(0, 400)}`)
      .join("\n");
    const ai = list.length ? await claude(SUMMARY_SYSTEM, `Entries (time | kind | channel | handle | note):\n${prompt}`) : null;
    const text = ai ?? rulesSummary(list);
    const source = ai ? "ai" : "rules";
    await db.from("pattern_summaries").insert({ owner_id: uid, thread_id: body.thread_id, body: text, source });
    return json({ body: text, source });
  }

  if (body.mode === "guide") {
    const q = String(body.question ?? "").slice(0, 1000);
    if (!q.trim()) return json({ error: "Type a question first." }, 400);
    const ai = await claude(GUIDE_SYSTEM, q);
    return json({
      body: ai ??
        "If you're in danger now, call 112.\n\nYou can file a Zero FIR at any police station, wherever it happened. For harassment at work or college, the Internal Committee is another route. 181 is the Women Helpline and 1930 is for cyber crime. Medical care within 72 hours matters, with or without a police report.\n\nThis is general information. A counsellor or the legal aid desk can help with your situation.",
      source: ai ? "ai" : "curated",
    });
  }

  return json({ error: "Unknown mode." }, 400);
});
