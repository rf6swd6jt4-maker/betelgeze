"use client";

import { useEffect } from "react";
import { clearOfflineData } from "@/public/offline-store.js";
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

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = 0;
    const reconcile = () => {
      if (cancelled || window.top !== window || document.visibilityState !== "visible" || !registration || Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      void reconcilePushSubscription(registration).catch(() => undefined);
    };
    const register = () => {
      if (cancelled) return;
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }).then((value) => { registration = value; reconcile(); }).catch(() => {
        // A failed registration should not block the authenticated app.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, []);

  return null;
}
