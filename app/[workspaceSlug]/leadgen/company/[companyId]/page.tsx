import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

export default async function SavedLeadDetail({ params }: { params: Promise<{ workspaceSlug: string; companyId: string }> }) {
    const { workspaceSlug, companyId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const result = await supabaseAdmin.from("leadgen_companies")
        .select("id, display_name, legal_name, dba_name, owner_name, owner_phone, phone, source_key, source_record_id, first_seen_poll_id, qualification_status, disqualification_reason, website_url, profile_url, industry_value, location_value, created_at")
        .eq("workspace_id", workspace.id).eq("id", companyId).maybeSingle()
    if (result.error) throw new Error("Could not load this saved record. Please retry.")
    if (!result.data) notFound()
    const company = result.data
    const status = company.qualification_status ?? "Saved"
    return <main className="min-h-screen bg-neutral-950 px-4 pb-5 text-white sm:px-6 sm:pb-6"><div className="mx-auto max-w-6xl">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
        <div className="pt-5">
            <Link className="mb-5 inline-block text-sm text-blue-300 underline" href={`/${workspace.slug}/leadgen`}>Saved leads</Link>
            <DetailPageHeader category="Lead" reference={shortId(company.id)} title={company.display_name} subtitle={company.owner_name ?? undefined} updated={formatRelativeTime(company.created_at)} />
            <DetailFields>
                <DetailField label="Status" icon="status"><Status label={status} tone={status === "qualified" ? "green" : "grey"} /></DetailField>
                <DetailField label="Source" icon="source" className="lg:border-l lg:border-neutral-900 lg:pl-8">{company.source_key ?? "—"}</DetailField>
                <DetailField label="Owner" icon="user">{company.owner_name ?? "—"}</DetailField>
                <DetailField label="Owner phone" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8">{company.owner_phone ?? "—"}</DetailField>
                <DetailField label="Business phone" icon="contact">{company.phone ?? "—"}</DetailField>
                <DetailField label="Legal name" icon="company" className="lg:border-l lg:border-neutral-900 lg:pl-8">{company.legal_name ?? "—"}</DetailField>
                <DetailField label="Other name" icon="company">{company.dba_name ?? "—"}</DetailField>
                <DetailField label="Industry" icon="source" className="lg:border-l lg:border-neutral-900 lg:pl-8">{company.industry_value ?? "—"}</DetailField>
                <DetailField label="Location" icon="location">{company.location_value ?? "—"}</DetailField>
                <DetailField label="Source ID" icon="source" className="lg:border-l lg:border-neutral-900 lg:pl-8">{company.source_record_id ?? "—"}</DetailField>
            </DetailFields>
            {company.disqualification_reason ? <p className="mt-5 text-sm text-neutral-400">Recorded reason: {company.disqualification_reason}</p> : null}
            <div className="mt-5 flex flex-wrap gap-4 text-sm">
                {company.first_seen_poll_id ? <Link className="text-blue-300 underline" href={`/${workspace.slug}/leadgen/poll/${company.first_seen_poll_id}`}>Saved poll</Link> : null}
                {company.website_url?.startsWith("https://") ? <a className="text-blue-300 underline" href={company.website_url} target="_blank" rel="noopener noreferrer">Website</a> : null}
                {company.profile_url?.startsWith("https://") ? <a className="text-blue-300 underline" href={company.profile_url} target="_blank" rel="noopener noreferrer">Source profile</a> : null}
            </div>
        </div>
    </div></main>
}
