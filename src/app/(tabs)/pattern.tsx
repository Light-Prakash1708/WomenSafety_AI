import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Share, Text, TextInput, View } from "react-native";
import { IconSpark } from "@/components/icons";
import { PatternChart } from "@/components/PatternChart";
import { Button, Card, Chip, ErrorText, Field, H1, Note, Screen, Section, Sub, TopBar, s as ui } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { KIND, stats } from "@/lib/pattern";
import { api, type PatternEntry } from "@/lib/api";
import { c, f, radius } from "@/lib/theme";

type Thread = { id: string; title: string };

export default function Pattern() {
  const router = useRouter();
  const { session } = useApp();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [entries, setEntries] = useState<PatternEntry[]>([]);
  const [summary, setSummary] = useState<{ id?: string; body: string; source: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    const list = (await api<{ threads: Thread[] }>("GET", "threads")).threads;
    setThreads(list);
    const id = active && list.some((t) => t.id === active) ? active : list[0]?.id ?? null;
    setActive(id);
    if (!id) {
      setEntries([]);
      setSummary(null);
      return;
    }
    const r = await api<{ entries: PatternEntry[]; summary: { id: string; body: string; source: string } | null }>("GET", `threads/${id}`);
    setEntries(r.entries);
    setSummary(r.summary);
  }, [active]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const createThread = async () => {
    if (!newTitle.trim() || !session) return;
    try {
      const r = await api<{ thread: Thread }>("POST", "threads", { title: newTitle.trim() });
      setNewTitle("");
      setActive(r.thread.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const summarize = async () => {
    if (!active) return;
    setErr("");
    setBusy(true);
    try {
      const data = await api<{ body: string; source: string }>("POST", `threads/${active}/summary`, undefined, { timeoutMs: 40000 });
      setSummary({ body: data.body, source: data.source });
    } catch {
      setErr("Couldn't draft a summary right now. Your entries are safe; try again in a minute.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!summary || !active || !session) return;
    try {
      await api("PUT", `threads/${active}/summary`, { body: summary.body, source: summary.source });
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const exportThread = async () => {
    const title = threads.find((t) => t.id === active)?.title ?? "Pattern";
    const lines = [...entries]
      .reverse()
      .map((e) => `${new Date(e.occurred_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · ${KIND[e.kind].label}${e.channel ? ` · ${e.channel}` : ""}${e.handle ? ` · ${e.handle}` : ""}${e.note ? `\n   ${e.note}` : ""}`);
    const text = [`${title} (timeline from SAAHI)`, "", ...lines, "", summary ? `Summary (drafted with AI, reviewed by me):\n${summary.body}` : ""].join("\n");
    await Share.share({ message: text });
  };

  const st = stats(entries);
  const thread = threads.find((t) => t.id === active);

  return (
    <Screen>
      <TopBar title="pattern" />
      {!threads.length ? (
        <>
          <H1>Keep a record that adds up</H1>
          <Sub>
            Log messages, calls, new accounts and times someone turned up. SAAHI lays them on one timeline so you can see the pattern, and so can anyone you choose to show.
          </Sub>
          <Card>
            <View style={{ gap: 12 }}>
              <Field label="What should we call this thread?" value={newTitle} onChangeText={setNewTitle} placeholder="Unwanted contact from one person" />
              <Button label="Start a thread" onPress={createThread} disabled={!newTitle.trim()} />
            </View>
          </Card>
          <Note>SAAHI only organises what you add. It doesn't read your chats, identify faces or decide anyone's guilt.</Note>
        </>
      ) : (
        <>
          {threads.length > 1 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {threads.map((t) => (
                <Chip key={t.id} label={t.title} active={t.id === active} onPress={() => setActive(t.id)} />
              ))}
            </View>
          )}
          <H1>{thread?.title}</H1>
          <Sub>Private thread · only you can see it</Sub>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Stat n={st.total} label={`events · ${st.days} days`} />
            <Stat n={st.afterBlock} label="after blocking" />
            <Stat n={st.inPerson} label="in person" alert={st.inPerson > 0} />
          </View>

          {st.threats > 0 && (
            <Card bg={c.blush} style={{ marginTop: 12 }}>
              <Text style={{ fontFamily: f.bodyBold, fontSize: 14, color: c.ink }}>You logged a threat.</Text>
              <Text style={{ fontFamily: f.body, fontSize: 13.5, color: c.ink, marginTop: 2 }}>If you feel unsafe right now, call 112 or tell someone in your circle today.</Text>
            </Card>
          )}

          <Card style={{ marginTop: 12 }}>
            <PatternChart entries={entries} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
              {(["message", "new_account", "call", "in_person", "threat"] as const).map((k) => (
                <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 3, borderWidth: 1.5, borderColor: c.ink, backgroundColor: KIND[k].color }} />
                  <Text style={{ fontFamily: f.bodySemi, fontSize: 11, color: c.muted }}>{KIND[k].label}</Text>
                </View>
              ))}
            </View>
          </Card>

          <Section title="AI summary" hint="editable · not evidence" />
          <Card bg={c.lilac}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <IconSpark />
              <Text style={{ fontFamily: f.bodyBold, fontSize: 11, letterSpacing: 1, color: c.ink }}>
                {summary ? (summary.source === "ai" ? "DRAFTED WITH AI FROM YOUR ENTRIES" : "COUNTED FROM YOUR ENTRIES") : "NO SUMMARY YET"}
              </Text>
            </View>
            {summary ? (
              editing ? (
                <TextInput
                  multiline
                  value={summary.body}
                  onChangeText={(v) => setSummary({ ...summary, body: v })}
                  style={{ fontFamily: f.body, fontSize: 14, color: c.ink, backgroundColor: c.white, borderWidth: 2, borderColor: c.ink, borderRadius: radius.md, padding: 10, minHeight: 140, textAlignVertical: "top" }}
                />
              ) : (
                <Text style={{ fontFamily: f.body, fontSize: 14, color: c.ink, lineHeight: 20 }}>{summary.body}</Text>
              )
            ) : (
              <Text style={{ fontFamily: f.body, fontSize: 13.5, color: c.ink }}>Add a few entries, then draft a summary you can edit and share.</Text>
            )}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <Chip label={busy ? "Drafting…" : summary ? "Redraft" : "Draft summary"} onPress={busy || !entries.length ? undefined : summarize} />
              {summary && <Chip label={editing ? "Save edit" : "Edit"} onPress={editing ? saveEdit : () => setEditing(true)} />}
            </View>
            <ErrorText>{err}</ErrorText>
          </Card>

          <Section title="Options, your choice" />
          <View style={{ gap: 10 }}>
            <Button label="+ Add an entry" onPress={() => router.push({ pathname: "/entry", params: { thread: active ?? "" } })} />
            <Button tone="ghost" label="Share timeline for a complaint" onPress={exportThread} disabled={!entries.length} />
            <Button tone="ghost" label="Talk to a counsellor first" onPress={() => router.push("/support")} />
          </View>

          <Section title="Timeline" hint={`${entries.length} entries`} />
          <View style={{ borderLeftWidth: 2, borderLeftColor: c.ink, marginLeft: 8, paddingLeft: 18, gap: 14 }}>
            {entries.map((e) => (
              <View key={e.id}>
                <View style={{ position: "absolute", left: -27, top: 2, width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: c.ink, backgroundColor: KIND[e.kind].color }} />
                <Text style={{ fontFamily: f.mono, fontSize: 11, color: c.muted }}>
                  {new Date(e.occurred_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase()}
                </Text>
                <Text style={{ fontFamily: f.bodyBold, fontSize: 14.5, color: c.ink }}>
                  {KIND[e.kind].label}
                  {e.handle ? ` · ${e.handle}` : ""}
                </Text>
                {e.note ? <Text style={{ fontFamily: f.body, fontSize: 13, color: c.muted, lineHeight: 18 }}>{e.note}</Text> : null}
                {e.channel ? <Text style={ui.hint}>{e.channel}</Text> : null}
              </View>
            ))}
            {!entries.length && <Text style={ui.hint}>No entries yet.</Text>}
          </View>

          <Section title="New thread" />
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}>
              <Field label="Title" value={newTitle} onChangeText={setNewTitle} placeholder="A different person or place" />
            </View>
            <Button label="Add" onPress={createThread} disabled={!newTitle.trim()} style={{ paddingHorizontal: 18 }} />
          </View>
          <Note>Summaries are drafted from your entries and labelled as summaries. Your originals stay in your vault, unchanged.</Note>
        </>
      )}
    </Screen>
  );
}

function Stat({ n, label, alert }: { n: number; label: string; alert?: boolean }) {
  return (
    <View style={{ flex: 1, borderWidth: 2, borderColor: c.ink, borderRadius: radius.md, padding: 10, backgroundColor: c.paper }}>
      <Text style={{ fontFamily: f.display, fontSize: 26, color: alert ? c.sosDeep : c.ink, lineHeight: 28 }}>{n}</Text>
      <Text style={{ fontFamily: f.bodySemi, fontSize: 11, color: c.muted }}>{label}</Text>
    </View>
  );
}
