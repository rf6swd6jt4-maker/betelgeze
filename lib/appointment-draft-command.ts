import type { AppointmentDraftChanges, AppointmentSettingAppointment } from "./appointment-setting"
import type { PersistedAppointmentDraft } from "./appointment-draft-queue"
import type { AppointmentUpdateField } from "./appointment-setting"

export type AppointmentDraftCommandIdentity = { requestId: string; expectedUserId: string }
export type AppointmentDraftCommand = AppointmentDraftCommandIdentity & {
    appointmentId: string
    expectedUpdatedAt: string
    changes: AppointmentDraftChanges
}
export type AppointmentSubmissionCommand = { expectedUserId: string; appointmentId: string; expectedUpdatedAt: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELDS = new Set(["contact_name", "appointment_date", "appointment_time", "appointment_timezone", "meeting_medium", "meeting_link", "detail:phone", "detail:email", "detail:service", "detail:address", "detail:notes"])

export function parsePersistedAppointmentDraft(value: unknown): PersistedAppointmentDraft<AppointmentUpdateField> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const saved = value as Record<string, unknown>
    if (typeof saved.version !== "string" || saved.version.length > 50 || !Number.isFinite(Date.parse(saved.version)) || !saved.changes || typeof saved.changes !== "object" || Array.isArray(saved.changes)) return null
    const changes = Object.fromEntries(Object.entries(saved.changes).filter(([key, value]) => FIELDS.has(key) && typeof value === "string" && value.length <= 2_000))
    const pending = saved.pending as Record<string, unknown> | undefined
    if (pending && ((pending.transport !== undefined && pending.transport !== "action" && pending.transport !== "command") || typeof pending.requestId !== "string" || !UUID.test(pending.requestId) || typeof pending.version !== "string" || !Number.isFinite(Date.parse(pending.version)) || !pending.changes || typeof pending.changes !== "object" || Array.isArray(pending.changes) || Object.entries(pending.changes).some(([key, value]) => !FIELDS.has(key) || typeof value !== "string" || value.length > 2_000))) return { version: saved.version, changes, conflict: true }
    return { version: saved.version, changes, conflict: saved.conflict === true, ...(pending ? { pending: { transport: pending.transport as "action" | "command" | undefined, requestId: pending.requestId as string, version: pending.version as string, changes: pending.changes as AppointmentDraftChanges } } : {}) }
}

export function parseAppointmentDraftCommand(value: unknown): AppointmentDraftCommand | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const command = value as Record<string, unknown>
    if (![command.requestId, command.expectedUserId, command.appointmentId].every((id) => typeof id === "string" && UUID.test(id))) return null
    if (typeof command.expectedUpdatedAt !== "string" || command.expectedUpdatedAt.length > 50 || !Number.isFinite(Date.parse(command.expectedUpdatedAt))) return null
    if (!command.changes || typeof command.changes !== "object" || Array.isArray(command.changes)) return null
    const entries = Object.entries(command.changes)
    if (!entries.length || entries.length > FIELDS.size || entries.some(([field, text]) => !FIELDS.has(field) || typeof text !== "string" || text.length > 2_000)) return null
    return {
        requestId: command.requestId as string, expectedUserId: command.expectedUserId as string,
        appointmentId: command.appointmentId as string, expectedUpdatedAt: command.expectedUpdatedAt,
        changes: Object.fromEntries(entries) as AppointmentDraftChanges,
    }
}

export function appointmentDraftCommandIsSameOrigin(request: Request) {
    const origin = request.headers.get("origin")
    // This is a browser command endpoint. Reject missing/null origins as well
    // as sibling origins; a cookie alone never authorizes a cross-site write.
    return origin === new URL(request.url).origin && request.headers.get("sec-fetch-site") !== "cross-site"
}

export function parseAppointmentSubmissionCommand(value: unknown): AppointmentSubmissionCommand | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    const command = value as Record<string, unknown>
    if (typeof command.expectedUserId !== "string" || !UUID.test(command.expectedUserId) || typeof command.appointmentId !== "string" || !UUID.test(command.appointmentId)
        || typeof command.expectedUpdatedAt !== "string" || command.expectedUpdatedAt.length > 50 || !Number.isFinite(Date.parse(command.expectedUpdatedAt))) return null
    return { expectedUserId: command.expectedUserId, appointmentId: command.appointmentId, expectedUpdatedAt: command.expectedUpdatedAt }
}

export async function sendAppointmentSubmissionCommand(workspaceSlug: string, relationshipId: string, command: AppointmentSubmissionCommand) {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/appointment-setting/${encodeURIComponent(relationshipId)}/submit`, {
        method: "POST", credentials: "same-origin", redirect: "error", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command), signal: AbortSignal.timeout(20_000),
    })
    if (response.status >= 500 || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Submission could not be confirmed. Check the latest appointment before retrying.")
    return await response.json() as import("./workspace-mutations").WorkspaceMutationResult<import("./appointment-setting-commands").AppointmentSubmission>
}

export async function sendAppointmentDraftCommand(workspaceSlug: string, relationshipId: string, command: AppointmentDraftCommand) {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/appointment-setting/${encodeURIComponent(relationshipId)}/draft`, {
        method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(command),
        signal: AbortSignal.timeout(20_000),
    })
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Your session could not be confirmed. Reconnect before retrying your preserved changes.")
    if (response.status >= 500) throw new Error("The save could not be confirmed. Your changes are preserved for retry.")
    return await response.json() as
        | { ok: true; data: AppointmentSettingAppointment; version?: string }
        | { ok: false; error: string; conflict?: boolean; fieldErrors?: Record<string, string> }
}
