import { useState } from "react";
import { Linking, Platform, Pressable, Share, Text, View } from "react-native";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { api, SITE_URL, type Contact } from "@/lib/api";
import { useApp } from "@/lib/app-state";
import { c, f } from "@/lib/theme";

const swatches = [c.marigold, c.lilac, c.blush, c.sage];

export function inviteMessage(ownerName: string, code: string) {
  const first = ownerName.split(" ")[0] || "I";
  return `${first} added you to their SAAHI safety circle. If they send an SOS, you'll get their live location. To get alerts in the app too, open ${SITE_URL}/join?code=${code} or enter the guardian code ${code} in SAAHI.`;
}

const inviteExpired = (ct: Contact) => Boolean(ct.invite_expires_at && +new Date(ct.invite_expires_at) < Date.now());

export function ContactEditor() {
  const { contacts, setContacts, profile } = useApp();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const add = async () => {
    setErr("");
    const cleaned = phone.replace(/[^\d+]/g, "");
    if (!name.trim()) return setErr("Add a name.");
    if (cleaned.replace(/\D/g, "").length < 10) return setErr("Add a full mobile number, like +91 98300 12345.");
    setBusy(true);
    try {
      const r = await api<{ contacts: Contact[] }>("POST", "contacts", {
        name: name.trim(),
        phone: cleaned.startsWith("+") ? cleaned : `+91${cleaned.slice(-10)}`,
        relation: relation.trim() || null,
      });
      setContacts(r.contacts);
      setName("");
      setPhone("");
      setRelation("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const r = await api<{ contacts: Contact[] }>("DELETE", `contacts/${id}`);
      setContacts(r.contacts);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // New code: the old one stops working, and anyone who joined with it loses access at once.
  const rotate = async (id: string) => {
    try {
      const r = await api<{ contacts: Contact[] }>("POST", `contacts/${id}/unlink`);
      setContacts(r.contacts);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const invite = async (ct: Contact) => {
    const msg = inviteMessage(profile?.display_name ?? "", ct.invite_code);
    if (Platform.OS === "web") {
      const digits = ct.phone.replace(/\D/g, "");
      await Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`).catch(() => {});
    } else {
      await Share.share({ message: msg }).catch(() => {});
    }
  };

  return (
    <View style={{ gap: 14 }}>
      {contacts.map((ct, i) => (
        <Card key={ct.id} bg={swatches[i % 4]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: c.ink, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: f.bodyBold, color: c.ink }}>{ct.name.slice(0, 2)}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: f.displayBold, fontSize: 16, color: c.ink }} numberOfLines={1}>
                {ct.name}
              </Text>
              <Text style={{ fontFamily: f.body, fontSize: 13, color: c.ink }} numberOfLines={1}>
                {ct.phone}
                {ct.relation ? ` · ${ct.relation}` : ""}
                {ct.linked_user_id ? " · has SAAHI" : ""}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${ct.name}`} onPress={() => setOpen(open === ct.id ? null : ct.id)} hitSlop={10}>
              <Text style={{ fontFamily: f.bodyBold, color: c.ink, fontSize: 13 }}>{open === ct.id ? "Close" : "More"}</Text>
            </Pressable>
          </View>
          {open === ct.id && (
            <View style={{ marginTop: 12, gap: 8 }}>
              <Text style={{ fontFamily: f.body, fontSize: 13, color: c.ink, lineHeight: 18 }}>
                {ct.linked_user_id
                  ? `Joined as "${ct.guardian_name || "someone"}"${ct.linked_at ? ` on ${new Date(ct.linked_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}. They see your alerts in the SAAHI app as well as by text. If that isn't ${ct.name}, revoke it.`
                  : inviteExpired(ct)
                    ? `The guardian code for ${ct.name} has expired. Make a new one to invite them.`
                    : `Guardian code ${ct.invite_code}, valid until ${ct.invite_expires_at ? new Date(ct.invite_expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "used"}. Send it so ${ct.name} also gets your alerts in the SAAHI app.`}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {!ct.linked_user_id && !inviteExpired(ct) && <Button label="Send invite" onPress={() => invite(ct)} style={{ flexGrow: 1 }} />}
                {!ct.linked_user_id && inviteExpired(ct) && <Button label="New code" onPress={() => rotate(ct.id)} style={{ flexGrow: 1 }} />}
                {ct.linked_user_id && <Button tone="ghost" label="Revoke app access" onPress={() => rotate(ct.id)} style={{ flexGrow: 1 }} />}
                <Button tone="ghost" label="Remove" onPress={() => remove(ct.id)} style={{ flexGrow: 1 }} />
              </View>
            </View>
          )}
        </Card>
      ))}
      <Card>
        <View style={{ gap: 12 }}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Ma" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 98300 12345" />
          <Field label="Relation (optional)" value={relation} onChangeText={setRelation} placeholder="Mother, roommate, warden" />
          <ErrorText>{err}</ErrorText>
          <Button label="Add to my circle" onPress={add} loading={busy} />
        </View>
      </Card>
    </View>
  );
}
