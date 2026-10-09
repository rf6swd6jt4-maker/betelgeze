import { cookies } from "next/headers"
import { PUSH_DEVICE_COOKIE, UUID_PATTERN } from "@/lib/push/device"

/** Installation identity comes only from the established HTTP-only cookie.
 * A body/query device ID is a concurrency assertion, never target selection.
 */
export async function communicationDeviceId() {
    const value = (await cookies()).get(PUSH_DEVICE_COOKIE)?.value
    return value && UUID_PATTERN.test(value) ? value : null
}

export function deviceReadError(error: { code?: string } | null) {
    if (error?.code === "P0002") return Response.json({ error: "This device is still being verified. Reopen Betelgeze to retry.", code: "device_not_ready" }, { status: 409 })
    if (error?.code === "42501") return Response.json({ error: "Conversation not found." }, { status: 404 })
    return Response.json({ error: "Could not save this device's read position." }, { status: 503 })
}
