import Link from "next/link"
import { redirect } from "next/navigation"
import { SecuritySettings } from "@/components/account/SecuritySettings"
import { AccountDevices } from "@/components/account/AccountDevices"
import { DeleteAccountForm } from "@/components/account/DeleteAccountForm"
import { deleteAccount } from "../actions"
import { Status } from "@/components/ui"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/workspaces"

export default async function AccountSecurityPage({ params }: { params: Promise<{ username: string }> }) {
    const { username } = await params
    const user = await getCurrentUser()
    if (!user?.email) return await redirectToLogin()
    const { data: profile } = await supabaseAdmin.from("user_profiles").select("username").eq("user_id", user.id).maybeSingle()
    if (!profile) return await redirectToLogin()
    if (profile.username !== username) redirect(`/users/${profile.username}/security`)
    const [factorResult, eventsResult] = await Promise.all([
        supabaseAdmin.auth.admin.mfa.listFactors({ userId: user.id }),
        supabaseAdmin.from("account_security_events").select("id, event_type, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
    ])
    const factors = (factorResult.data?.factors ?? []).filter((factor) => factor.status === "verified").map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name ?? "Authenticator", createdAt: factor.created_at }))
    return <main className="min-h-dvh bg-neutral-950 px-5 py-8 text-white sm:px-8"><div className="mx-auto max-w-3xl"><Link href={`/users/${profile.username}`} className="text-sm text-neutral-400 hover:text-white">← Back to profile</Link><div className="mt-7"><h1 className="text-3xl font-semibold">Security</h1><p className="mt-2 text-sm text-neutral-400">Manage your devices, notifications and account security.</p></div><div className="mt-7"><AccountDevices /><SecuritySettings email={user.email} initialFactors={factors} /></div>{(eventsResult.data ?? []).length ? <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-lg font-semibold">Recent security activity</h2><div className="mt-4 divide-y divide-neutral-800">{(eventsResult.data ?? []).map((event) => <div key={event.id} className="flex items-center justify-between gap-4 py-3"><Status label={event.event_type.replaceAll("_", " ")} tone="green" /><time className="text-xs text-neutral-500">{new Date(event.created_at).toLocaleString()}</time></div>)}</div></section> : null}<section className="mt-8 rounded-2xl border border-red-900/50 bg-red-950/20 p-5"><h2 className="font-semibold text-red-200">Delete account</h2><p className="mt-2 text-sm text-red-100/70">This permanently removes your Auth account, profile, and workspace memberships. It does not delete Stripe records.</p><DeleteAccountForm action={deleteAccount} /></section></div></main>
}
