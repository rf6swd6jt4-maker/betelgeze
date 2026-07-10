import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import { MODULES } from "@/lib/onboarding/modules"
import { SERVICES } from "@/lib/onboarding/services"
import {
    assetHref,
    getRelationship,
    relationshipHubHref,
    workItemHref,
} from "@/lib/relationships"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

function metadataValue(metadata: unknown, key: string) {
    return metadata && typeof metadata === "object" && key in metadata
        ? String((metadata as Record<string, unknown>)[key] ?? "")
        : ""
}

function statusTone(status: string) {
    if (status === "done") return "border-green-500/30 bg-green-950/20 text-green-100"
    if (status === "blocked") return "border-red-500/30 bg-red-950/20 text-red-100"
    if (status === "waiting") return "border-amber-500/30 bg-amber-950/20 text-amber-100"
    if (status === "canceled") return "border-neutral-700 bg-neutral-900 text-neutral-500"
    return "border-neutral-700 bg-neutral-900 text-neutral-200"
}

export default async function OnboardingDetailPage({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()

    const [
        { data: session },
        { data: modules },
        { data: services },
    ] = await Promise.all([
        supabaseAdmin
            .from("relationship_onboarding_sessions")
            .select("id, session_token, status, is_test, created_at, updated_at, completed_at")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .in("status", ["active", "completed"])
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabaseAdmin
            .from("relationship_onboarding_modules")
            .select("module_key")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .order("created_at", { ascending: true }),
        supabaseAdmin
            .from("relationship_services")
            .select("service_key, due_date")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .order("created_at", { ascending: true }),
    ])

    const [{ data: workItems }, { data: assets }] = session
        ? await Promise.all([
            supabaseAdmin
                .from("work_items")
                .select("id, title, description, status, sort_order, metadata, updated_at, created_at")
                .eq("workspace_id", workspace.id)
                .eq("native_kind", "onboarding_step")
                .like("native_key", `${session.id}:%`)
                .order("sort_order", { ascending: true }),
            supabaseAdmin
                .from("assets")
                .select("id, title, asset_kind, native_kind, metadata, updated_at, created_at")
                .eq("workspace_id", workspace.id)
                .in("native_kind", ["onboarding_form_submission", "onboarding_upload"])
                .like("native_key", `${session.id}:%`)
                .order("updated_at", { ascending: false }),
        ])
        : [{ data: [] }, { data: [] }]

    const completedKeys = (workItems ?? []).filter((item) => item.status === "done").map((item) => item.id)
    const percentage = getProgressPercentage((workItems ?? []).map((item) => ({ key: item.id })), completedKeys)
    const assetsByStep = new Map<string, NonNullable<typeof assets>>()
    for (const asset of assets ?? []) {
        const stepKey = metadataValue(asset.metadata, "step_key")
        assetsByStep.set(stepKey, [...(assetsByStep.get(stepKey) ?? []), asset])
    }
    const onboardingUrl = session ? `/onboarding/session/${session.session_token}` : null
    const canManage = role === "owner" || role === "admin"

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <header className="border-b border-neutral-800 pb-6">
                            <p className="text-sm text-neutral-500">Onboarding detail</p>
                            <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                                <div>
                                    <h1 className="text-3xl font-semibold tracking-tight">{relationship.primary_person_name}</h1>
                                    <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
                                        {relationship.business_name ?? relationship.primary_email ?? relationship.primary_phone ?? "No company context saved"}
                                    </p>
                                </div>
                                <Link href={relationshipHubHref(workspace.slug, relationship.id)} className="inline-flex min-h-10 items-center rounded-lg border border-neutral-800 px-3 text-sm text-neutral-300 hover:text-white">
                                    Relationship summary
                                </Link>
                            </div>
                        </header>

                <section className="mt-6 grid gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Progress</p>
                        <p className="mt-2 text-2xl font-semibold">{percentage}%</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Steps</p>
                        <p className="mt-2 font-medium">{completedKeys.length} done · {Math.max(0, (workItems ?? []).length - completedKeys.length)} missing</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Session</p>
                        <p className="mt-2 font-medium capitalize">{session?.status ?? "Not started"}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Assets</p>
                        <p className="mt-2 font-medium">{assets?.length ?? 0} linked</p>
                    </div>
                </section>

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                        <div>
                            <h2 className="text-lg font-semibold">Onboarding link</h2>
                            <p className="mt-1 text-sm text-neutral-500">The client-facing canonical session link for this relationship.</p>
                        </div>
                        {onboardingUrl ? (
                            <a href={onboardingUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-black">
                                Open session
                            </a>
                        ) : (
                            <span className="text-sm text-neutral-500">No active session</span>
                        )}
                    </div>
                    {canManage ? (
                        <p className="mt-4 text-xs text-neutral-500">
                            Owner/admin restart and module editing controls will be added in the focused onboarding management pass.
                        </p>
                    ) : null}
                </section>

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black">
                        <div className="border-b border-neutral-900 px-5 py-4">
                            <h2 className="text-lg font-semibold">Step timeline</h2>
                            <p className="mt-1 text-sm text-neutral-500">Open a step to inspect its work item, submission, and uploaded assets.</p>
                        </div>
                        <div className="divide-y divide-neutral-900">
                            {(workItems ?? []).length ? (workItems ?? []).map((item) => {
                                const stepKey = metadataValue(item.metadata, "step_key")
                                const stepAssets = assetsByStep.get(stepKey) ?? []
                                return (
                                    <Link key={item.id} href={workItemHref(workspace.slug, item.id)} className="grid gap-3 px-5 py-4 hover:bg-neutral-900/60 sm:grid-cols-[1fr_120px_160px] sm:items-center">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium text-neutral-100">{item.title}</p>
                                            <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{item.description ?? stepKey.replace(/-/g, " ")}</p>
                                        </div>
                                        <span className={`w-fit rounded-full border px-2.5 py-1 text-xs capitalize ${statusTone(item.status)}`}>
                                            {item.status}
                                        </span>
                                        <p className="text-sm text-neutral-500 sm:text-right">
                                            {stepAssets.length} assets · {formatRelativeTime(item.updated_at ?? item.created_at)}
                                        </p>
                                    </Link>
                                )
                            }) : (
                                <div className="px-5 py-6">
                                    <p className="font-medium text-neutral-100">No onboarding steps generated yet.</p>
                                    <p className="mt-2 text-sm leading-6 text-neutral-500">Start onboarding from the relationship page to generate the client-facing session and step work items.</p>
                                </div>
                            )}
                        </div>
                </section>

                <section className="mt-6 grid gap-4 lg:grid-cols-3">
                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                        <h2 className="font-semibold">Modules</h2>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {(modules ?? []).length ? (modules ?? []).map((module) => (
                                <span key={module.module_key} className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300">
                                    {MODULES[module.module_key]?.title ?? module.module_key}
                                </span>
                            )) : <p className="text-sm text-neutral-500">No modules assigned.</p>}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                        <h2 className="font-semibold">Services</h2>
                        <div className="mt-3 space-y-2">
                            {(services ?? []).length ? (services ?? []).map((service) => (
                                <div key={service.service_key} className="rounded-lg border border-neutral-800 px-3 py-2 text-sm">
                                    <p className="text-neutral-100">{SERVICES[service.service_key]?.title ?? service.service_key}</p>
                                    <p className="mt-1 text-neutral-500">{service.due_date ? `Due ${service.due_date}` : "No due date"}</p>
                                </div>
                            )) : <p className="text-sm text-neutral-500">No services assigned.</p>}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                        <h2 className="font-semibold">Latest assets</h2>
                        <div className="mt-3 space-y-2">
                            {(assets ?? []).slice(0, 6).length ? (assets ?? []).slice(0, 6).map((asset) => (
                                <Link key={asset.id} href={assetHref(workspace.slug, asset.id)} className="block rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-600">
                                    <span className="block truncate text-neutral-100">{asset.title}</span>
                                    <span className="mt-1 block capitalize text-neutral-500">{asset.asset_kind.replace(/_/g, " ")}</span>
                                </Link>
                            )) : <p className="text-sm text-neutral-500">No submissions or uploads yet.</p>}
                        </div>
                    </div>
                </section>

                <section className="mt-6 rounded-2xl border border-red-500/20 bg-red-950/10 p-5">
                    <h2 className="text-lg font-semibold text-red-100">Danger zone placeholder</h2>
                    <p className="mt-2 text-sm leading-6 text-red-100/70">
                        Onboarding archive/reset controls will live here after the management pass.
                    </p>
                </section>
                    </div>

                    <ClientContextPanel
                        workspaceSlug={workspace.slug}
                        relationship={relationship}
                        metrics={[
                            { label: "Progress", value: `${percentage}%` },
                            { label: "Assets", value: assets?.length ?? 0 },
                        ]}
                    />
                </div>
            </div>
        </main>
    )
}
