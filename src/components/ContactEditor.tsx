import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { supabase } from "@/lib/supabase";
import { c, f } from "@/lib/theme";

const swatches = [c.marigold, c.lilac, c.blush, c.sage];

export function ContactEditor() {
  const { session, contacts, refresh } = useApp();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = async () => {
    setErr("");
    const digits = phone.replace(/[^\d+]/g, "");
    if (!name.trim()) return setErr("Add a name.");
    if (digits.replace(/\D/g, "").length < 10) return setErr("Add a full mobile number, like +91 98300 12345.");
    if (contacts.length >= 8) return setErr("Keep your circle to 8 people so alerts stay fast.");
    setBusy(true);
    const { error } = await supabase.from("trusted_contacts").insert({
      owner_id: session!.user.id,
      name: name.trim(),
      phone: digits.startsWith("+") ? digits : `+91${digits.slice(-10)}`,
      relation: relation.trim() || null,
      priority: contacts.length + 1,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setName("");
    setPhone("");
    setRelation("");
    refresh();
  };

  const remove = async (id: string) => {
    await supabase.from("trusted_contacts").delete().eq("id", id);
    refresh();
  };

  return (
    <View style={{ gap: 14 }}>
      {contacts.map((ct, i) => (
        <Card key={ct.id} bg={swatches[i % 4]} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: c.ink, backgroundColor: c.paper, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: f.bodyBold, color: c.ink }}>{ct.name.slice(0, 2)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: f.displayBold, fontSize: 16, color: c.ink }}>{ct.name}</Text>
            <Text style={{ fontFamily: f.body, fontSize: 13, color: c.ink }}>
              {ct.phone}
              {ct.relation ? ` · ${ct.relation}` : ""}
              {ct.linked_user_id ? " · has SAAHI" : ""}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${ct.name}`} onPress={() => remove(ct.id)} hitSlop={10}>
            <Text style={{ fontFamily: f.bodyBold, color: c.ink, fontSize: 13 }}>Remove</Text>
          </Pressable>
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
