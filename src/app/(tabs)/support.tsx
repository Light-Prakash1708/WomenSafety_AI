import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { IconSpark } from "@/components/icons";
import { Button, Card, Chip, ErrorText, Field, H1, Note, Screen, Section, Sub, TopBar } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { api } from "@/lib/api";
import { DIRECTORY_CHECKED, HELPLINES } from "@/lib/support-directory";
import { c, f } from "@/lib/theme";

const PATHS: Record<string, { title: string; body: string }[]> = {
  now: [
    { title: "Get somewhere safe", body: "Go to a lit, busy place or call 112. Hold the SOS button so your circle knows." },
    { title: "Medical care", body: "Every hospital, government or private, must give free treatment to survivors of sexual assault, with or without a police report. Care within 72 hours matters most." },
    { title: "Keep what you can", body: "If you're able, don't wash or change clothes yet, and keep messages and call logs. It's okay if you already have." },
  ],
  past: [
    { title: "Talk it through", body: "Tele-MANAS (14416) and the 181 helpline can connect you to a counsellor in your language." },
    { title: "Reporting is your choice", body: "You can file a Zero FIR at any police station, wherever it happened. Reporting later is still possible." },
    { title: "Write it down", body: "Use the vault to write your account in your own words, at your own pace." },
  ],
  ongoing: [
    { title: "Log each incident", body: "Use Pattern to record messages, calls and sightings. The timeline shows escalation clearly." },
    { title: "Campus or workplace", body: "The Internal Committee (ICC) must act on sexual harassment complaints under the POSH Act." },
    { title: "Online harassment", body: "Report on cybercrime.gov.in or call 1930. Save screenshots to your vault first." },
  ],
};

export default function Support() {
  const { lang } = useApp();
  const [path, setPath] = useState<keyof typeof PATHS>("now");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<{ body: string; source: "ai" | "curated" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showSources, setShowSources] = useState(false);

  const ask = async () => {
    setErr("");
    if (!q.trim()) return;
    setBusy(true);
    try {
      const data = await api<{ body: string; source: "ai" | "curated" }>("POST", "guide", { question: q.trim(), language: lang }, { timeoutMs: 40000 });
      setAnswer(data);
    } catch {
      setErr("The guide is unavailable right now. The helplines above are always open.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar title="support" />
      <H1>Whatever happened, start anywhere</H1>
      <Sub>No forms first. You choose what to share, and when.</Sub>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip label="It just happened" active={path === "now"} onPress={() => setPath("now")} />
        <Chip label="A while ago" active={path === "past"} onPress={() => setPath("past")} />
        <Chip label="It's ongoing" active={path === "ongoing"} onPress={() => setPath("ongoing")} />
      </View>
      <View style={{ gap: 10, marginTop: 14 }}>
        {PATHS[path].map((p, i) => (
          <Card key={p.title} bg={[c.blush, c.sage, c.lilac][i]}>
            <Text style={{ fontFamily: f.displayBold, fontSize: 16, color: c.ink }}>{p.title}</Text>
            <Text style={{ fontFamily: f.body, fontSize: 13.5, color: c.ink, marginTop: 3, lineHeight: 19 }}>{p.body}</Text>
          </Card>
        ))}
      </View>

      <Section title="Helplines" hint="free · tap to call" />
      <Card>
        {HELPLINES.map((l, i) => (
          <Pressable
            key={l.number}
            accessibilityRole="button"
            accessibilityLabel={`Call ${l.name}, ${l.number}`}
            onPress={() => Linking.openURL(`tel:${l.number}`)}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1.5 : 0, borderTopColor: c.faint }}
          >
            <Text style={{ fontFamily: f.display, fontSize: 20, color: l.number === "112" ? c.sosDeep : c.ink, width: 64 }}>{l.number}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: f.bodyBold, fontSize: 14, color: c.ink }}>{l.name}</Text>
              <Text style={{ fontFamily: f.body, fontSize: 12.5, color: c.muted }}>
                {l.purpose} · {l.hours}
              </Text>
            </View>
            <Text style={{ fontFamily: f.bodyBold, color: c.ink }}>Call</Text>
          </Pressable>
        ))}
        <Pressable accessibilityRole="link" onPress={() => setShowSources((v) => !v)} style={{ paddingTop: 8 }}>
          <Text style={{ fontFamily: f.body, fontSize: 12, color: c.muted }}>
            Checked {new Date(DIRECTORY_CHECKED).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} against official sources. {showSources ? "Hide sources" : "Show sources"}
          </Text>
        </Pressable>
        {showSources &&
          HELPLINES.map((l) => (
            <Pressable key={`src-${l.number}`} accessibilityRole="link" onPress={() => Linking.openURL(l.sourceUrl)}>
              <Text style={{ fontFamily: f.body, fontSize: 12, color: c.ink, textDecorationLine: "underline", marginTop: 4 }}>
                {l.number}: {l.source}
              </Text>
            </Pressable>
          ))}
      </Card>

      <Section title="Ask in your language" hint="English · हिंदी · বাংলা" />
      <Card bg={c.lilac}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <IconSpark />
          <Text style={{ fontFamily: f.bodyBold, fontSize: 11, letterSpacing: 1, color: c.ink }}>SAAHI GUIDE · AI · GENERAL INFORMATION</Text>
        </View>
        <Field label="Your question" value={q} onChangeText={setQ} multiline placeholder="অভিযোগ করতে কি থানায় যেতেই হবে?" />
        <View style={{ height: 10 }} />
        <Button label="Ask" onPress={ask} loading={busy} disabled={!q.trim()} />
        <ErrorText>{err}</ErrorText>
        {answer && (
          <View style={{ marginTop: 12 }}>
            <Text testID="guide-source" style={{ fontFamily: f.bodyBold, fontSize: 11, letterSpacing: 0.5, color: c.ink }}>
              {answer.source === "ai" ? "WRITTEN BY AI · CAN BE WRONG · CHECK WITH A HELPLINE" : "STANDARD ANSWER WRITTEN BY SAAHI (AI UNAVAILABLE)"}
            </Text>
            <Text style={{ fontFamily: f.body, fontSize: 14, color: c.ink, marginTop: 6, lineHeight: 20 }}>{answer.body}</Text>
          </View>
        )}
      </Card>
      <Note>The guide is an AI model with fixed safety rules. When AI is switched on, your question is sent to Anthropic to answer it; SAAHI does not save it. It gives general information, not legal or medical advice. It never decides whether something "counts". For your situation, call 15100 for free legal aid or 14416 to talk to a counsellor.</Note>
    </Screen>
  );
}
