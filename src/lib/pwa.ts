// Makes the web build installable ("Install SAAHI" in Chrome, Edge and Safari) and
// registers the service worker. Links are added from here so they respect the base path
// the site is hosted under (for example /WomenSafety_AI on GitHub Pages).
import { Platform } from "react-native";

export function setupPwa() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const base = (process.env.EXPO_BASE_URL ?? "").replace(/\/$/, "");
  const link = (rel: string, href: string, extra: Record<string, string> = {}) => {
    if (document.querySelector(`link[rel="${rel}"]`)) return;
    const el = document.createElement("link");
    el.rel = rel;
    el.href = `${base}${href}`;
    Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
    document.head.appendChild(el);
  };
  link("manifest", "/manifest.webmanifest");
  link("apple-touch-icon", "/icons/apple-touch-icon.png");
  link("icon", "/icons/icon-192.png", { type: "image/png" });

  const isLocalDev = location.hostname === "localhost" && location.port === "8081" && process.env.NODE_ENV !== "production";
  if ("serviceWorker" in navigator && !isLocalDev) {
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {});
  }
}
