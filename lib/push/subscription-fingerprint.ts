export async function subscriptionFingerprint(subscription: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) return null
    const bytes = new TextEncoder().encode(JSON.stringify([subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]))
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
}
