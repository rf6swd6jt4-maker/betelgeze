import { browserPushManager, pushApplicationServerKey } from "./browser-push-manager"
import { subscriptionFingerprint } from "./subscription-fingerprint"

// Repair transport only with stored installation-wide consent. Never infer
// consent from OS permission alone or undo an explicitly disabled installation.
export async function reconcilePushSubscription(registration?: ServiceWorkerRegistration) {
    if (!("Notification" in window) || Notification.permission !== "granted") return
    const manager = browserPushManager(registration)
    if (!manager) return
    const [existing, response] = await Promise.all([
        manager.getSubscription(),
        fetch("/api/push/subscriptions", { cache: "no-store", signal: AbortSignal.timeout(8_000) }),
    ])
    if (!response.ok) return
    const result = await response.json()
    if (result.enabled === false || !result.configured || !result.publicKey) return
    const recover = result.enabled === null && Boolean(existing)
    if (result.enabled !== true && !recover) return
    if (existing && result.fingerprint === await subscriptionFingerprint(existing.toJSON())) return
    // A removed provider endpoint must be replaced rather than endlessly saved
    // again. Consent survives a 404/410; an explicit off clears consent instead.
    if (existing && !result.subscribed && !recover) await existing.unsubscribe()
    const subscription = existing && (result.subscribed || recover) ? existing : await manager.subscribe({
        userVisibleOnly: true, applicationServerKey: pushApplicationServerKey(result.publicKey),
    })
    const saved = await fetch("/api/push/subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...subscription.toJSON(), reconcile: true, recover }), signal: AbortSignal.timeout(8_000),
    })
    if (saved.ok) window.dispatchEvent(new Event("betelgeze:push-setting-changed"))
}
