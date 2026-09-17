"use client";

import { useEffect } from "react";
import { clearOfflineData } from "@/public/offline-store.js";
import { browserPushManager } from "@/lib/push/browser-push-manager";
import { reconcilePushSubscription } from "@/lib/push/reconcile-subscription";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || new URL(form.action).pathname !== "/logout") return;
      event.preventDefault();
      void clearOfflineData().catch(() => undefined).finally(() => HTMLFormElement.prototype.submit.call(form));
    };
    document.addEventListener("submit", submit, true);
    return () => document.removeEventListener("submit", submit, true);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    if (window.location.hostname !== "app.betelgeze.com") return;
    if (window.top !== window) return;

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = 0;
    let lastUpdate = 0;
    const reconcile = () => {
      if (cancelled || window.top !== window || document.visibilityState !== "visible" || !browserPushManager(registration) || Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      void reconcilePushSubscription(registration).catch(() => undefined);
    };
    const resume = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      // Installed apps often resume the same document. Check for a fixed
      // worker without a reload, at most once per hour and never on a timer.
      if (registration && Date.now() - lastUpdate >= 60 * 60 * 1000) {
        lastUpdate = Date.now();
        void registration.update().catch(() => undefined);
      }
      reconcile();
    };
    const register = () => {
      if (cancelled) return;
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }).then((value) => {
        if (cancelled) return;
        registration = value;
        // A previously controlled iOS app can remain on an older worker until
        // WebKit performs its next soft update. Check immediately after a
        // successful document load; this never blocks launch or rendering.
        lastUpdate = Date.now();
        void value.update().catch(() => undefined);
        reconcile();
      }).catch(() => {
        // A failed registration should not block the authenticated app.
      });
    };

    // Hydration is sufficient: window.load also waits for every iframe and
    // image, including the stalled tab that may need this worker update.
    // Declarative push can reconcile even if worker installation fails.
    reconcile();
    register();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  return null;
}
