// SAAHI service worker: keeps the app shell available on a weak connection.
// Pages: network first, cached copy if offline. Built assets and fonts: cache first.
// API calls (/api) are never cached.
const CACHE = "saahi-shell-v2";
const scope = self.registration.scope;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([scope, scope + "manifest.webmanifest"]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // The API and the contact tracking page are always fetched live.
  const path = url.pathname.slice(new URL(scope).pathname.length - 1);
  if (path.startsWith("/api") || path.startsWith("/track")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(scope, copy));
          return res;
        })
        .catch(() => caches.match(scope)),
    );
    return;
  }

  if (url.pathname.includes("/_expo/") || url.pathname.includes("/assets/") || url.pathname.includes("/icons/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
