// Declarative-capable browsers retain this subscription independently of the
// worker registration. The root worker shares it and remains the legacy path.
export function browserPushManager(registration?: ServiceWorkerRegistration): PushManager | undefined {
    return (window as Window & { pushManager?: PushManager }).pushManager ?? registration?.pushManager
}
