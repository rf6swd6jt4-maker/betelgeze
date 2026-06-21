import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createWorkspace } from "../actions"

export default async function CreateDashboardPage({ params }: { params: Promise<{ username: string }> }) {
    const { username } = await params; const user = await getCurrentUser(); if (!user) redirect("/login")
    const { data: profile } = await supabaseAdmin.from("user_profiles").select("username").eq("user_id", user.id).maybeSingle(); if (!profile || profile.username !== username) redirect(`/users/${profile?.username ?? ""}`)
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form action={createWorkspace.bind(null, username)} className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><p className="text-sm text-neutral-400">Betelgeze account</p><h1 className="mt-3 text-2xl font-semibold">Create a dashboard</h1><p className="mt-3 text-sm text-neutral-400">You will become its owner.</p><label className="mt-6 block text-sm">Business name<input name="name" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm">Dashboard URL<input name="slug" required placeholder="your-business" className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><button className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black">Create dashboard</button><Link href={`/users/${username}`} className="mt-5 block text-sm underline">Back to profile</Link></form></main>
}
