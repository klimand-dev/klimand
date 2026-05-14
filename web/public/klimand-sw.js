// Klimand service worker — minimal Web Push handler.
// Self-registered by web/lib/push-notifications.ts on Pro accounts.

self.addEventListener("push", (event) => {
  let payload = { title: "Klimand", body: "", tag: "klimand", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_e) {
    /* keep defaults */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
      icon: "/favicon.ico"
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const win of wins) {
          if ("focus" in win) {
            win.focus();
            if ("navigate" in win) win.navigate(url);
            return;
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
        return undefined;
      })
  );
});
