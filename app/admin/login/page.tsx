import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import {
    ADMIN_COOKIE_PATH,
    ADMIN_SESSION_COOKIE,
    LEGACY_ADMIN_COOKIE_PATH,
    getAdminSessionSecret,
    isValidAdminPassword,
} from "@/lib/admin/auth"
export const dynamic = "force-dynamic"

async function login(formData: FormData) {
    "use server"

    const password = String(formData.get("password") ?? "")

    if (!isValidAdminPassword(password)) {
        redirect("/admin/login?error=1")
    }

    const cookieStore = await cookies()

    cookieStore.set(ADMIN_SESSION_COOKIE, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: LEGACY_ADMIN_COOKIE_PATH,
        maxAge: 0,
    })

    cookieStore.set(ADMIN_SESSION_COOKIE, getAdminSessionSecret(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: ADMIN_COOKIE_PATH,
        maxAge: 60 * 60 * 24 * 7,
    })

    redirect("/admin")
}

type PageProps = {
    searchParams: Promise<{
        error?: string
    }>
}

export default async function AdminLoginPage({ searchParams }: PageProps) {
    const { error } = await searchParams

    return (
        <main className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-6">
            <form
                action={login}
                className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
            >
                <p className="text-sm text-neutral-400">Agency Onboarding</p>

                <h1 className="mt-3 text-2xl font-semibold">Admin login</h1>

                <label className="mt-6 block text-sm text-neutral-300">
                    Password
                </label>

                <input
                    name="password"
                    type="password"
                    className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                    required
                />

                {error && (
                    <p className="mt-3 text-sm text-red-400">
                        Incorrect password.
                    </p>
                )}

                <button className="mt-6 w-full rounded-xl bg-white px-5 py-3 font-medium text-black">
                    Log in
                </button>
            </form>
        </main>
    )
}
