import Link from "next/link"
import { requireAdmin } from "@/lib/admin/auth"
import { FormPendingOverlay } from "@/components/FormPendingOverlay"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { createClient } from "./actions"
export const dynamic = "force-dynamic"

type PageProps = {
    searchParams: Promise<{
        error?: string
        created?: string
    }>
}

export default async function NewClientPage({ searchParams }: PageProps) {
    const { workspace, user } = await requireAdmin()

    const { error, created } = await searchParams
    const errorMessage =
        error === "schema-missing"
            ? "The database is missing the sales automation migration. Apply the latest Supabase migrations, then try again."
            : error === "consent-template-failed"
              ? "The migration request was saved, but the WhatsApp consent template could not be sent. Check System health and try again."
                  : error
                    ? "Could not create client. Check that name, phone, and required fields are filled in."
                    : null

    const showSuccess = created === "consent-sent"

    return (
        <main className="min-h-screen bg-neutral-950 px-6 pb-10 text-white">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-2xl">
                <div className="flex items-center gap-4 text-sm text-neutral-400">
                    <Link href="/admin">← Back to clients</Link>
                    <Link href="/admin/invoices">Invoices</Link>
                </div>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight">
                    Add manual client
                </h1>

                <p className="mt-3 text-neutral-400">
                    Move an existing client into the shared WhatsApp and ClickUp
                    workspace without creating an invoice or onboarding portal.
                </p>

                <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
                    We will send the approved WhatsApp consent template first.
                    After they reply CONFIRM, the system creates their ClickUp
                    folder and chat channel. The onboarding list stays empty so
                    you can move their Notion information into Client Context.
                </div>

                {showSuccess && (
                    <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                        Consent template sent. ClickUp setup will begin when the
                        client replies CONFIRM.
                    </div>
                )}

                {errorMessage && (
                    <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {errorMessage}
                    </div>
                )}

                <form
                    action={createClient}
                    className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
                >
                    <FormPendingOverlay />

                    <label className="block text-sm text-neutral-300">
                        Client name
                    </label>

                    <input
                        name="name"
                        type="text"
                        required
                        className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                        placeholder="Example Client"
                    />

                    <label className="mt-6 block text-sm text-neutral-300">
                        Client WhatsApp number
                    </label>

                    <input
                        name="phone"
                        type="tel"
                        required
                        className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                        placeholder="+1 555 123 4567"
                    />

                    <p className="mt-2 text-xs text-neutral-500">
                        Use the mobile number they use for WhatsApp. Spaces,
                        brackets, hyphens, and international dialing prefixes
                        are cleaned automatically.
                    </p>

                    <label className="mt-6 block text-sm text-neutral-300">
                        Client email
                    </label>

                    <input
                        name="email"
                        type="email"
                        className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                        placeholder="client@example.com (optional)"
                    />

                    <button className="mt-8 w-full rounded-xl bg-white px-5 py-4 font-medium text-black">
                        Send WhatsApp consent request
                    </button>
                </form>
            </div>
        </main>
    )
}
