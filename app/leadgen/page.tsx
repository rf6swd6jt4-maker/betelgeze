import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { BrandLockup } from "@/components/brand/BrandLockup"

function leadgenReturnUrl(host: string | null) {
  const hostname = host?.split(":")[0]?.toLowerCase()
  if (hostname === "app.betelgeze.com" || hostname === "dashboard.betelgeze.com") {
    return `https://${hostname}/leadgen`
  }
  return "https://leadgen.betelgeze.com/"
}

function authReturnUrl(host: string | null, path: "/login", next: string) {
  const hostname = host?.split(":")[0]?.toLowerCase()
  if (hostname === "app.betelgeze.com") return `https://app.betelgeze.com${path}?next=${encodeURIComponent(next)}`
  return `https://auth.betelgeze.com${path}?next=${encodeURIComponent(next)}`
}

export default async function LeadgenIndexPage() {
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const leadgenUrl = leadgenReturnUrl(host)
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(authReturnUrl(host, "/login", leadgenUrl))

  const { data: memberships } = await supabaseAdmin
    .from("workspace_memberships")
    .select("workspaces!inner(name, slug, status)")
    .eq("user_id", user.id)

  const workspaces = (memberships ?? [])
    .map((membership) => membership.workspaces as unknown as { name: string; slug: string; status: string })
    .filter((workspace) => workspace.status === "active")

  if (workspaces.length === 1) redirect(`/leadgen/${workspaces[0].slug}`)

  return <main className="min-h-screen bg-neutral-950 px-6 py-16 text-white">
    <section className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-7 sm:p-8">
      <BrandLockup compact />
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">Leadgen</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Choose a workspace</h1>
      <p className="mt-3 text-sm leading-6 text-neutral-400">Leadgen is now organised under the same Betelgeze workspaces as your dashboard.</p>
      {workspaces.length ? <div className="mt-7 grid gap-2">
        {workspaces.map((workspace) => <a key={workspace.slug} href={`/leadgen/${workspace.slug}`} className="rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-100 hover:border-neutral-600">{workspace.name}</a>)}
      </div> : <div className="mt-7 rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm leading-6 text-neutral-400">You do not have an active workspace yet. Create or join a workspace from your Betelgeze dashboard first.</div>}
    </section>
  </main>
}
