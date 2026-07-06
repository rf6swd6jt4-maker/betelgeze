import Link from "next/link"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES } from "@/lib/onboarding/services"
import { requireWorkspaceMember } from "@/lib/admin/auth"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { isOnboardingStuck } from "@/lib/onboarding/stuck"
import { displayMessageAddress } from "@/lib/client-messages/addresses"
import { AdminActionsMenu } from "@/components/admin/AdminActionsMenu"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ListToolbar } from "@/components/admin/ListToolbar"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { DashboardAutoRefresh } from "@/components/admin/DashboardAutoRefresh"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorAvatar } from "@/components/list/ListCreatorAvatar"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { MobileCardActionSurface } from "@/components/list/MobileCardActionSurface"
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
        if (filter === "not-started") return !summary.stuck && summary.percentage === 0
        if (filter === "active") return !summary.stuck && summary.percentage > 0 && summary.percentage < 100
        if (filter === "complete") return !summary.stuck && summary.percentage === 100
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
    const getClientStatus = ({ percentage, stuck }: { percentage: number; stuck: boolean }) => {
        if (stuck) return { label: "Stuck", text: "text-red-200", mark: "bg-red-300" }
        if (percentage === 0) return { label: "Not started", text: "text-neutral-300", mark: "bg-neutral-500" }
        if (percentage === 100) return { label: "Complete", text: "text-emerald-200", mark: "bg-emerald-300" }
        return { label: "Active", text: "text-yellow-200", mark: "bg-yellow-300" }
    }

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

                <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:grid-cols-3">
                    {[
                        ["Clients", totalClients],
                        ["Active", activeClients],
                        ["Complete", completedClients],
                    ].map(([label, value]) => (
                        <div
                            key={label}
                            className="border-r border-neutral-800 px-2 py-2 text-center last:border-r-0 sm:rounded-lg sm:border sm:border-neutral-800 sm:bg-neutral-900 sm:px-3 sm:text-left"
                        >
                            <p className="text-[10px] leading-tight text-neutral-500 sm:text-xs">
                                {label}
                            </p>
                            <p className="mt-1 text-lg font-semibold sm:text-left">
                                {value}
                            </p>
                        </div>
                    ))}
                </div>

                <ListToolbar sortOptions={[{ value: "created-new", label: "Date added: newest" }, { value: "created-old", label: "Date added: oldest" }, { value: "name-az", label: "Client name: A–Z" }, { value: "progress-low", label: "Progress: low to high" }, { value: "progress-high", label: "Progress: high to low" }, { value: "activity-recent", label: "Last activity: recent" }]} filterGroups={[{ label: "Status", options: [{ value: "active", label: "Active" }, { value: "not-started", label: "Not started" }, { value: "complete", label: "Complete" }, { value: "stuck", label: "Stuck" }, { value: "test", label: "Test client" }] }, { label: "Added by", options: toolbarCreators }, { label: "Services", options: toolbarServices }]} />

                <section className="mt-5 space-y-3 2xl:space-y-0 2xl:rounded-2xl 2xl:border 2xl:border-neutral-800 2xl:bg-black">
                    {sortedClientSummaries.map(({ client, assignedServiceKeys, percentage, lastActivity, stuck, isFilterMatch }) => {
                        const creator = client.created_by ? clientCreatorById.get(client.created_by) : null
                        const creatorAvatar = creator?.avatar_path ? clientCreatorAvatarUrls.get(creator.avatar_path) : null
                        const status = getClientStatus({ percentage, stuck })
                        const servicePills = assignedServiceKeys.length ? assignedServiceKeys.map((serviceKey) => (
                            <span key={serviceKey} className="rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                                {SERVICES[serviceKey]?.title ?? serviceKey}
                            </span>
                        )) : <span className="text-sm text-neutral-500">No services</span>
                        const mobileServicePills = assignedServiceKeys.length ? <>
                            {assignedServiceKeys.slice(0, 2).map((serviceKey) => (
                                <span key={serviceKey} className="max-w-[9rem] truncate rounded-md bg-blue-500/10 px-2 py-0.5 text-xs text-blue-200">
                                    {SERVICES[serviceKey]?.title ?? serviceKey}
                                </span>
                            ))}
                            {assignedServiceKeys.length > 2 && <span className="rounded-md border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400">+{assignedServiceKeys.length - 2}</span>}
                        </> : <span className="text-sm text-neutral-500">No services</span>
                        const clientActions = [
                            { label: "Open client", href: `/admin/client/${client.id}` },
                            { label: "Remove", action: removeClientFromList.bind(null, client.id), danger: true, confirmMessage: "Remove this client from the dashboard? This archives the client instead of hard-deleting their records." },
                        ]
                        return <div key={client.id} className={`${isFilterMatch ? "" : "opacity-35"} 2xl:border-b 2xl:border-neutral-900 2xl:last:border-0`}>
                            <MobileCardActionSurface actions={clientActions} className={`rounded-2xl border border-neutral-800 bg-black 2xl:hidden ${stuck ? "bg-red-950/[0.08]" : ""}`}>
                                <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-neutral-900 bg-neutral-900/35 px-3.5 py-2.5">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <Link href={`/admin/client/${client.id}`} className="truncate text-base font-medium text-neutral-100 underline underline-offset-4">{client.name ?? "Unnamed client"}</Link>
                                        {client.is_test && <span className="shrink-0 rounded-md border border-amber-400/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">Test</span>}
                                    </div>
                                    <span className={`inline-flex shrink-0 items-center gap-2 text-sm ${status.text}`}><span className={`h-2 w-2 rotate-45 ${status.mark}`} />{status.label}</span>
                                </div>
                                <div className="flex items-center gap-2 border-b border-neutral-900 px-3.5 py-2">
                                    <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                                        {mobileServicePills}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-neutral-800">
                                            <div className="h-full rounded-full bg-white" style={{ width: `${percentage}%` }} />
                                        </div>
                                        <span className="text-sm text-neutral-300">{percentage}%</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 px-3.5 py-2">
                                    <p className="min-w-0 flex-1 truncate text-sm text-neutral-400">{client.phone ? displayMessageAddress(client.phone) : client.email || "No contact saved"}</p>
                                    <p className="font-mono text-sm text-neutral-500">{shortId(client.id)}</p>
                                    <p className="whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(lastActivity ?? client.created_at)}</p>
                                    <ListCreatorAvatar src={creatorAvatar} username={creator?.username ?? null} className="h-7 w-7 shrink-0" />
                                </div>
                            </MobileCardActionSurface>
                            <div className={`hidden min-h-14 gap-3 px-4 py-2.5 2xl:grid 2xl:grid-cols-[minmax(170px,0.9fr)_76px_120px_145px_minmax(190px,1.05fr)_145px_105px_120px_32px] 2xl:items-center ${stuck ? "bg-red-950/[0.08]" : ""}`}>
                            <div className="min-w-0">
                                <Link href={`/admin/client/${client.id}`} className="truncate text-base font-medium text-neutral-100 underline-offset-4 hover:underline">{client.name ?? "Unnamed client"}</Link>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {client.is_test && <span className="rounded-md border border-amber-400/30 px-2 py-1 text-[11px] uppercase tracking-wide text-amber-200">Test</span>}
                            </div>
                            <span className={`inline-flex items-center gap-2 text-sm ${status.text}`}><span className={`h-2 w-2 rotate-45 ${status.mark}`} />{status.label}</span>
                            <p className="truncate text-sm text-neutral-400">{client.phone ? displayMessageAddress(client.phone) : client.email || "No contact saved"}</p>
                            <div className="flex flex-wrap gap-2">
                                {servicePills}
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-4">
                                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-800">
                                        <div className="h-full rounded-full bg-white" style={{ width: `${percentage}%` }} />
                                    </div>
                                    <span className="text-sm text-neutral-300">{percentage}%</span>
                                </div>
                            </div>
                            <p className="font-mono text-sm text-neutral-500">{shortId(client.id)}</p>
                            <div className="flex items-center justify-end gap-3">
                                <p className="whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(lastActivity ?? client.created_at)}</p>
                                <ListCreatorBadge src={creatorAvatar} username={creator?.username ?? null} label="Added by" date={new Date(client.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                            </div>
                            <ListActionMenu actions={clientActions} />
                        </div>
                        </div>
                    })}
                </section>

                <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
            </div>
        </main>
    )
}
