/* 医键排班 · 极简 Service Worker
 * 作用：让安卓 Chrome 满足「可安装到主屏」的必要条件（需带 fetch 处理）。
 * 策略：网络优先，失败回退缓存。不预缓存全部资源，避免更新后 stale。
 * 仅在生产构建注册（见 src/main.tsx），本地 dev 不会启用，不影响 HMR。 */
const CACHE = 'med-schedule-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        return response;
      } catch {
        const cached = await caches.match(request);
        return cached || Response.error();
      }
    })(),
  );
});
