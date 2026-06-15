import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES, getModuleKeysForServices } from "@/lib/onboarding/services"
import { splitProjectTimeframeDays } from "@/lib/onboarding/project-timeframe"
import { requireAdmin } from "@/lib/admin/auth"
import { displayMessageAddress } from "@/lib/client-messages/addresses"
import { updateClient } from "./actions"

type PageProps = {
    params: Promise<{
        id: string
    }>
    searchParams: Promise<{
        error?: string
    }>
}

export default async function EditClientPage({
    params,
    searchParams,
}: PageProps) {
    await requireAdmin()

    const { id } = await params
    const { error } = await searchParams

    const { data: client } = await supabaseAdmin
        .from("clients")
        .select("*")
        .eq("id", id)
        .single()

    if (!client) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
                <p>Client not found.</p>
            </main>
        )
    }

    const { data: serviceRows } = await supabaseAdmin
        .from("client_services")
        .select("service_key")
        .eq("client_id", client.id)

    const assignedServiceKeys =
        serviceRows?.map((row) => row.service_key) ?? []
    const assignedModuleKeys = getModuleKeysForServices(assignedServiceKeys)
    const projectTimeframe = splitProjectTimeframeDays(
        client.project_timeframe_days
    )

    return (
        <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
            <div className="mx-auto max-w-2xl">
                <Link
                    href={`/admin/client/${client.id}`}
                    className="text-sm text-neutral-400"
                >
                    ← Back to client
                </Link>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight">
                    Edit client
                </h1>

                <p className="mt-3 text-neutral-400">
                    Update client details and assigned services.
                </p>

                {error && (
                    <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        Name and phone are required.
                    </div>
                )}

                <form
                    action={async (formData) => {
                        "use server"
                        await updateClient(client.id, formData)
                    }}
                    className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6"
                >
                    <label className="block text-sm text-neutral-300">
                        Client name
                    </label>

                    <input
                        name="name"
                        type="text"
                        required
                        defaultValue={client.name ?? ""}
                        className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                    />

                    <label className="mt-6 block text-sm text-neutral-300">
                        Client WhatsApp number
                    </label>

                    <input
                        name="phone"
                        type="tel"
                        required
                        defaultValue={
                            client.phone
                                ? displayMessageAddress(client.phone)
                                : ""
                        }
                        className="mt-2 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                    />

                    <p className="mt-2 text-xs text-neutral-500">
                        Saved in international WhatsApp format. Formatting
                        marks, 00 prefixes, and Irish/UK trunk zeros are cleaned
                        automatically.
                    </p>

                    <label className="mt-6 block text-sm text-neutral-300">
                        Client email
                    </label>

                    <input
                        name="email"
                        type="email"
                        defaultValue={client.email ?? ""}
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
                            defaultValue={projectTimeframe.amount}
                            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                            placeholder="e.g. 30"
                        />

                        <select
                            name="project_timeframe_unit"
                            defaultValue={projectTimeframe.unit}
                            className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none"
                        >
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                            <option value="months">Months</option>
                        </select>
                    </div>

                    <p className="mt-2 text-xs text-neutral-500">
                        Fulfilment task deadlines are calculated from the date
                        the tasks are created. Weeks convert to days × 7;
                        months convert to days × 30.
                    </p>

                    <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                        <input
                            type="checkbox"
                            name="is_test"
                            defaultChecked={Boolean(client.is_test)}
                            className="mt-1"
                        />

                        <span>
                            <span className="block text-sm font-medium text-amber-100">
                                Test client
                            </span>

                            <span className="mt-1 block text-sm text-amber-100/70">
                                Shows a test label in admin and unlocks the
                                test menu in the onboarding portal.
                            </span>
                        </span>
                    </label>

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
                                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-4"
                                >
                                    <input
                                        type="checkbox"
                                        name="services"
                                        value={service.key}
                                        defaultChecked={assignedServiceKeys.includes(
                                            service.key
                                        )}
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
                                </label>
                            ))}
                        </div>

                        <p className="mt-3 text-xs text-neutral-500">
                            General Info is always assigned. If no services are
                            selected, the client only gets General Info.
                        </p>
                    </div>

                    <div className="mt-8">
                        <p className="text-sm font-medium text-neutral-300">
                            Derived onboarding modules
                        </p>

                        <p className="mt-2 text-sm text-neutral-500">
                            These are read-only here because they are calculated
                            from the selected services.
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                            {assignedModuleKeys.map((moduleKey) => (
                                <span
                                    key={moduleKey}
                                    className="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
                                >
                                    {MODULES[moduleKey]?.title ?? moduleKey}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                        <button className="rounded-xl bg-white px-5 py-4 text-sm font-medium text-black">
                            Save changes
                        </button>

                        <Link
                            href={`/admin/client/${client.id}`}
                            className="rounded-xl border border-neutral-700 px-5 py-4 text-center text-sm font-medium text-white"
                        >
                            Cancel
                        </Link>
                    </div>
                </form>
            </div>
        </main>
    )
}
