import { cookies } from "next/headers"
import { PUSH_DEVICE_COOKIE, UUID_PATTERN } from "@/lib/push/device"
import { workspacePerformanceEnabled } from "@/lib/workspace-native"
import type { CommunicationReadProtocol } from "@/lib/communications/read-protocol"

export type DeviceReadPosition = { lastReadAt: string; lastReadMessageId: string | null }

/** Rollout is selected on the server before a summary owner mounts. Enabling
 * this flag requires the additive migration; missing RPCs never fall back. */
export function resolveCommunicationReadProtocol(workspaceId: string, userId: string): CommunicationReadProtocol {
    return workspacePerformanceEnabled(workspaceId, userId, process.env.WORKSPACE_COMMUNICATIONS_DEVICE_UNREAD, process.env.WORKSPACE_PERFORMANCE_USERS) ? "device-v1" : "account-v1"
}

/** Rollback can stop creating device owners while retaining their confirmed
 * read/recovery protocol. This flag grants no conversation or device access. */
export function communicationDeviceProtocolSupported(workspaceId: string, userId: string): boolean {
    return resolveCommunicationReadProtocol(workspaceId, userId) === "device-v1"
        || workspacePerformanceEnabled(workspaceId, userId, process.env.WORKSPACE_COMMUNICATIONS_DEVICE_UNREAD_COMPAT, process.env.WORKSPACE_PERFORMANCE_USERS)
}

export function validateCommunicationReadProtocol(request: Request, workspaceId: string, userId: string): CommunicationReadProtocol | Response {
    const requested = new URL(request.url).searchParams.get("readProtocol") ?? "account-v1"
    if (requested !== "account-v1" && requested !== "device-v1") return Response.json({ error: "Invalid read protocol." }, { status: 400 })
    if (requested === "device-v1" && !communicationDeviceProtocolSupported(workspaceId, userId)) {
        return Response.json({ error: "Device unread counts are unavailable. Reload to reconnect.", code: "protocol_unavailable", readProtocol: requested }, { status: 503 })
    }
    return requested
}

/** Only the HTTP-only installation cookie selects a device. A request ID is
 * a concurrency assertion, never permission to read another installation. */
export async function communicationDeviceId() {
    const value = (await cookies()).get(PUSH_DEVICE_COOKIE)?.value
    return value && UUID_PATTERN.test(value) ? value : null
}

export function deviceReadError(error: { code?: string } | null) {
    if (error?.code === "P0002") return Response.json({ error: "This device is still being verified. Reopen Betelgeze to retry.", code: "device_not_ready", readProtocol: "device-v1" }, { status: 409 })
    if (error?.code === "42501") return Response.json({ error: "Conversation not found.", readProtocol: "device-v1" }, { status: 404 })
    if (error?.code === "22023") return Response.json({ error: "Invalid conversation request.", readProtocol: "device-v1" }, { status: 400 })
    return Response.json({ error: "Device conversation state is unavailable. Please retry.", readProtocol: "device-v1" }, { status: 503 })
}

export class DeviceCommunicationError extends Error {
    constructor(readonly code: string) { super("Device conversation state is unavailable. Please retry.") }
}
export function deviceCommunicationErrorResponse(error: unknown) {
    return error instanceof DeviceCommunicationError ? deviceReadError({ code: error.code }) : null
}
