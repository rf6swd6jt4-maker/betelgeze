const fallbackAppOrigin = "https://app.betelgeze.com"

export function isInstalledAppHostname(hostname: string) {
    return hostname === "app.betelgeze.com" || hostname === "dashboard.betelgeze.com"
}

export function isTrustedBetelgezeUrl(value: string | null) {
    return Boolean(value && /^https:\/\/(app|dashboard|onboarding|leadgen)\.betelgeze\.com(?:\/|$)/.test(value))
}

export function isSafeRelativePath(value: string | null) {
    return Boolean(value && value.startsWith("/") && !value.startsWith("//"))
}

export function normalizeAuthNext(value: string | null, origin = fallbackAppOrigin) {
    if (isTrustedBetelgezeUrl(value)) return value!
    if (isSafeRelativePath(value)) return value!
    return origin
}

export function resolveClientDestination(value: string | null) {
    if (isTrustedBetelgezeUrl(value)) return value!
    const currentAppOrigin = isInstalledAppHostname(window.location.hostname)
        ? window.location.origin
        : fallbackAppOrigin
    if (isSafeRelativePath(value)) {
        return isInstalledAppHostname(window.location.hostname) ? value! : `${fallbackAppOrigin}${value}`
    }
    return currentAppOrigin
}
