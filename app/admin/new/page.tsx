import Link from "next/link"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES } from "@/lib/onboarding/services"
import { requireAdmin } from "@/lib/admin/auth"
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

    return (
        <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
            <div className="mx-auto max-w-2xl">
                <Link href="/admin" className="text-sm text-neutral-400">
                    ← Back to dashboard
                </Link>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight">
                    Add client
                </h1>

                <p className="mt-3 text-neutral-400">
                    Create a manual onboarding session for development, testing,
                    or custom-proposal clients.
                </p>

                {error && (
                    <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        Could not create client. Check that name, phone, and at
                        least one service are filled in.
                    </div>
                )}

                <form
                    action={createClient}
                    className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
                >
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
                        brackets, hyphens, 00 prefixes, and Irish/UK trunk
                        zeros are cleaned automatically.
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

                    <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                        <input
                            type="checkbox"
                            name="is_test"
                            className="mt-1"
                        />

                        <span>
                            <span className="block text-sm font-medium text-amber-100">
                                Test client
                            </span>

                            <span className="mt-1 block text-sm text-amber-100/70">
                                Shows a test label in admin and unlocks
                                step-jumping in the onboarding portal.
                            </span>
                        </span>
                    </label>

                    <div className="mt-8">
                        <p className="text-sm font-medium text-neutral-300">
                            Services / modules
                        </p>

                        <div className="mt-4 space-y-3">
                            {Object.values(MODULES).map((module) => (
                                <label
                                    key={module.key}
                                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                                >
                                    <input
                                        type="checkbox"
                                        name="modules"
                                        value={module.key}
                                        className="mt-1"
                                    />

                                    <span>
                                        <span className="block font-medium">
                                            {module.title}
                                        </span>

                                        <span className="mt-1 block text-sm text-neutral-500">
                                            {module.steps.length} onboarding
                                            steps
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="mt-8">
                        <p className="text-sm font-medium text-neutral-300">
                            Fulfilment services
                        </p>

                        <p className="mt-2 text-sm text-neutral-500">
                            These become employee-facing tasks in Client Work
                            when onboarding is complete.
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

                                    <span className="mt-4 block text-sm text-neutral-300">
                                        Due date
                                    </span>

                                    <input
                                        type="date"
                                        name={`service_due_date:${service.key}`}
                                        className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none"
                                    />
                                </label>
                            ))}
                        </div>
                    </div>

                    <button className="mt-8 w-full rounded-xl bg-white px-5 py-4 font-medium text-black">
                        Create client
                    </button>
                </form>
            </div>
        </main>
    )
}
