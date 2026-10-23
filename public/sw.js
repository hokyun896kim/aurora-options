// 오로라 서비스워커: 푸시 알림 표시 + 누르면 앱 열기 (캐시는 안 함)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let p = { title: '오로라', body: '새 소식이 있다', url: '/' };
  try { p = Object.assign(p, event.data ? event.data.json() : {}); } catch (e) {}
  event.waitUntil(self.registration.showNotification(p.title, {
    body: p.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: p.tag || 'aurora',
    renotify: true,
    data: { url: p.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) c.navigate(url); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
