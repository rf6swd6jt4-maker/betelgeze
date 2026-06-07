import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
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

    const { data: moduleRows } = await supabaseAdmin
        .from("client_modules")
        .select("module_key")
        .eq("client_id", client.id)

    const assignedModuleKeys = moduleRows?.map((row) => row.module_key) ?? []

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
                    Update client details and assigned onboarding modules.
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

                    <div className="mt-8">
                        <p className="text-sm font-medium text-neutral-300">
                            Assigned modules
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
                                        defaultChecked={assignedModuleKeys.includes(
                                            module.key
                                        )}
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
