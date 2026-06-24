import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"

const leadgenUrl = "https://leadgen.betelgeze.com/"

export default async function LeadgenResetPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`https://auth.betelgeze.com/login?next=${encodeURIComponent(leadgenUrl)}`)

  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (assurance?.currentLevel !== "aal2") {
    redirect(`https://auth.betelgeze.com/mfa?next=${encodeURIComponent(leadgenUrl)}`)
  }

  return <main className="min-h-screen bg-neutral-950 px-6 py-16 text-white">
    <section className="mx-auto max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-8 sm:p-12">
      <p className="text-xs font-semibold tracking-[0.18em] text-neutral-400">BETELGEZE / INTERNAL</p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Lead intelligence is being rebuilt.</h1>
      <p className="mt-5 max-w-xl text-base leading-7 text-neutral-300">The previous leadgen system has been retired from this domain while we rebuild it inside the main Betelgeze platform. No legacy source automation or lead data is exposed here.</p>
      <div className="mt-8 rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-sm leading-6 text-neutral-300">
        The next release will begin with evidence-backed research, review, and lead quality controls before any outreach automation.
      </div>
    </section>
  </main>
}
