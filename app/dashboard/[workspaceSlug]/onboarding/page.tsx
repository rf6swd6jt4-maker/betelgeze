import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { MODULES } from "@/lib/onboarding/modules"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { isOnboardingStuck } from "@/lib/onboarding/stuck"
import {
    listRelationshipsForWorkspace,
    phaseLabel,
    relationshipHubHref,
    workspaceHref,
} from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

const baseSteps = [{ key: "welcome-video", title: "Welcome" }]

function uploadCountFromResponse(response: Record<string, unknown>) {
    return Object.values(response).reduce<number>((total, value) => {
        if (!Array.isArray(value)) return total
        return total + value.filter((item) => item && typeof item === "object" && "path" in item).length
    }, 0)
}

export default async function RelationshipOnboardingPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationships = (await listRelationshipsForWorkspace(workspace.id))
        .filter((relationship) => ["onboarding", "onboarding_complete"].includes(relationship.lifecycle_phase))
    const clientIds = relationships.map((relationship) => relationship.client_id).filter((id): id is string => Boolean(id))
    const [
        { data: clients },
        { data: progressRows },
        { data: moduleRows },
        { data: responseRows },
    ] = clientIds.length
        ? await Promise.all([
            supabaseAdmin.from("clients").select("id, relationship_id, session_token, created_at, archived_at").in("id", clientIds),
            supabaseAdmin.from("client_progress").select("client_id, step_key, completed_at, created_at").in("client_id", clientIds),
            supabaseAdmin.from("client_modules").select("client_id, module_key").in("client_id", clientIds),
            supabaseAdmin.from("client_form_responses").select("client_id, step_key, response, updated_at").in("client_id", clientIds),
        ])
        : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]

    const clientById = new Map((clients ?? []).map((client) => [client.id, client]))
    const progressByClient = new Map<string, string[]>()
    const latestProgressByClient = new Map<string, string>()
    for (const row of progressRows ?? []) {
        progressByClient.set(row.client_id, [...(progressByClient.get(row.client_id) ?? []), row.step_key])
        const date = row.completed_at ?? row.created_at
        if (!latestProgressByClient.get(row.client_id) || new Date(date) > new Date(latestProgressByClient.get(row.client_id)!)) {
            latestProgressByClient.set(row.client_id, date)
        }
    }

    const modulesByClient = new Map<string, string[]>()
    for (const row of moduleRows ?? []) {
        modulesByClient.set(row.client_id, [...(modulesByClient.get(row.client_id) ?? []), row.module_key])
    }

    const submissionsByClient = new Map<string, { count: number; files: number; latest: string | null }>()
    for (const row of responseRows ?? []) {
        const existing = submissionsByClient.get(row.client_id) ?? { count: 0, files: 0, latest: null }
        const updatedAt = row.updated_at ?? null
        submissionsByClient.set(row.client_id, {
            count: existing.count + 1,
            files: existing.files + uploadCountFromResponse((row.response ?? {}) as Record<string, unknown>),
            latest: updatedAt && (!existing.latest || new Date(updatedAt) > new Date(existing.latest)) ? updatedAt : existing.latest,
        })
    }

    const rows = relationships.map((relationship) => {
        const client = relationship.client_id ? clientById.get(relationship.client_id) : null
        const moduleSteps = (relationship.client_id ? modulesByClient.get(relationship.client_id) ?? [] : []).flatMap((moduleKey) => {
            const moduleDefinition = MODULES[moduleKey]
            return moduleDefinition ? moduleDefinition.steps : []
        })
        const steps = [...baseSteps, ...moduleSteps]
        const completedKeys = relationship.client_id ? progressByClient.get(relationship.client_id) ?? [] : []
        const percentage = getProgressPercentage(steps, completedKeys)
        const latestActivity = relationship.client_id ? latestProgressByClient.get(relationship.client_id) ?? null : null
        const stuck = client ? isOnboardingStuck({ percentage, createdAt: client.created_at, lastActivityAt: latestActivity }) : false
        const submissions = relationship.client_id ? submissionsByClient.get(relationship.client_id) ?? { count: 0, files: 0, latest: null } : { count: 0, files: 0, latest: null }
        return { relationship, client, percentage, stuck, submissions, latestActivity }
    })

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            Relationship onboarding status, submitted forms, and uploaded assets. Relationship notes and communication live on the relationship page.
                        </p>
                    </div>
                </header>

                <div className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                    <Link href={workspaceHref(workspace.slug, "relationships")} className="shrink-0 rounded-lg border border-neutral-800 px-3 py-2.5 text-neutral-300 sm:py-2">
                        Relationships
                    </Link>
                    <Link href={workspaceHref(workspace.slug, "onboarding")} className="shrink-0 rounded-lg bg-white px-3 py-2.5 font-medium text-black sm:py-2">
                        Onboarding
                    </Link>
                </div>

                <section className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                    {[
                        ["Onboarding", rows.filter((row) => row.relationship.lifecycle_phase === "onboarding").length],
                        ["Complete", rows.filter((row) => row.relationship.lifecycle_phase === "onboarding_complete").length],
                        ["Stuck", rows.filter((row) => row.stuck).length],
                    ].map(([label, value]) => (
                        <div key={label} className="border-r border-neutral-800 px-3 py-3 last:border-r-0">
                            <p className="text-xs text-neutral-500">{label}</p>
                            <p className="mt-1 text-xl font-semibold">{value}</p>
                        </div>
                    ))}
                </section>

                <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                    {rows.length ? rows.map(({ relationship, percentage, stuck, submissions, latestActivity }) => (
                        <Link key={relationship.id} href={relationshipHubHref(workspace.slug, relationship.id)} className="grid gap-3 border-b border-neutral-900 px-4 py-4 last:border-0 hover:bg-neutral-900/60 lg:grid-cols-[minmax(220px,1fr)_150px_150px_150px_120px] lg:items-center">
                            <div className="min-w-0">
                                <p className="truncate font-medium text-neutral-100">{relationship.primary_person_name}</p>
                                <p className="mt-1 truncate text-sm text-neutral-500">{relationship.business_name ?? relationship.primary_phone ?? relationship.primary_email ?? "No context saved"}</p>
                            </div>
                            <p className={`text-sm ${stuck ? "text-red-200" : "text-neutral-300"}`}>{stuck ? "Stuck" : phaseLabel(relationship.lifecycle_phase)}</p>
                            <div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
                                    <div className="h-full rounded-full bg-white" style={{ width: `${percentage}%` }} />
                                </div>
                                <p className="mt-1 text-xs text-neutral-500">{percentage}% complete</p>
                            </div>
                            <p className="text-sm text-neutral-400">{submissions.count} submissions · {submissions.files} files</p>
                            <p className="text-sm text-neutral-500 lg:text-right">{formatRelativeTime(submissions.latest ?? latestActivity ?? relationship.updated_at)}</p>
                        </Link>
                    )) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">No relationships are onboarding.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Start onboarding from a relationship page or create a new relationship directly in the onboarding stage.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
