import Link from "next/link"
import { SERVICES } from "@/lib/onboarding/services"
import { requireAdmin } from "@/lib/admin/auth"
import { FormPendingOverlay } from "@/components/FormPendingOverlay"
import { createSaleInvoice } from "./actions"

export const dynamic = "force-dynamic"

type PageProps = {
    searchParams: Promise<{
        error?: string
    }>
}

const currency = process.env.STRIPE_DEFAULT_CURRENCY ?? "usd"

export default async function NewSalePage({ searchParams }: PageProps) {
    await requireAdmin()

    const { error } = await searchParams
    const errorMessage =
        error === "schema-missing"
            ? "The database is missing the Stripe sales automation migration."
            : error === "stripe-failed"
              ? "Stripe could not create or send the invoice. Check Stripe environment variables and the timeline/logs."
              : error === "missing-fields"
                ? "Add a name, email, WhatsApp number, and at least one service amount."
                : error === "amount-too-low"
                  ? "Stripe requires live USD invoices to be at least $0.50. Use $1.00 for a simple live test, or use test automation without Stripe."
                  : error
                    ? "Could not create invoice."
                    : null

    return (
        <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
            <div className="mx-auto max-w-2xl">
                <Link href="/admin" className="text-sm text-neutral-400">
                    ← Back to dashboard
                </Link>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight">
                    Create Stripe invoice
                </h1>

                <p className="mt-3 text-neutral-400">
                    Send a Stripe invoice now. When it is paid, the system sends
                    the approved WhatsApp confirmation template. After the
                    client replies CONFIRM, onboarding and ClickUp setup begin.
                </p>

                {errorMessage && (
                    <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {errorMessage}
                    </div>
                )}

                <form
                    action={createSaleInvoice}
                    className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
                >
                    <FormPendingOverlay />

                    <label className="block text-sm text-neutral-300">
                        Client name
                    </label>
                    <input
                        name="name"
                        required
                        className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                    />

                    <label className="mt-6 block text-sm text-neutral-300">
                        Client email for Stripe invoice
                    </label>
                    <input
                        name="email"
                        type="email"
                        required
                        className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                    />

                    <label className="mt-6 block text-sm text-neutral-300">
                        Client WhatsApp number
                    </label>
                    <input
                        name="phone"
                        type="tel"
                        required
                        placeholder="+353..."
                        className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
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

                    <input type="hidden" name="currency" value={currency} />

                    <label className="mt-8 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                        <input
                            type="checkbox"
                            name="is_test_automation"
                            className="mt-1"
                        />

                        <span>
                            <span className="block text-sm font-medium text-amber-100">
                                Test automation without Stripe
                            </span>

                            <span className="mt-1 block text-sm text-amber-100/70">
                                Skips Stripe invoice creation and immediately
                                sends the approved WhatsApp confirmation
                                template. Use this to test CONFIRM, onboarding
                                client creation, ClickUp setup, and onboarding
                                link delivery without taking payment.
                            </span>
                        </span>
                    </label>

                    <div className="mt-8">
                        <p className="text-sm font-medium text-neutral-300">
                            Services and invoice amounts
                        </p>
                        <p className="mt-2 text-sm text-neutral-500">
                            Tick each bought service and enter the amount to
                            show as its Stripe invoice line item. Amounts may
                            be left at 0 only when using test automation.
                        </p>

                        <div className="mt-4 space-y-3">
                            {Object.values(SERVICES).map((service) => (
                                <label
                                    key={service.key}
                                    className="block rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                                >
                                    <span className="flex items-start gap-3">
                                        <input
                                            type="checkbox"
                                            name="services"
                                            value={service.key}
                                            className="mt-1"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-medium">
                                                {service.title}
                                            </span>
                                            <span className="mt-1 block text-sm text-neutral-500">
                                                {service.description}
                                            </span>
                                            <span className="mt-3 flex items-center gap-2">
                                                <span className="text-xs uppercase text-neutral-500">
                                                    {currency}
                                                </span>
                                                <input
                                                    name={`amount_${service.key}`}
                                                    inputMode="decimal"
                                                    placeholder="0.00"
                                                    className="w-40 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white outline-none"
                                                />
                                            </span>
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <button className="mt-8 w-full rounded-xl bg-white px-5 py-4 font-medium text-black">
                        Create and send Stripe invoice
                    </button>
                </form>
            </div>
        </main>
    )
}
