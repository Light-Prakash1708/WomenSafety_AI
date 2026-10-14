import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { ContactEditor } from "@/components/ContactEditor";
import { Button, Card, Chip, ErrorText, Field, H1, Note, Screen, Sub } from "@/components/ui";
import { useApp } from "@/lib/app-state";
import type { Lang } from "@/lib/i18n";
import { registerPush } from "@/lib/notifications";
import { setPins } from "@/lib/pins";
import { c, f } from "@/lib/theme";

const STEPS = ["You", "Your circle", "PINs", "Permissions"] as const;

export default function Onboarding() {
  const router = useRouter();
  const { session, profile, contacts, lang, setLang, updateProfile } = useApp();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.display_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [pin, setPin] = useState("");
  const [duress, setDuress] = useState("");
  const [perms, setPerms] = useState({ location: false, background: false, notify: false });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const next = async () => {
    setErr("");
    try {
      setBusy(true);
      if (step === 0) {
        if (!name.trim()) throw new Error("Add the name your circle knows you by.");
        await updateProfile({ display_name: name.trim(), phone: phone.trim() || null });
      }
      if (step === 1 && contacts.length === 0) throw new Error("Add at least one person. You can change this later.");
      if (step === 2) await setPins(pin, duress);
      if (step === 3) {
        await updateProfile({ onboarded: true });
        router.replace("/(tabs)");
        return;
      }
      setStep(step + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const askLocation = async () => {
    const fg = await Location.requestForegroundPermissionsAsync();
    setPerms((p) => ({ ...p, location: fg.granted }));
  };
  const askBackground = async () => {
    const bg = await Location.requestBackgroundPermissionsAsync().catch(() => ({ granted: false }));
    setPerms((p) => ({ ...p, background: bg.granted }));
  };
  const askNotify = async () => {
    const ok = session ? await registerPush(session.user.id) : false;
    setPerms((p) => ({ ...p, notify: ok }));
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 16, marginBottom: 18 }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? c.ink : c.faint }} />
        ))}
      </View>
      <Text style={{ fontFamily: f.bodyBold, fontSize: 12, color: c.muted, letterSpacing: 1.2 }}>
        STEP {step + 1} OF 4 · {STEPS[step].toUpperCase()}
      </Text>

      {step === 0 && (
        <View style={{ gap: 14 }}>
          <H1>Let's set up your safety net</H1>
          <Sub>Takes about two minutes. Everything here can be changed later.</Sub>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["en", "hi", "bn"] as Lang[]).map((l) => (
              <Chip key={l} label={l === "en" ? "English" : l === "hi" ? "हिंदी" : "বাংলা"} active={lang === l} onPress={() => setLang(l)} />
            ))}
          </View>
          <Field label="Your name" value={name} onChangeText={setName} placeholder="Ananya Ghosh" hint="Shown to your circle in SOS messages." />
          <Field
            label="Your mobile number (optional)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+91 98300 12345"
            hint="If someone lists this number in their circle, you'll get their alerts in the app."
          />
        </View>
      )}

      {step === 1 && (
        <View style={{ gap: 14 }}>
          <H1>Who should come for you?</H1>
          <Sub>Pick 2 to 5 people who'll pick up at night. They get a text with your live location. Anyone with SAAHI also gets a push.</Sub>
          <ContactEditor />
        </View>
      )}

      {step === 2 && (
        <View style={{ gap: 14 }}>
          <H1>Two PINs that keep you in control</H1>
          <Card bg={c.sage}>
            <Text style={{ fontFamily: f.displayBold, fontSize: 16, color: c.ink }}>Cancel PIN</Text>
            <Text style={{ fontFamily: f.body, fontSize: 13.5, color: c.ink, marginTop: 4 }}>Stops an alert and tells your circle you're safe.</Text>
          </Card>
          <Field label="Cancel PIN (4 digits)" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} />
          <Card bg={c.blush}>
            <Text style={{ fontFamily: f.displayBold, fontSize: 16, color: c.ink }}>Duress PIN</Text>
            <Text style={{ fontFamily: f.body, fontSize: 13.5, color: c.ink, marginTop: 4 }}>
              If someone forces you to cancel, enter this one. Your screen will say the alert was cancelled. Help keeps coming, and your circle is told you may have been forced.
            </Text>
          </Card>
          <Field label="Duress PIN (4 digits, different)" value={duress} onChangeText={(v) => setDuress(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad" secureTextEntry maxLength={4} />
          <Note>PINs are stored only on this phone, as scrambled hashes. Nobody at SAAHI can see them.</Note>
        </View>
      )}

      {step === 3 && (
        <View style={{ gap: 12 }}>
          <H1>Let SAAHI help when it counts</H1>
          <Sub>Each one is used only during an SOS or a journey you start.</Sub>
          <Button tone={perms.location ? "ok" : "ghost"} label={perms.location ? "Location: allowed" : "Allow location"} onPress={askLocation} />
          <Button
            tone={perms.background ? "ok" : "ghost"}
            label={perms.background ? "Background location: allowed" : "Allow location while screen is locked"}
            onPress={askBackground}
            disabled={!perms.location}
          />
          <Sub style={{ fontSize: 12.5 }}>On Android, choose "Allow all the time" on the next screen. Without it, sharing pauses when your phone locks.</Sub>
          <Button tone={perms.notify ? "ok" : "ghost"} label={perms.notify ? "Notifications: on" : "Turn on notifications"} onPress={askNotify} />
          <Note>SAAHI works alongside 112 India. It doesn't replace emergency services, and it can't guarantee anyone will reach you in time.</Note>
        </View>
      )}

      <ErrorText>{err}</ErrorText>
      <View style={{ gap: 10, marginTop: 20 }}>
        <Button label={step === 3 ? "Finish setup" : "Continue"} onPress={next} loading={busy} />
        {step > 0 && <Button tone="ghost" label="Back" onPress={() => setStep(step - 1)} />}
      </View>
    </Screen>
  );
}
