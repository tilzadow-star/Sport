// Startzeit – Service Worker
// Speichert die App selbst (HTML, JS, CSS, Icons), damit sie auch ohne Netz startet.
// Die Sportdaten speichert die App selbst im Browser (localStorage).
const CACHE = "startzeit-v2";
const CORE = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Sport-APIs und andere fremde Adressen: nicht anfassen (immer frisch aus dem Netz)
  if (url.origin !== self.location.origin) return;

  // Seitenaufruf: zuerst Netz (damit Updates sofort ankommen), ohne Netz die gespeicherte Version
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(async () => (await caches.match("/index.html")) || (await caches.match("/")))
    );
    return;
  }

  // Dateien der App (JS, CSS, Bilder): gespeicherte Version sofort, im Hintergrund aktualisieren
  e.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    })
  );
});