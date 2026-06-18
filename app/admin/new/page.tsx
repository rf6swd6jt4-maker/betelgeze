import Link from "next/link"
import { SERVICES } from "@/lib/onboarding/services"
import { requireAdmin } from "@/lib/admin/auth"
import { FormPendingOverlay } from "@/components/FormPendingOverlay"
import { createClient } from "./actions"
export const dynamic = "force-dynamic"

type PageProps = {
    searchParams: Promise<{
        error?: string
    }>
}

export default async function NewClientPage({ searchParams }: PageProps) {
    await requireAdmin()

    const { error } = await searchParams
    const errorMessage =
        error === "schema-missing"
            ? "The database is missing the latest client services/test client migration. Apply the Supabase migration, then try again."
            : error === "phone-schema-missing"
              ? "The database is missing the client phone column migration. Apply the Supabase migrations, then try again."
              : error === "modules-failed"
                ? "The client was created, but onboarding modules could not be assigned."
                : error === "services-failed"
                  ? "The client was created, but fulfilment services could not be saved. Check the client_services table migration."
                  : error
                    ? "Could not create client. Check that name, phone, and required fields are filled in."
                    : null

    return (
        <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
            <div className="mx-auto max-w-2xl">
                <div className="flex items-center gap-4 text-sm text-neutral-400">
                    <Link href="/admin">← Back to clients</Link>
                    <Link href="/admin/invoices">Invoices</Link>
                </div>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight">
                    Add manual client
                </h1>

                <p className="mt-3 text-neutral-400">
                    Create onboarding directly for exceptions, imports, or
                    clients who should not go through Stripe invoice automation.
                </p>

                <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
                    This bypasses Stripe invoices, WhatsApp consent templates,
                    and automatic payment-triggered setup. Use Create invoice
                    for the standard sales flow.
                </div>

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

                    <label className="mt-6 block text-sm text-neutral-300">
                        Project timeframe
                    </label>

                    <div className="mt-2 grid grid-cols-[1fr_auto] gap-3">
                        <input
                            name="project_timeframe_amount"
                            type="number"
                            min="1"
                            step="1"
                            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                            placeholder="e.g. 30"
                        />

                        <select
                            name="project_timeframe_unit"
                            defaultValue="days"
                            className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                        >
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                            <option value="months">Months</option>
                        </select>
                    </div>

                    <p className="mt-2 text-xs text-neutral-500">
                        Fulfilment task deadlines are calculated from the date
                        tasks are created. Weeks convert to days × 7; months
                        convert to days × 30.
                    </p>

                    <div className="mt-8">
                        <p className="text-sm font-medium text-neutral-300">
                            Services
                        </p>

                        <p className="mt-2 text-sm text-neutral-500">
                            Pick the services the client bought. Onboarding
                            modules are assigned automatically from this.
                        </p>

                        <div className="mt-4 space-y-3">
                            {Object.values(SERVICES).map((service) => (
                                <label
                                    key={service.key}
                                    className="block cursor-pointer rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                                >
                                    <span className="flex items-start gap-3">
                                        <input
                                            type="checkbox"
                                            name="services"
                                            value={service.key}
                                            className="mt-1"
                                        />

                                        <span>
                                            <span className="block font-medium">
                                                {service.title}
                                            </span>

                                            <span className="mt-1 block text-sm text-neutral-500">
                                                {service.description}
                                            </span>
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </div>

                        <p className="mt-3 text-xs text-neutral-500">
                            General Info is always assigned. If no services are
                            selected, the client only gets General Info.
                        </p>
                    </div>

                    <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                        <input
                            type="checkbox"
                            name="is_test"
                            className="mt-1"
                        />

                        <span>
                            <span className="block text-sm font-medium text-neutral-200">
                                Test client
                            </span>

                            <span className="mt-1 block text-sm text-neutral-500">
                                Shows a test label in admin and unlocks the
                                test menu in the onboarding portal.
                            </span>
                        </span>
                    </label>

                    <button className="mt-8 w-full rounded-xl bg-white px-5 py-4 font-medium text-black">
                        Create manual client
                    </button>
                </form>
            </div>
        </main>
    )
}
