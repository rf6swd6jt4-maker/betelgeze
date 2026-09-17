import { subscriptionFingerprint } from "./subscription-fingerprint"

// Repair an already enabled device only. Account changes and an explicit off
// setting must never silently subscribe the browser to a different user.
export async function reconcilePushSubscription(registration: ServiceWorkerRegistration) {
    if (!("Notification" in window) || Notification.permission !== "granted") return
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return
    const response = await fetch("/api/push/subscriptions", { cache: "no-store", signal: AbortSignal.timeout(8_000) })
    if (!response.ok) return
    const result = await response.json()
    if (!result.subscribed || !result.configured || !result.fingerprint) return
    const local = subscription.toJSON()
    if (result.fingerprint === await subscriptionFingerprint(local)) return
    await fetch("/api/push/subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...local, reconcile: true }), signal: AbortSignal.timeout(8_000),
    })
}
