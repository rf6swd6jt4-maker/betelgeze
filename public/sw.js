const CACHE_NAME = "betelgeze-pwa-v5";
const STATIC_ASSETS = [
  "/icons/betelgeze-icon-192.png",
  "/icons/betelgeze-icon-512.png",
  "/brand/betelgeze-logo-inverted-no-background.svg",
  "/offline.html",
  "/offline.css",
  "/offline.js",
  "/offline-store.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("betelgeze-pwa-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(async () => {
        // WebKit can return a successful navigation-preload response with an
        // empty body when reopening an installed app. Disable preload for both
        // this worker and registrations upgraded from the previous version.
        if (self.registration.navigationPreload) await self.registration.navigationPreload.disable().catch(() => undefined);
        await self.clients.claim();
      })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    // Network-first documents retain the ordinary online response and auth
    // redirects. Do not consume navigationPreload: WebKit has returned an
    // empty 200 document here on installed-app relaunches. Only a failed
    // ordinary request opens the static recovery document.
    event.respondWith(fetch(event.request).catch(async () => {
      const fallback = await caches.match("/offline.html");
      return fallback || Response.error();
    }));
    return;
  }
  if (!STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const proposed = payload && typeof payload.notification === "object" && payload.notification !== null
    ? payload.notification
    : payload;
  const proposedData = proposed && typeof proposed.data === "object" && proposed.data !== null
    ? proposed.data
    : {};
  const legacyUrl = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";
  const dataUrl = typeof proposedData.url === "string" && proposedData.url.startsWith("/")
    ? proposedData.url
    : legacyUrl;
  const title = typeof proposed.title === "string" && proposed.title.trim() ? proposed.title : "Betelgeze";
  const tag = typeof proposed.tag === "string" ? proposed.tag : (typeof payload.tag === "string" ? payload.tag : undefined);
  const options = {
    body: typeof proposed.body === "string" ? proposed.body : "A Betelgeze update is ready.",
    icon: typeof proposed.icon === "string" ? proposed.icon : "/icons/betelgeze-icon-192.png",
    badge: typeof proposed.badge === "string" ? proposed.badge : "/icons/betelgeze-icon-192.png",
    tag,
    renotify: Boolean(tag && proposed.renotify),
    data: {
      url: dataUrl,
      deliveryId: proposedData.deliveryId,
      receiptToken: proposedData.receiptToken,
      category: typeof proposedData.category === "string" ? proposedData.category : (typeof payload.category === "string" ? payload.category : "update"),
      conversationId: typeof proposedData.conversationId === "string" ? proposedData.conversationId : (typeof payload.conversationId === "string" ? payload.conversationId : null),
      messageId: typeof proposedData.messageId === "string" ? proposedData.messageId : (typeof payload.messageId === "string" ? payload.messageId : null),
      messageCreatedAt: typeof proposedData.messageCreatedAt === "string" ? proposedData.messageCreatedAt : (typeof payload.messageCreatedAt === "string" ? payload.messageCreatedAt : null),
      unreadCount: Number.isSafeInteger(proposedData.unreadCount) ? proposedData.unreadCount : (Number.isSafeInteger(payload.unreadCount) ? payload.unreadCount : 1),
    },
  };

  // Do not perform any asynchronous work before showing the notification.
  // WebKit can revoke original Web Push subscriptions when a handler wakes the
  // device but fails to display promptly. Declarative-capable WebKit uses the
  // payload itself as a fallback if this imperative replacement ever fails.
  const report = async (outcome) => {
    if (typeof options.data.deliveryId !== "string" || typeof options.data.receiptToken !== "string") return;
    try {
      await fetch("/api/push/receipts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryId: options.data.deliveryId, receiptToken: options.data.receiptToken, outcome }),
        signal: AbortSignal.timeout(3000),
      });
    } catch { /* Receipt transport cannot prevent notification display. */ }
  };
  event.waitUntil(self.registration.showNotification(title, options).then(
    () => report("shown"),
    async (error) => { await report("failed"); throw error; }
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.url || "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const exactClient = clientList.find((client) => client.url === targetUrl);
      if (exactClient) return exactClient.focus();
      const existingClient = clientList.find((client) => client.url.startsWith(self.location.origin));
      if (existingClient) {
        const navigatedClient = await existingClient.navigate(targetUrl);
        return navigatedClient ? navigatedClient.focus() : existingClient.focus();
      }
      return clients.openWindow(targetUrl);
    })()
  );
});
