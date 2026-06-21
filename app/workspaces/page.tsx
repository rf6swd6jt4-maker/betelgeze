import Link from "next/link"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function WorkspaceChooserPage() {
    const supabase = await createSupabaseServerClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) redirect("/login")
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (assurance?.currentLevel !== "aal2") redirect("/mfa")
    const { data: memberships } = await supabase
        .from("workspace_memberships")
        .select("role, workspaces!inner(name, slug, status)")
        .eq("user_id", userData.user.id)

    return (
        <main className="min-h-screen bg-neutral-950 px-6 py-16 text-white">
            <div className="mx-auto max-w-xl">
                <p className="text-sm text-neutral-400">Betelgeze</p>
                <h1 className="mt-3 text-3xl font-semibold">Choose a dashboard</h1>
                <div className="mt-8 space-y-3">
                    {(memberships ?? []).map((membership) => {
                        const workspace = membership.workspaces as unknown as {
                            name: string
                            slug: string
                            status: string
                        }
                        if (workspace.status !== "active") return null
                        return <Link key={workspace.slug} href={`/dashboard/${workspace.slug}`} className="block rounded-xl border border-neutral-800 bg-neutral-900 p-5 hover:border-neutral-600">{workspace.name}</Link>
                    })}
                </div>
                <Link href="/sign-up" className="mt-6 inline-block text-sm text-neutral-300 underline">Create another dashboard</Link>
            </div>
        </main>
    )
}
