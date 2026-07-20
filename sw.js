/* 금리·물가 알리미 — 서비스워커: 오프라인 캐시 + 발표일 백그라운드 알림 */
importScripts("series.js", "schedule.js", "data.js");

const CACHE = "rate-alert-v5";
const ASSETS = [
  "./", "index.html", "app.js", "series.js", "schedule.js", "data.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* HTML·JS·매니페스트: 네트워크 우선(항상 서로 맞는 버전) → 오프라인이면 캐시.
   아이콘 등 정적 리소스: 캐시 우선. */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  const url = new URL(e.request.url);
  const isCore = e.request.mode === "navigate"
    || /\.(html|js|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (isCore) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }))
    );
  }
});

/* Periodic Background Sync 지원 기기: 하루 두 번 발표일 점검 */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag !== "announce-check") return;
  e.waitUntil((async () => {
    const t = todayStr();
    const todays = (self.BASE_DATA?.schedule || []).filter((x) => x.date === t);
    if (!todays.length) return;
    await self.registration.showNotification("📢 오늘은 금리·물가 발표일", {
      body: todays.map((x) => x.title).join("\n"),
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "announce-" + t
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});
