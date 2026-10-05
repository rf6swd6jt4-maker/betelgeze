export type ServiceTransferWork = {
    id: string; title: string; status: string; execution_owner_id: string | null;
    assignees: string[]; shared: boolean; movable: boolean;
}
export type ServiceTransferPreview = {
    instanceId: string; version: number; stage: string; formerId: string | null; recipientId: string;
    fingerprint: string; recipientName: string; formerName: string; items: ServiceTransferWork[]; appointment: boolean; bookingEnabled: boolean;
    formerSetupRetained: boolean; formerBookingRetained: boolean; teamMembershipRetained: boolean;
}
export function defaultTransferWork(preview: ServiceTransferPreview) {
    return preview.items.filter(item => item.movable
        && (!item.execution_owner_id || item.execution_owner_id === preview.formerId)
        && item.assignees.every(id => id === preview.formerId)).map(item => item.id)
}

export type ServiceTransferRequest = {
    expectedUserId: string; requestId: string; instanceId: string; recipientId: string;
    fingerprint: string; workIds: string[]; reason: string;
}
/** Device recovery is untrusted input. Never render or replay a malformed saved preview. */
export function recoverServiceTransfer(value: string, userId: string, instanceId: string): { input: ServiceTransferRequest; preview: ServiceTransferPreview } | null {
    if (value.length > 200_000) return null
    try {
        const data = JSON.parse(value)
        const input = data?.input, preview = data?.preview
        const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
        if (!input || input.expectedUserId !== userId || input.instanceId !== instanceId || !uuid(input.requestId) || !uuid(input.recipientId)
            || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1000
            || typeof input.fingerprint !== "string" || !/^[a-f0-9]{32}$/.test(input.fingerprint)
            || !Array.isArray(input.workIds) || input.workIds.length > 200 || !input.workIds.every(uuid)
            || !preview || preview.instanceId !== instanceId || preview.recipientId !== input.recipientId || preview.fingerprint !== input.fingerprint
            || typeof preview.recipientName !== "string" || preview.recipientName.length > 500
            || !["onboarding", "setup", "maintenance"].includes(preview.stage)
            || !["appointment", "bookingEnabled", "formerSetupRetained", "formerBookingRetained", "teamMembershipRetained"].every(key => typeof preview[key] === "boolean")
            || !Array.isArray(preview.items) || preview.items.length > 200) return null
        for (const item of preview.items) {
            if (!item || !uuid(item.id) || typeof item.title !== "string" || item.title.length > 1000 || typeof item.status !== "string"
                || item.execution_owner_id !== null && !uuid(item.execution_owner_id)
                || typeof item.shared !== "boolean" || typeof item.movable !== "boolean" || !Array.isArray(item.assignees) || item.assignees.length > 200 || !item.assignees.every(uuid)) return null
        }
        return { input, preview }
    } catch { return null }
}
