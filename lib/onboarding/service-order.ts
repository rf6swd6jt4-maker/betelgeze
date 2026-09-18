import type { ConfigurationActionResult } from "@/lib/onboarding/configuration-types"

export type ReorderedServices = { service_count: number }

// PostgreSQL accepts UUID values independently of RFC version and variant bits.
// Some deterministic legacy service IDs rely on that wider representation.
export const POSTGRES_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validServiceOrder(value: unknown): value is string[] {
    return Array.isArray(value)
        && value.length > 0
        && value.length <= 10_000
        && value.every((serviceId) => typeof serviceId === "string" && POSTGRES_UUID_PATTERN.test(serviceId))
        && new Set(value).size === value.length
}

export async function sendServiceOrder(workspaceSlug: string, serviceIds: string[]): Promise<ConfigurationActionResult<ReorderedServices>> {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/services/order`, {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceIds }),
        signal: AbortSignal.timeout(20_000),
    })
    if (response.status >= 500 || !response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("The service order could not be confirmed. Your order is preserved for retry.")
    }
    return response.json()
}
