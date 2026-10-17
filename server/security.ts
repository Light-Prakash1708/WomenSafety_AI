// Passwords, session tokens and random codes. Node's crypto only; no external services.
import crypto from "node:crypto";

export function secret(): Buffer {
  const explicit = process.env.JWT_SECRET;
  if (explicit) return Buffer.from(explicit);
  // Derive a stable signing key from the Turso token, so no extra setup is needed.
  const base = process.env.TURSO_AUTH_TOKEN;
  if (!base) throw new Error("Set JWT_SECRET or TURSO_AUTH_TOKEN.");
  return crypto.createHash("sha256").update(`saahi-session-v1|${base}`).digest();
}

export const uuid = () => crypto.randomUUID();
export const randomHex = (bytes: number) => crypto.randomBytes(bytes).toString("hex");
export const sha256Hex = (data: string | Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");

const B32 = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L to avoid misreading
export function randomCode(len: number): string {
  const bytes = crypto.randomBytes(len);
  return [...bytes].map((b) => B32[b % B32.length]).join("");
}
export function recoveryCode(): string {
  const raw = randomCode(16);
  return raw.match(/.{4}/g)!.join("-");
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((ok, bad) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? bad(e) : ok(k))),
  );
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await new Promise<Buffer>((ok, bad) =>
    crypto.scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? bad(e) : ok(k))),
  );
  return crypto.timingSafeEqual(key, expected);
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(body));
  const s = crypto.createHmac("sha256", secret()).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

export function verifyToken<T = Record<string, unknown>>(token: string): (T & { exp: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = crypto.createHmac("sha256", secret()).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}
