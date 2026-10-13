/* Term Organize — notifications while a tab is open, and Web Push when the server has VAPID keys. */
self.addEventListener("push", (event) => {
  let payload = { title: "Seat alert", body: "A watched section changed.", url: "/watchlist" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    /* keep the fallback copy */
  }
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, data: { url: payload.url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/watchlist";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
