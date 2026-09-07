import type { FormResponse } from "./forms"

function canonicalValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalValue)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !(key === "receipt" && "path" in value))
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalValue(item)]))
    return value
}

/** Retries may acknowledge the already stored answer, never replace it. */
export function sameOnboardingResponse(stored: FormResponse | undefined, submitted: FormResponse) {
    return Boolean(stored) && JSON.stringify(canonicalValue(stored)) === JSON.stringify(canonicalValue(submitted))
}
