import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import {
    getRelationship,
    phaseLabel,
    relationshipHubHref,
    workspaceHref,
} from "@/lib/relationships"
import { formatRelativeTime } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

export default async function OnboardingDetailPlaceholder({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-5xl">
                <Link href={workspaceHref(workspace.slug, "onboarding")} className="text-sm text-neutral-400 hover:text-white">
                    Back to Onboarding
                </Link>

                <header className="mt-6 border-b border-neutral-800 pb-6">
                    <p className="text-sm text-neutral-500">Onboarding detail</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight">{relationship.primary_person_name}</h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
                        This page will replace the old ClickUp onboarding list. It will show onboarding progress, completed and missing steps, submitted answers, uploaded files, and worker-ready client information.
                    </p>
                </header>

                <section className="mt-6 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Company</p>
                        <p className="mt-2 font-medium">{relationship.business_name ?? "No company saved"}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Status</p>
                        <p className="mt-2 font-medium">{phaseLabel(relationship.lifecycle_phase)}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                        <p className="text-sm text-neutral-500">Updated</p>
                        <p className="mt-2 font-medium">{formatRelativeTime(relationship.updated_at)}</p>
                    </div>
                </section>

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Future onboarding workspace</h2>
                    <p className="mt-2 text-sm leading-6 text-neutral-400">
                        Placeholder for onboarding step timeline, form responses, missing submissions, uploaded files, and generated onboarding work items. Relationship-wide notes and communications belong in their own pages.
                    </p>
                    <Link href={relationshipHubHref(workspace.slug, relationship.id)} className="mt-4 inline-flex rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:text-white">
                        Open relationship summary
                    </Link>
                </section>

                <section className="mt-6 rounded-2xl border border-red-500/20 bg-red-950/10 p-5">
                    <h2 className="text-lg font-semibold text-red-100">Danger zone placeholder</h2>
                    <p className="mt-2 text-sm leading-6 text-red-100/70">
                        Onboarding archive/reset actions will live here after the real onboarding detail page is rebuilt.
                    </p>
                </section>
            </div>
        </main>
    )
}
