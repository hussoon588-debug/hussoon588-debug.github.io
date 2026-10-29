/* مدينة الأمير — Service Worker
 * استراتيجية: تنقّل شبكة-أولًا مع رجوع للكاش (عمل دون اتصال)،
 * أصول ثابتة كاش-أولًا، وAPI لا يُخزَّن أبدًا (سلامة الحفظ).
 */
const VERSION = "citypulse-mvu2rxnn";
/*
 * الجذر يُشتق من نطاق العامل نفسه، لا يُفترض "/": النسخة قد تُستضاف تحت
 * مسار فرعي (نسخة jsDelivr مثلًا)، وعندها كل مسار مطلق لا يبدأ بالمسار
 * الفرعي يشير إلى مكان آخر. على الاستضافة الجذرية يكون BASE فارغًا،
 * والنتيجة هي نفس المسارات السابقة حرفًا بحرف.
 */
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const ROOT = `${BASE}/`;
const SHELL = [ROOT, `${BASE}/manifest.webmanifest`, `${BASE}/icon.svg`, `${BASE}/icons/icon-192.png`, `${BASE}/icons/icon-512.png`];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // لا كاش لواجهة الحفظ ولا لبث التطوير
  if (url.pathname.startsWith(`${BASE}/api/`) || url.pathname.includes("webpack-hmr")) return;

  // التنقل: شبكة أولًا، ثم القشرة المخزنة.
  // الشبكة هنا تحتاج مهلة: طلب تنقّل معلّق يترك الصفحة بيضاء بلا نهاية،
  // وهو أسوأ من عرض نسخة مخزنة قد تكون أقدم قليلًا.
  if (req.mode === "navigate") {
    e.respondWith(
      Promise.race([
        fetch(req),
        new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
      ])
        .then((res) => {
          if (!res) return caches.match(ROOT).then((r) => r || fetch(req));
          // لا نخزّن إلا صفحة سليمة فعلًا: استجابة خطأ مخزّنة تعني شاشة ميتة
          // في كل فتحة قادمة، وهي أسوأ من عدم وجود كاش إطلاقًا.
          const type = res.headers.get("content-type") || "";
          if (res.ok && type.indexOf("text/html") !== -1) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(ROOT, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(ROOT).then((r) => r || Response.error()))
    );
    return;
  }

  // الأصول الثابتة والخطوط: كاش أولًا مع تحديث خلفي
  const isStatic =
    url.pathname.startsWith(`${BASE}/_next/static/`) ||
    url.pathname.startsWith(`${BASE}/icons/`) ||
    url.pathname === `${BASE}/icon.svg` ||
    url.pathname === `${BASE}/manifest.webmanifest` ||
    url.hostname === "fonts.gstatic.com" ||
    url.hostname === "fonts.googleapis.com";

  if (isStatic) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const refresh = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === "opaque")) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || refresh;
      })
    );
  }
});