// Service worker of the installable web app (PWA). Kept small on purpose:
// - pages: network first; a page that loaded before is shown from the cache when the network
//   is down, else /offline.html;
// - /_next/static/* (hashed, never changes in a build): cache first — not in dev mode
//   (registered as /sw.js?dev=1), where those files change on every edit;
// - icons and the offline page: cached on install;
// - /api/* and anything that is not a GET: never touched (always live data, sign-in, sends).
const VERSION = "v1";
const PAGES = `pages-${VERSION}`;
const STATIC = `static-${VERSION}`;
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];
const DEV = new URL(self.location.href).searchParams.get("dev") === "1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => ![PAGES, STATIC].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // keep the last good copy of each page (not the sign-in redirect)
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/offline.html"))),
    );
    return;
  }

  if (!DEV && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
