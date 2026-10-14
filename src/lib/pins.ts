// Cancel PIN and duress PIN, stored only on this phone as salted SHA-256 hashes.
// Entering the duress PIN makes the screen say "cancelled" while the alert stays live.
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const SALT = "saahi.pin.salt";
const CANCEL = "saahi.pin.cancel";
const DURESS = "saahi.pin.duress";

async function salt(): Promise<string> {
  let s = await SecureStore.getItemAsync(SALT);
  if (!s) {
    s = Crypto.randomUUID();
    await SecureStore.setItemAsync(SALT, s);
  }
  return s;
}

async function hash(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${await salt()}:${pin}`);
}

export async function setPins(cancelPin: string, duressPin: string) {
  if (!/^\d{4}$/.test(cancelPin) || !/^\d{4}$/.test(duressPin)) throw new Error("PINs must be 4 digits.");
  if (cancelPin === duressPin) throw new Error("Your duress PIN must be different from your cancel PIN.");
  await SecureStore.setItemAsync(CANCEL, await hash(cancelPin));
  await SecureStore.setItemAsync(DURESS, await hash(duressPin));
}

export async function hasPins(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(CANCEL));
}

export type PinResult = "cancel" | "duress" | "wrong";

export async function checkPin(pin: string): Promise<PinResult> {
  const h = await hash(pin);
  if (h === (await SecureStore.getItemAsync(CANCEL))) return "cancel";
  if (h === (await SecureStore.getItemAsync(DURESS))) return "duress";
  return "wrong";
}
