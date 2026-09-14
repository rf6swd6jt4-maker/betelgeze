const SECURE_DELIVERY_KINDS = new Set(["onboarding_link", "module_update", "client_portal_link"])

export function secureLinkDisplayUrl(publicUrl: string) {
    try {
        const url = new URL(publicUrl)
        if (url.protocol !== "https:" && url.protocol !== "http:") return "Secure link"
        return `${url.origin}/…`
    } catch {
        return "Secure link"
    }
}

export function secureDeliveryLogBody(body: string, publicUrl: string, kind: string) {
    if (!publicUrl || !SECURE_DELIVERY_KINDS.has(kind)) return body
    return body.split(publicUrl).join(secureLinkDisplayUrl(publicUrl))
}
