const CACHE_NAME = "gielda-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Cache-first for static assets and images
  if (
    e.request.destination === "image" ||
    url.includes("/_next/static/")
  ) {
    e.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(e.request).then((cached) => {
          if (cached) return cached;
          return fetch(e.request).then((res) => {
            cache.put(e.request, res.clone());
            return res;
          });
        })
      )
    );
    return;
  }

  // Network-first for API calls and pages (with offline fallback)
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
