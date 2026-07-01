import {
    extractCompanyIdentityProfile,
    identityUpdatePayload,
    mergeCompanyIdentity,
    type CompanyIdentityFields,
    type CompanyIdentityProfile,
} from "@/lib/leadgen/company-identity-profile"
import { supabaseAdmin } from "@/lib/supabase/admin"

type EvidenceRow = {
    company_id: string
    source_key: string
    confidence: number | null
    raw_payload: Record<string, unknown> | null
}

type CompanyRow = CompanyIdentityFields & {
    id: string
    display_name: string
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function compactErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "Could not resolve company legal identity."
    return message.length > 500 ? `${message.slice(0, 500)}...` : message
}

function missingIdentityColumns(error: { code?: string; message?: string } | null) {
    return error?.code === "42703" || /legal_name|dba_name|entity_number|identity_resolution|known_aliases/i.test(error?.message ?? "")
}

function profileFromEvidence(evidence: EvidenceRow, company: Pick<CompanyRow, "display_name">) {
    const rawPayload = asRecord(evidence.raw_payload)
    const row = asRecord(rawPayload.row)
    if (Object.keys(row).length === 0) return null
    return extractCompanyIdentityProfile(row, {
        sourceKey: evidence.source_key,
        sourceLabel: typeof rawPayload.source_label === "string" ? rawPayload.source_label : null,
        confidence: evidence.confidence,
        seedDisplayName: company.display_name,
    })
}

export function identityProfileFromOfficialRecord(row: Record<string, unknown>, context: {
    sourceKey: string
    sourceLabel?: string | null
    confidence?: number | null
    seedDisplayName?: string | null
}) {
    return extractCompanyIdentityProfile(row, context)
}

export function mergeIdentityForCompany(company: CompanyIdentityFields, profiles: CompanyIdentityProfile[]) {
    return mergeCompanyIdentity(company, profiles)
}

export function identityPayloadForCompany(identity: NonNullable<ReturnType<typeof mergeCompanyIdentity>>) {
    return identityUpdatePayload(identity)
}

export async function resolveCompanyIdentitiesFromEvidence({
    workspaceId,
    pollId,
    companyIds,
}: {
    workspaceId: string
    pollId: string
    companyIds?: string[]
}) {
    let companiesQuery = supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, legal_name, dba_name, entity_number, filing_id, registered_address, known_aliases, identity_resolution, identity_source_key, identity_confidence, identity_resolved_at")
        .eq("workspace_id", workspaceId)
    if (companyIds?.length) companiesQuery = companiesQuery.in("id", companyIds)
    const companiesResult = await companiesQuery
    if (companiesResult.error) {
        if (missingIdentityColumns(companiesResult.error)) return { resolvedCount: 0, skipped: true, reason: "missing_identity_columns" }
        throw companiesResult.error
    }
    const companies = new Map(((companiesResult.data ?? []) as CompanyRow[]).map((company) => [company.id, company]))
    if (companies.size === 0) return { resolvedCount: 0, skipped: false }

    let evidenceQuery = supabaseAdmin
        .from("leadgen_evidence")
        .select("company_id, source_key, confidence, raw_payload")
        .eq("workspace_id", workspaceId)
        .eq("poll_id", pollId)
    if (companyIds?.length) evidenceQuery = evidenceQuery.in("company_id", companyIds)
    const evidenceResult = await evidenceQuery
    if (evidenceResult.error) throw evidenceResult.error

    const profilesByCompany = new Map<string, CompanyIdentityProfile[]>()
    for (const evidence of (evidenceResult.data ?? []) as EvidenceRow[]) {
        const company = companies.get(evidence.company_id)
        if (!company) continue
        const profile = profileFromEvidence(evidence, company)
        if (!profile) continue
        const profiles = profilesByCompany.get(evidence.company_id) ?? []
        profiles.push(profile)
        profilesByCompany.set(evidence.company_id, profiles)
    }

    let resolvedCount = 0
    const errors: string[] = []
    for (const [companyId, profiles] of profilesByCompany) {
        const company = companies.get(companyId)
        if (!company) continue
        const merged = mergeCompanyIdentity(company, profiles)
        if (!merged) continue
        const { error } = await supabaseAdmin
            .from("leadgen_companies")
            .update(identityUpdatePayload(merged))
            .eq("workspace_id", workspaceId)
            .eq("id", companyId)
        if (error) {
            if (missingIdentityColumns(error)) return { resolvedCount, skipped: true, reason: "missing_identity_columns" }
            errors.push(compactErrorMessage(error))
            continue
        }
        resolvedCount += 1
    }
    return { resolvedCount, skipped: false, errors }
}
