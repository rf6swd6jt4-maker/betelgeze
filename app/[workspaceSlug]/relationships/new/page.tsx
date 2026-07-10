import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { RELATIONSHIP_PHASES, workspaceHref } from "@/lib/relationships"
import { requireWorkspace } from "@/lib/workspaces"
import { createRelationship } from "../actions"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ error?: string }>
}

export default async function NewRelationshipPage({ params, searchParams }: PageProps) {
    const { workspaceSlug } = await params
    const { error } = await searchParams
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-4xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <div className="flex flex-col justify-between gap-4 border-b border-neutral-800 pb-5 sm:flex-row sm:items-end">
                    <div>
                        <p className="text-sm text-neutral-500">Relationships</p>
                        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Start new relationship</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                            Add someone at the real point they enter Betelgeze. Early leads can stay light; onboarding relationships get a secure submission session.
                        </p>
                    </div>
                    <Link href={workspaceHref(workspace.slug, "relationships")} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-neutral-800 px-3 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white">
                        Back
                    </Link>
                </div>

                {error && (
                    <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                        {error === "missing-fields" ? "Add a relationship name and lifecycle stage." : "Could not create this relationship."}
                    </div>
                )}

                <form action={createRelationship.bind(null, workspace.slug)} className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block text-sm text-neutral-300">
                            Relationship name
                            <input name="primary_person_name" required placeholder="Owner, buyer, or primary contact" className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Company
                            <input name="business_name" placeholder="Business or account name" className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Phone
                            <input name="primary_phone" type="tel" placeholder="+1..." className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Email
                            <input name="primary_email" type="email" placeholder="person@company.com" className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Lifecycle stage
                            <select name="lifecycle_phase" defaultValue="lead" className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white">
                                {RELATIONSHIP_PHASES.map((phase) => (
                                    <option key={phase.key} value={phase.key}>{phase.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Contact role
                            <input name="primary_contact_role" placeholder="Owner, founder, manager..." className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Industry
                            <input name="industry_value" placeholder="roofers, dentists, restaurants..." className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Location
                            <input name="location_value" placeholder="Dallas, TX" className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Website
                            <input name="website_url" type="url" placeholder="https://example.com" className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                        <label className="block text-sm text-neutral-300">
                            Source
                            <input name="source_label" placeholder="Referral, old client list, event..." className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" />
                        </label>
                    </div>
                    <label className="mt-4 block text-sm text-neutral-300">
                        Context
                        <textarea name="notes_summary" rows={4} placeholder="Useful sales, relationship, or migration context." className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 text-white" />
                    </label>
                    <button className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black">
                        Start relationship
                    </button>
                </form>
            </div>
        </main>
    )
}
