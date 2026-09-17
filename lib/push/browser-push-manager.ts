// Declarative-capable browsers retain this subscription independently of the
// worker registration. The root worker shares it and remains the legacy path.
export function browserPushManager(registration?: ServiceWorkerRegistration): PushManager | undefined {
    return (window as Window & { pushManager?: PushManager }).pushManager ?? registration?.pushManager
}

export function pushApplicationServerKey(value: string) {
    const padding = "=".repeat((4 - value.length % 4) % 4)
    const raw = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"))
    return Uint8Array.from(raw, character => character.charCodeAt(0))
}
