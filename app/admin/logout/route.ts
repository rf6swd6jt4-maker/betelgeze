import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { ADMIN_COOKIE_PATH, ADMIN_SESSION_COOKIE } from "@/lib/admin/auth"

export async function GET() {
    const cookieStore = await cookies()

    cookieStore.set(ADMIN_SESSION_COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: ADMIN_COOKIE_PATH,
        maxAge: 0,
    })

    redirect("/admin/login")
}
