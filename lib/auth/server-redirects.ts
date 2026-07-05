import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { isSafeRelativePath } from "@/lib/auth/redirects"

export async function currentRequestPath() {
    const requestHeaders = await headers()
    const path = requestHeaders.get("x-betelgeze-current-path")
    return isSafeRelativePath(path) ? path! : "/"
}

export async function redirectToLogin(): Promise<never> {
    redirect(`/login?next=${encodeURIComponent(await currentRequestPath())}`)
}

export async function redirectToMfa(): Promise<never> {
    redirect(`/mfa?next=${encodeURIComponent(await currentRequestPath())}`)
}
