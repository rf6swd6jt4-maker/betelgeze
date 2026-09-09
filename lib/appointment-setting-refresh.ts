import type { AppointmentSettingAppointment } from "./appointment-setting"
import type { AppointmentDeliveryState } from "./appointment-setting-delivery"

export type AppointmentSettingSnapshot = {
    appointments: AppointmentSettingAppointment[]
    delivery: AppointmentDeliveryState
}

export async function fetchAppointmentSettingSnapshot(workspaceSlug: string, relationshipId: string, signal?: AbortSignal): Promise<AppointmentSettingSnapshot> {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/appointment-setting/${encodeURIComponent(relationshipId)}`, {
        method: "GET",
        cache: "no-store",
        signal,
        headers: { Accept: "application/json" },
    })
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Could not refresh appointments.")
    return response.json()
}

// Focus/visibility events often arrive together. A brief return can use the
// rendered data; Realtime changes and reconnects bypass that freshness window.
export class AppointmentRefreshPolicy {
    private checkedAt: number
    private revision = 0
    private checkedRevision = 0

    constructor(now: number) { this.checkedAt = now }
    invalidate() { this.revision += 1 }
    capture() { return this.revision }
    needsRefresh(now: number, visible: boolean) {
        return visible && (this.revision !== this.checkedRevision || now - this.checkedAt >= 15_000)
    }
    completed(revision: number, now: number) {
        this.checkedAt = now
        this.checkedRevision = revision
    }
}
