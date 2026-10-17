// Startzeit – Service Worker
// Speichert die App selbst (HTML, JS, CSS, Icons), damit sie auch ohne Netz startet.
// Die Sportdaten speichert die App selbst im Browser (localStorage).
const CACHE = "startzeit-v3";
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

  // Kalender-Termin: Die App schickt den Termin im Link mit, hier wird daraus eine echte
  // .ics-Datei. iOS zeigt dann "Zum Kalender hinzufügen".
  if (url.origin === self.location.origin && url.pathname === "/termin.ics") {
    try {
      const b64 = (url.searchParams.get("d") || "").replace(/-/g, "+").replace(/_/g, "/");
      const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
      const ics = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      e.respondWith(new Response(ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'inline; filename="termin.ics"',
        },
      }));
    } catch {
      e.respondWith(new Response("Termin konnte nicht erstellt werden.", { status: 400 }));
    }
    return;
  }

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