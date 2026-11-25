/**
 * ============================================================================
 * SERVICE WORKER - POS MINIMARKET MANDIRI (100% OFFLINE PWA)
 * Meng-cache seluruh file aplikasi & library CDN agar tetap berjalan lancar
 * di HP/Tablet Android meskipun dalam Mode Pesawat (tanpa kuota internet).
 * ============================================================================
 */

const CACHE_NAME = "pos-minimarket-offline-v6";

const LOCAL_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

const CDN_ASSETS = [
  "https://cdn.tailwindcss.com",
  "https://cdn.jsdelivr.net/npm/dexie@4.0.11/dist/dexie.min.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"
];

// Tahap Install: Simpan semua file lokal & library CDN ke memori perangkat
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(LOCAL_ASSETS);

      // Simpan library CDN satu per satu agar tetap aman jika jaringan lambat
      for (const cdnUrl of CDN_ASSETS) {
        try {
          const response = await fetch(cdnUrl, { mode: "cors" });
          if (response && response.ok) {
            await cache.put(cdnUrl, response);
          }
        } catch (err) {
          try {
            const opaqueReq = new Request(cdnUrl, { mode: "no-cors" });
            const opaqueRes = await fetch(opaqueReq);
            if (opaqueRes) {
              await cache.put(cdnUrl, opaqueRes);
            }
          } catch (innerErr) {
            console.warn("Gagal pre-cache CDN:", cdnUrl);
          }
        }
      }
    })
  );
  self.skipWaiting();
});

// Tahap Activate: Hapus cache versi lama jika ada pembaruan
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => caches.delete(oldKey))
      )
    )
  );
  self.clients.claim();
});

// Tahap Fetch: Layani dari Cache seketika (Stale-While-Revalidate)
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Abaikan request selain GET dan abaikan koneksi API Supabase
  if (req.method !== "GET" || req.url.includes("supabase.co")) {
    return;
  }

  // Untuk halaman utama (navigasi), gunakan cache index.html jika offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return networkRes;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Untuk CSS, JS, dan Library CDN: Utamakan Cache agar instan & jalan di Mode Pesawat
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const networkFetch = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.ok || networkResponse.type === "opaque")) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});