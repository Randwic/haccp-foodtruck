// Notifications des alertes HACCP (lot 6), chargé par le service worker de l'app (workbox importScripts).
// Le serveur (alerts-evaluate) envoie { title, body, url, tag, alert_id, kind } chiffré en Web Push.
self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = { body: event.data ? event.data.text() : '' }
  }
  const title = typeof msg.title === 'string' && msg.title ? msg.title : 'Alerte HACCP'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof msg.body === 'string' ? msg.body : '',
      tag: typeof msg.tag === 'string' ? msg.tag : undefined,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      data: { url: typeof msg.url === 'string' && msg.url.startsWith('/') ? msg.url : '/' },
    }),
  )
})

// Appui sur la notification : ramène l'app au premier plan (ou l'ouvre) sur l'écran d'accueil.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus()
      return self.clients.openWindow(url)
    }),
  )
})
