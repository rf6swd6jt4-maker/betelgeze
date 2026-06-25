import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES } from "@/lib/onboarding/services"
import { requireWorkspaceMember } from "@/lib/admin/auth"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { isOnboardingStuck } from "@/lib/onboarding/stuck"
import { AdminActionsMenu } from "@/components/admin/AdminActionsMenu"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ListToolbar } from "@/components/admin/ListToolbar"
import { Avatar } from "@/components/account/Avatar"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { DashboardAutoRefresh } from "@/components/admin/DashboardAutoRefresh"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { removeClientFromList } from "./actions"
export const dynamic = "force-dynamic"

const BASE_STEPS = [
    {
        key: "welcome-video",
        title: "Welcome",
    },
]

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ sort?: string; filter?: string }> }) {
    const { workspace, user } = await requireWorkspaceMember()
    const { sort = "created-new", filter = "all" } = await searchParams

    const clientsResponse = await supabaseAdmin
        .from("clients")
        .select("id, name, email, phone, created_at, archived_at, is_test, created_by")
        .eq("workspace_id", workspace.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })

    let clients = clientsResponse.data
    let clientsError = clientsResponse.error

    if (clientsResponse.error?.message.toLowerCase().includes("phone")) {
        const fallbackClientsResponse = await supabaseAdmin
            .from("clients")
            .select("id, name, email, created_at, archived_at, is_test, created_by")
            .eq("workspace_id", workspace.id)
            .is("archived_at", null)
            .order("created_at", { ascending: false })

        clients =
            fallbackClientsResponse.data?.map((client) => ({
                ...client,
                phone: null,
            })) ?? null
        clientsError = fallbackClientsResponse.error
    }

    const clientIds = (clients ?? []).map((client) => client.id)
    const creatorIds = [...new Set((clients ?? []).map((client) => client.created_by).filter(Boolean))] as string[]
    const { data: clientCreators } = creatorIds.length > 0
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
        : { data: [] as Array<{ user_id: string; username: string; avatar_path: string | null }> }
    const clientCreatorById = new Map((clientCreators ?? []).map((creator) => [creator.user_id, creator]))
    const clientCreatorAvatarUrls = await createUploadSignedUrls((clientCreators ?? []).map((creator) => creator.avatar_path).filter((path): path is string => Boolean(path)))
    const [
        { data: progressRows, error: progressError },
        { data: moduleRows, error: modulesError },
        { data: serviceRows, error: servicesError },
        { data: communicationRows, error: communicationError },
    ] = await Promise.all([
        supabaseAdmin
            .from("client_progress")
            .select("client_id, step_key, completed_at, created_at")
            .in("client_id", clientIds),
        supabaseAdmin.from("client_modules").select("client_id, module_key").in("client_id", clientIds),
        supabaseAdmin.from("client_services").select("client_id, service_key").in("client_id", clientIds),
        supabaseAdmin
            .from("client_communication_channels")
            .select("client_id, clickup_channel_id, is_active")
            .in("client_id", clientIds),
    ])

    if (
        clientsError ||
        progressError ||
        modulesError ||
        servicesError ||
        communicationError
    ) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
                <p>Could not load admin dashboard.</p>
            </main>
        )
    }

    const progressByClient = new Map<string, string[]>()
    const activityByClient = new Map<string, string>()

    for (const row of progressRows ?? []) {
        const existing = progressByClient.get(row.client_id) ?? []
        existing.push(row.step_key)
        progressByClient.set(row.client_id, existing)

        const activityDate = row.completed_at ?? row.created_at
        const existingActivity = activityByClient.get(row.client_id)

        if (
            activityDate &&
            (!existingActivity ||
                new Date(activityDate) > new Date(existingActivity))
        ) {
            activityByClient.set(row.client_id, activityDate)
        }
    }

    const modulesByClient = new Map<string, string[]>()
    const servicesByClient = new Map<string, string[]>()
    const communicationByClient = new Map<
        string,
        { clickup_channel_id: string | null; is_active: boolean | null }
    >()

    for (const row of moduleRows ?? []) {
        const existing = modulesByClient.get(row.client_id) ?? []
        existing.push(row.module_key)
        modulesByClient.set(row.client_id, existing)
    }

    for (const row of serviceRows ?? []) {
        const existing = servicesByClient.get(row.client_id) ?? []
        existing.push(row.service_key)
        servicesByClient.set(row.client_id, existing)
    }

    for (const row of communicationRows ?? []) {
        communicationByClient.set(row.client_id, {
            clickup_channel_id: row.clickup_channel_id,
            is_active: row.is_active,
        })
    }

    const clientSummaries = (clients ?? []).map((client) => {
        const completedKeys = progressByClient.get(client.id) ?? []
        const assignedModuleKeys = modulesByClient.get(client.id) ?? []
        const assignedServiceKeys = servicesByClient.get(client.id) ?? []
        const communication = communicationByClient.get(client.id) ?? null

        const moduleSteps = assignedModuleKeys.flatMap((moduleKey) => {
            const moduleDefinition = MODULES[moduleKey]

            if (!moduleDefinition) return []

            return moduleDefinition.steps.map((step) => ({
                ...step,
                moduleTitle: moduleDefinition.title,
            }))
        })

        const completableSteps = [...BASE_STEPS, ...moduleSteps]

        const percentage = getProgressPercentage(
            completableSteps,
            completedKeys
        )

        const currentStep =
            completableSteps.find((step) => !completedKeys.includes(step.key)) ??
            {
                key: "final",
                title: "Complete",
                moduleTitle: "General",
            }

        const lastActivity = activityByClient.get(client.id)
        const stuck = isOnboardingStuck({
            percentage,
            createdAt: client.created_at,
            lastActivityAt: lastActivity,
        })

        return {
            client,
            assignedModuleKeys,
            assignedServiceKeys,
            percentage,
            currentStep,
            lastActivity,
            communication,
            stuck,
        }
    })
    const totalClients = clientSummaries.length
    const completedClients = clientSummaries.filter(
        ({ percentage }) => percentage === 100
    ).length
    const activeClients = totalClients - completedClients
    const matchesClientFilter = (summary: (typeof clientSummaries)[number]) => {
        if (filter === "all") return true
        if (filter === "stuck") return summary.stuck
        if (filter === "test") return Boolean(summary.client.is_test)
        if (filter.startsWith("creator:")) return summary.client.created_by === filter.slice("creator:".length)
        if (filter.startsWith("service:")) return summary.assignedServiceKeys.includes(filter.slice("service:".length))
        return true
    }
    const sortedClientSummaries = clientSummaries
        .map((summary) => ({ ...summary, isFilterMatch: matchesClientFilter(summary) }))
        .sort((left, right) => {
            const time = (value: string | null | undefined) => value ? new Date(value).getTime() : 0
            if (left.isFilterMatch !== right.isFilterMatch) return left.isFilterMatch ? -1 : 1
            if (sort === "name-az") return (left.client.name ?? "").localeCompare(right.client.name ?? "")
            if (sort === "progress-low") return left.percentage - right.percentage
            if (sort === "progress-high") return right.percentage - left.percentage
            if (sort === "created-old") return time(left.client.created_at) - time(right.client.created_at)
            if (sort === "activity-recent") return time(right.lastActivity) - time(left.lastActivity)
            return time(right.client.created_at) - time(left.client.created_at)
        })
    const toolbarCreators = (clientCreators ?? []).map((creator) => ({ value: `creator:${creator.user_id}`, label: `@${creator.username}`, avatarSrc: creator.avatar_path ? clientCreatorAvatarUrls.get(creator.avatar_path) ?? null : null }))
    const toolbarServices = [...new Set(clientSummaries.flatMap((summary) => summary.assignedServiceKeys))].map((serviceKey) => ({ value: `service:${serviceKey}`, label: SERVICES[serviceKey]?.title ?? serviceKey }))

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
            <div className="mx-auto max-w-7xl">
                <DashboardAutoRefresh />
                <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {workspace.name}
                        </h1>

                        <p className="mt-2 text-sm text-neutral-400">
                            Track client onboarding progress, modules, and
                            activity from one place.
                        </p>
                    </div>

                    <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <Link
                            href="/admin/sales/new"
                            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3"
                        >
                            Create invoice
                        </Link>

                        <AdminActionsMenu />
                    </div>
                </div>

                <div className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                    <Link
                        href="/admin"
                        className="shrink-0 rounded-lg bg-white px-3 py-2.5 font-medium text-black sm:py-2"
                    >
                        Clients
                    </Link>
                    <Link
                        href="/admin/invoices"
                        className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2"
                    >
                        Invoices
                    </Link>
                    <Link
                        href="/admin/health"
                        className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2"
                    >
                        System health
                    </Link>
                    <Link
                        href={`/dashboard/${workspace.slug}/settings`}
                        className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2"
                    >
                        Settings
                    </Link>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {[
                        ["Clients", totalClients],
                        ["Active", activeClients],
                        ["Complete", completedClients],
                    ].map(([label, value]) => (
                        <div
                            key={label}
                            className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
                        >
                            <p className="text-xs text-neutral-500">
                                {label}
                            </p>
                            <p className="mt-1 text-lg font-semibold">
                                {value}
                            </p>
                        </div>
                    ))}
                </div>

                <ListToolbar sortOptions={[{ value: "created-new", label: "Date added: newest" }, { value: "created-old", label: "Date added: oldest" }, { value: "name-az", label: "Client name: A–Z" }, { value: "progress-low", label: "Progress: low to high" }, { value: "progress-high", label: "Progress: high to low" }, { value: "activity-recent", label: "Last activity: recent" }]} filterGroups={[{ label: "Status", options: [{ value: "stuck", label: "Stuck" }, { value: "test", label: "Test client" }] }, { label: "Added by", options: toolbarCreators }, { label: "Services", options: toolbarServices }]} />

                <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                    {sortedClientSummaries.map(({ client, assignedServiceKeys, percentage, lastActivity, stuck, isFilterMatch }) => {
                        const creator = client.created_by ? clientCreatorById.get(client.created_by) : null
                        const creatorAvatar = creator?.avatar_path ? clientCreatorAvatarUrls.get(creator.avatar_path) : null
                        return <div key={client.id} className={`grid min-h-16 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-neutral-900 px-4 py-3 last:border-0 md:grid-cols-[minmax(230px,1.3fr)_170px_minmax(220px,1fr)_130px_120px_32px] md:items-center ${isFilterMatch ? "" : "opacity-35"} ${stuck ? "bg-red-950/[0.08]" : ""}`}>
                            <div className="min-w-0">
                                <Link href={`/admin/client/${client.id}`} className="truncate text-sm font-medium text-neutral-100 underline-offset-4 hover:underline">{client.name ?? "Unnamed client"}</Link>
                                <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-neutral-500">
                                    {creator ? <Avatar src={creatorAvatar} name={creator.username} className="h-5 w-5 shrink-0" /> : null}
                                    <span className="truncate">{creator ? `Added by @${creator.username}` : "Legacy client"}</span>
                                    {client.is_test && <span className="rounded-md border border-amber-400/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">Test</span>}
                                </div>
                            </div>
                            <span className={`inline-flex items-center gap-2 text-sm ${stuck ? "text-red-200" : percentage === 100 ? "text-emerald-200" : "text-yellow-200"}`}><span className={`h-2 w-2 rotate-45 ${stuck ? "bg-red-300" : percentage === 100 ? "bg-emerald-300" : "bg-yellow-300"}`} />{stuck ? "Stuck" : percentage === 100 ? "Complete" : "Active"} · {percentage}%</span>
                            <p className="truncate text-sm text-neutral-400">{assignedServiceKeys.length ? assignedServiceKeys.map((serviceKey) => SERVICES[serviceKey]?.title ?? serviceKey).join(", ") : "No services"}</p>
                            <p className="font-mono text-xs text-neutral-500">{shortId(client.id)}</p>
                            <p className="whitespace-nowrap text-xs text-neutral-500">{formatRelativeTime(lastActivity ?? client.created_at)}</p>
                            <ListActionMenu actions={[
                                { label: "Open client", href: `/admin/client/${client.id}` },
                                { label: "Remove", action: removeClientFromList.bind(null, client.id), danger: true, confirmMessage: "Remove this client from the dashboard? This archives the client instead of hard-deleting their records." },
                            ]} />
                        </div>
                    })}
                </section>

                <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
            </div>
        </main>
    )
}
