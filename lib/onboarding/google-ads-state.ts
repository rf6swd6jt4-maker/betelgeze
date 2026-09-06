export type GoogleAdsOnboardingConnection = {
    customerId: string
    managerId: string
    managerName: string
    status: "pending" | "connected" | "needs_attention"
    accountName: string | null
    verifiedAt: string | null
}

export function normalizeGoogleAdsCustomerId(value: string) {
    if (typeof value !== "string" || value.length > 30) throw new Error("Enter your 10-digit Google Ads customer ID.")
    const id = value.replace(/[-\s]/g, "")
    if (!/^\d{10}$/.test(id)) throw new Error("Enter your 10-digit Google Ads customer ID, such as 123-456-7890.")
    return id
}

export function formatGoogleAdsCustomerId(value: string) {
    return /^\d{10}$/.test(value) ? `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}` : value
}

export function googleAdsOnboardingResponse(value: unknown): GoogleAdsOnboardingConnection | null {
    if (!value || typeof value !== "object") return null
    const response = value as Record<string, unknown>
    if (typeof response.customerId !== "string" || !/^\d{10}$/.test(response.customerId)
        || typeof response.managerId !== "string" || !/^\d{10}$/.test(response.managerId)
        || !["pending", "connected", "needs_attention"].includes(String(response.status))) return null
    return {
        customerId: response.customerId,
        managerId: response.managerId,
        managerName: typeof response.managerName === "string" ? response.managerName : "Your agency",
        status: response.status as GoogleAdsOnboardingConnection["status"],
        accountName: typeof response.accountName === "string" ? response.accountName : null,
        verifiedAt: typeof response.verifiedAt === "string" ? response.verifiedAt : null,
    }
}
