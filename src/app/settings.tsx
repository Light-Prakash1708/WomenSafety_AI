import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Button, Card, ErrorText, Field, H1, Note, Screen, Section, Sub, Toggle } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import { isWeb } from "@/lib/layout";
import { setPins } from "@/lib/pins";
import { usePrefs } from "@/lib/prefs";
import { api } from "@/lib/api";

export default function Settings() {
  const router = useRouter();
  const { profile, updateProfile, signOut, session } = useApp();
  const [prefs, setPrefs] = usePrefs();
  const [name, setName] = useState(profile?.display_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [pin, setPin] = useState("");
  const [duress, setDuress] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveProfile = async () => {
    setErr("");
    try {
      await updateProfile({ display_name: name.trim(), phone: phone.trim() || null });
      setMsg("Profile saved.");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const savePins = async () => {
    setErr("");
    try {
      await setPins(pin, duress);
      setPin("");
      setDuress("");
      setMsg("PINs updated.");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const deleteEverything = async () => {
    setErr("");
    try {
      await api("DELETE", "me");
      await signOut();
      router.replace("/");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ height: 16 }} />
      <H1>Settings</H1>
      <Sub>{msg}</Sub>

      <Section title="You" />
      <View style={{ gap: 12 }}>
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Button label="Save profile" onPress={saveProfile} />
      </View>

      <Section title="SOS" />
      <Card>
        {!isWeb && (
          <Toggle label="Shake to send SOS" hint="Three hard shakes while SAAHI is open." value={prefs.shakeToSos} onChange={(v) => setPrefs({ shakeToSos: v })} />
        )}
        <Toggle label="Record audio during SOS" hint="Saved to your private vault when the alert ends." value={prefs.recordAudio} onChange={(v) => setPrefs({ recordAudio: v })} />
      </Card>

      <Section title="Ghost call" />
      <Field label="Caller name" value={prefs.ghostCaller} onChangeText={(v) => setPrefs({ ghostCaller: v })} placeholder="Didi" />

      <Section title="Change PINs" />
      <View style={{ gap: 12 }}>
        <Field label="New cancel PIN" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" secureTextEntry />
        <Field label="New duress PIN" value={duress} onChangeText={(v) => setDuress(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" secureTextEntry />
        <Button label="Update PINs" onPress={savePins} disabled={pin.length < 4 || duress.length < 4} />
      </View>
      <ErrorText>{err}</ErrorText>

      <Section title="Account" hint={session?.user.email} />
      <View style={{ gap: 10 }}>
        <Button tone="ghost" label="Enter a guardian code" onPress={() => router.push("/join")} />
        <Button tone="ghost" label="Sign out" onPress={async () => { await signOut(); router.replace("/"); }} />
        {!confirmDelete ? (
          <Button tone="ghost" label="Delete all my data" onPress={() => setConfirmDelete(true)} />
        ) : (
          <Card>
            <Sub>This permanently deletes your circle, alerts, pattern, vault files and reports. It can't be undone.</Sub>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button tone="danger" label="Delete everything" onPress={deleteEverything} style={{ flex: 1 }} />
              <Button tone="ghost" label="Keep" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }} />
            </View>
          </Card>
        )}
      </View>
      <Note>SAAHI never sells or shares your location, reports or vault. Institutions that use SAAHI only ever see area-level counts.</Note>
      <Button tone="ghost" label="Close" onPress={() => router.back()} style={{ marginTop: 16 }} />
    </Screen>
  );
}
