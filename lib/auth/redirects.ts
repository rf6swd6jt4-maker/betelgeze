const fallbackAppOrigin = "https://app.betelgeze.com"

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
    if (isSafeRelativePath(value)) {
        return window.location.hostname === "app.betelgeze.com"
            ? value!
            : `${fallbackAppOrigin}${value}`
    }
    return fallbackAppOrigin
}
