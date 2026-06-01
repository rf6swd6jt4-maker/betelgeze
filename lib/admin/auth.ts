import { timingSafeEqual } from "crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getRequiredEnv } from "@/lib/env"

export const ADMIN_SESSION_COOKIE = "admin_session"
export const ADMIN_COOKIE_PATH = "/admin"

function constantTimeCompare(value: string, expected: string) {
    const expectedBuffer = Buffer.from(expected)
    const valueBuffer = Buffer.from(value)

    if (valueBuffer.length !== expectedBuffer.length) {
        timingSafeEqual(expectedBuffer, Buffer.alloc(expectedBuffer.length))
        return false
    }

    return timingSafeEqual(valueBuffer, expectedBuffer)
}

export function isValidAdminPassword(password: string) {
    return constantTimeCompare(password, getRequiredEnv("ADMIN_PASSWORD"))
}

export function getAdminSessionSecret() {
    return getRequiredEnv("ADMIN_SESSION_SECRET")
}

export async function requireAdmin() {
    const cookieStore = await cookies()
    const adminSession = cookieStore.get(ADMIN_SESSION_COOKIE)?.value

    if (!constantTimeCompare(adminSession ?? "", getAdminSessionSecret())) {
        redirect("/admin/login")
    }
}
