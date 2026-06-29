// sw.js — VisCarMa Service Worker
// Handles background push notifications from the server agent

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  if (!e.data) return;

  let payload;
  try { payload = e.data.json(); }
  catch { payload = { title: 'VisCarMa', body: e.data.text() }; }

  const options = {
    body:    payload.body  || 'Agent task complete.',
    icon:    payload.icon  || '/viscarma_logo.png',
    badge:   payload.badge || '/viscarma_logo.png',
    data:    payload.data  || {},
    actions: (payload.data?.prs || []).slice(0, 2).map(pr => ({
      action: pr.url,
      title:  `View PR #${pr.number}`,
    })),
    requireInteraction: true,
    tag: 'viscarma-agent',
  };

  e.waitUntil(self.registration.showNotification(payload.title || 'VisCarMa Done', options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();

  // If user clicked an action button (a specific PR)
  if (e.action && e.action.startsWith('http')) {
    e.waitUntil(clients.openWindow(e.action));
    return;
  }

  // Otherwise open the VisCarMa app
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('viscarma') && 'focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
