import { useRouter } from "expo-router";
import { View } from "react-native";
import { ContactEditor } from "@/components/ContactEditor";
import { Button, H1, Note, Screen, Sub } from "@/components/ui";

export default function Contacts() {
  const router = useRouter();
  return (
    <Screen edges={["top", "bottom"]}>
      <View style={{ height: 16 }} />
      <H1>Your circle</H1>
      <Sub>They get a text with your live location when you send an SOS. Anyone who also has SAAHI gets a push and can tap "On it".</Sub>
      <ContactEditor />
      <Note>Tell each person you've added them, so they know what a SAAHI text means and pick up at night.</Note>
      <Button tone="ghost" label="Done" onPress={() => router.back()} style={{ marginTop: 16 }} />
    </Screen>
  );
}
