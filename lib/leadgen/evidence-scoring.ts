import { supabaseAdmin } from "@/lib/supabase/admin"

type ClaimKind = "owner_identity" | "owner_phone" | "business_phone" | "business_support" | "permit_activity" | "licence_activity" | "officer_identity"

type EvidenceClaimInput = {
    workspaceId: string
    pollId: string | null
    companyId: string
    sourceKey: string
    claimKind: ClaimKind
    claimValue?: Record<string, unknown>
    pointsAwarded: number
    confidence?: number | null
    provenanceUrl?: string | null
    rawPayload?: Record<string, unknown>
}

type InvestigationTaskUpdate = {
    workspaceId: string
    pollId: string
    companyId: string
    sourceKey: string
    status: "queued" | "running" | "completed" | "skipped" | "failed"
    matched?: boolean
    skipReason?: string | null
    error?: string | null
    ownerIdentityPoints?: number
    ownerPhonePoints?: number
    businessSupportPoints?: number
    rawPayload?: Record<string, unknown>
}

const CURRENTLY_EXECUTABLE_INVESTIGATION_SOURCES = new Set([
    "website",
    "web.json_ld",
    "state_license.tx.tdlr",
    "state_license.fl.electrical",
    "state_license.nc.general_contractors",
    "permits.tx.dallas",
    "permits.tx.austin",
    "permits.fl.orlando",
    "permits.ca.los_angeles",
    "registry.fl.orlando_btr",
    "safety.osha",
    "transport.fmcsa_safer",
    "regulated.epa_echo",
    "regulated.nppes",
    "procurement.usaspending",
    "web.rdap_whois",
    "web.certificate_transparency",
])

function clampPoints(value: number) {
    return Math.min(3, Math.max(0, Math.round(value)))
}

function confidence(value: number | null | undefined) {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function domainFromUrl(value: unknown) {
    const text = asString(value)
    if (!text) return null
    try {
        return new URL(text.startsWith("http") ? text : `https://${text}`).hostname.toLowerCase().replace(/^www\./, "") || null
    } catch {
        return null
    }
}

function companyState(company: { address?: unknown }) {
    const address = asRecord(company.address)
    const direct = asString(address.state) ?? asString(address.region) ?? asString(address.state_code) ?? asString(address.region_code)
    return direct && /^[A-Z]{2}$/i.test(direct) ? direct.toUpperCase() : null
}

function sourceAppliesToCompany(source: { source_key: string; coverage?: unknown }, company: { address?: unknown; industry_value?: string | null; website_domain?: string | null; website_url?: string | null }) {
    if (source.source_key === "website" || source.source_key === "web.json_ld") return true
    if ((source.source_key === "web.rdap_whois" || source.source_key === "web.certificate_transparency") && !domainFromUrl(company.website_domain) && !domainFromUrl(company.website_url)) return false
    const state = companyState(company)
    if (source.source_key === "state_license.tx.tdlr") return state === "TX"
    if (source.source_key === "state_license.fl.electrical") return state === "FL" && ["electricians", "solar_installers", "pool_builders", "hvac_contractors", "general_contractors"].includes(company.industry_value ?? "")
    if (source.source_key === "state_license.nc.general_contractors") return state === "NC" && ["concrete_contractors", "deck_builders", "fencing_contractors", "general_contractors", "hardscaping_contractors", "home_builders", "insulation_contractors", "kitchen_remodelling", "masonry_contractors", "patio_contractors", "pool_builders", "remodellers", "restoration_companies", "roofers", "siding_contractors", "window_and_door_contractors"].includes(company.industry_value ?? "")
    const coverage = asRecord(source.coverage)
    const states = Array.isArray(coverage.states) ? coverage.states.map(String).map((value) => value.toUpperCase()) : []
    const industries = Array.isArray(coverage.industries) ? coverage.industries.map(String) : []
    if (industries.length > 0 && (!company.industry_value || !industries.includes(company.industry_value))) return false
    return states.length === 0 || !state || states.includes(state)
}

export async function recordEvidenceClaim(input: EvidenceClaimInput) {
    const { error } = await supabaseAdmin.from("leadgen_evidence_claims").insert({
        workspace_id: input.workspaceId,
        poll_id: input.pollId,
        company_id: input.companyId,
        source_key: input.sourceKey,
        claim_kind: input.claimKind,
        claim_value: input.claimValue ?? {},
        points_awarded: clampPoints(input.pointsAwarded),
        confidence: confidence(input.confidence),
        provenance_url: input.provenanceUrl ?? null,
        raw_payload: input.rawPayload ?? {},
    })
    if (error) throw error
}

export async function updateInvestigationTask(input: InvestigationTaskUpdate) {
    const payload: Record<string, unknown> = {
        status: input.status,
        matched: input.matched ?? false,
        skip_reason: input.skipReason ?? null,
        error: input.error ?? null,
        owner_identity_points: input.ownerIdentityPoints ?? 0,
        owner_phone_points: input.ownerPhonePoints ?? 0,
        business_support_points: input.businessSupportPoints ?? 0,
        raw_payload: input.rawPayload ?? {},
        completed_at: ["completed", "skipped", "failed"].includes(input.status) ? new Date().toISOString() : null,
    }
    if (input.status === "running") payload.started_at = new Date().toISOString()
    const { error } = await supabaseAdmin
        .from("leadgen_investigation_tasks")
        .update(payload)
        .eq("workspace_id", input.workspaceId)
        .eq("poll_id", input.pollId)
        .eq("company_id", input.companyId)
        .eq("source_key", input.sourceKey)
    if (error) throw error
}

export async function createInvestigationTasksForPoll({ workspaceId, pollId, enabledSourceKeys, companyIds }: { workspaceId: string; pollId: string; enabledSourceKeys?: string[]; companyIds?: string[] }) {
    let companiesQuery = supabaseAdmin
        .from("leadgen_companies")
        .select("id, address, industry_value, website_domain, website_url")
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
    if (companyIds?.length) companiesQuery = companiesQuery.in("id", companyIds)
    const [companiesResult, catalogResult] = await Promise.all([
        companiesQuery,
        supabaseAdmin
            .from("leadgen_source_catalog")
            .select("source_key, implementation_status, run_stage, enabled, coverage")
            .eq("run_stage", "candidate_investigation"),
    ])
    if (companiesResult.error) throw companiesResult.error
    if (catalogResult.error) throw catalogResult.error
    const companies = companiesResult.data ?? []
    const enabledSet = new Set((enabledSourceKeys ?? []).map(String))
    const restrictToWorkspaceSources = Array.isArray(enabledSourceKeys)
    const catalog = (catalogResult.data ?? [])
        .filter((source) => !restrictToWorkspaceSources || enabledSet.has(source.source_key))
        .filter((source) => source.enabled || source.implementation_status === "planned")
        .filter((source) => CURRENTLY_EXECUTABLE_INVESTIGATION_SOURCES.has(source.source_key) || source.implementation_status === "planned")
    const tasks = companies.flatMap((company) => catalog.filter((source) => sourceAppliesToCompany(source, company)).map((source) => {
        const executable = source.enabled && CURRENTLY_EXECUTABLE_INVESTIGATION_SOURCES.has(source.source_key)
        return {
            workspace_id: workspaceId,
            poll_id: pollId,
            company_id: company.id,
            source_key: source.source_key,
            status: executable ? "queued" : "skipped",
            skip_reason: executable ? null : "Adapter is catalogued but not implemented yet or is disabled in the source catalogue.",
        }
    }))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin
        .from("leadgen_investigation_tasks")
        .upsert(tasks, { onConflict: "poll_id,company_id,source_key", ignoreDuplicates: true })
    if (error) throw error
    return tasks.length
}

function scoreFromClaim(kind: string, points: number) {
    if (kind === "owner_identity" || kind === "officer_identity") return { ownerIdentity: points, ownerPhone: 0, businessSupport: 0 }
    if (kind === "owner_phone") return { ownerIdentity: 0, ownerPhone: points, businessSupport: 0 }
    if (kind === "business_support" || kind === "business_phone" || kind === "permit_activity" || kind === "licence_activity") return { ownerIdentity: 0, ownerPhone: 0, businessSupport: points }
    return { ownerIdentity: 0, ownerPhone: 0, businessSupport: 0 }
}

function fallbackSourcePoints(sourceKey: string | null, ownerPhone: string | null) {
    if (!sourceKey || !ownerPhone) return { ownerIdentity: 0, ownerPhone: 0, businessSupport: 0 }
    if (sourceKey === "state_licensing" || sourceKey.startsWith("state_license.")) return { ownerIdentity: 3, ownerPhone: 3, businessSupport: 2 }
    if (sourceKey === "sam_gov") return { ownerIdentity: 2, ownerPhone: 2, businessSupport: 2 }
    if (sourceKey === "website") return { ownerIdentity: 2, ownerPhone: 2, businessSupport: 1 }
    return { ownerIdentity: 0, ownerPhone: 0, businessSupport: 0 }
}

export async function scorePollCompanies({ workspaceId, pollId }: { workspaceId: string; pollId: string }) {
    const companiesResult = await supabaseAdmin
        .from("leadgen_companies")
        .select("id, owner_name, owner_phone, owner_source_key, phone, website_url, profile_url")
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
    if (companiesResult.error) throw companiesResult.error
    const companies = companiesResult.data ?? []
    for (const company of companies) {
        const claimsResult = await supabaseAdmin
            .from("leadgen_evidence_claims")
            .select("claim_kind, points_awarded, claim_value, source_key")
            .eq("workspace_id", workspaceId)
            .eq("company_id", company.id)
        if (claimsResult.error) throw claimsResult.error
        let ownerIdentityPoints = 0
        let ownerPhonePoints = 0
        let businessSupportPoints = 0
        let bestOwnerName = company.owner_name
        let bestOwnerPhone = company.owner_phone
        for (const claim of claimsResult.data ?? []) {
            const score = scoreFromClaim(claim.claim_kind, claim.points_awarded ?? 0)
            ownerIdentityPoints += score.ownerIdentity
            ownerPhonePoints += score.ownerPhone
            businessSupportPoints += score.businessSupport
            const value = asRecord(claim.claim_value)
            bestOwnerName ||= asString(value.owner_name) ?? asString(value.full_name) ?? asString(value.name)
            bestOwnerPhone ||= asString(value.owner_phone) ?? asString(value.phone)
        }
        const fallback = fallbackSourcePoints(company.owner_source_key, company.owner_phone)
        ownerIdentityPoints = Math.max(ownerIdentityPoints, fallback.ownerIdentity)
        ownerPhonePoints = Math.max(ownerPhonePoints, fallback.ownerPhone)
        businessSupportPoints = Math.max(businessSupportPoints, fallback.businessSupport)
        if (company.phone || company.website_url || company.profile_url) businessSupportPoints = Math.max(businessSupportPoints, 1)
        const qualified = Boolean(bestOwnerName && bestOwnerPhone && ownerIdentityPoints >= 3 && ownerPhonePoints >= 3)
        const status = qualified ? "qualified" : ownerIdentityPoints === 0 && ownerPhonePoints === 0 ? "rejected" : "researching"
        const reason = qualified
            ? null
            : !bestOwnerName
                ? "No source-backed owner/principal found."
                : !bestOwnerPhone
                    ? "Owner/principal found, but no source-backed owner phone."
                    : "Owner evidence exists, but does not meet the strict source score threshold."
        const totalScore = ownerIdentityPoints + ownerPhonePoints + businessSupportPoints
        const scorePayload = {
            company_id: company.id,
            workspace_id: workspaceId,
            poll_id: pollId,
            owner_identity_points: ownerIdentityPoints,
            owner_phone_points: ownerPhonePoints,
            business_support_points: businessSupportPoints,
            total_score: totalScore,
            qualification_status: status,
            disqualification_reason: reason,
            best_owner_name: bestOwnerName,
            best_owner_phone: bestOwnerPhone,
            score_detail: {
                thresholds: { owner_identity_points: 3, owner_phone_points: 3 },
                claim_count: claimsResult.data?.length ?? 0,
            },
            updated_at: new Date().toISOString(),
        }
        const { error: scoreError } = await supabaseAdmin
            .from("leadgen_candidate_scores")
            .upsert(scorePayload, { onConflict: "company_id" })
        if (scoreError) throw scoreError
        const { error: companyError } = await supabaseAdmin
            .from("leadgen_companies")
            .update({
                owner_identity_points: ownerIdentityPoints,
                owner_phone_points: ownerPhonePoints,
                business_support_points: businessSupportPoints,
                lead_score: totalScore,
                qualification_status: status,
                disqualification_reason: reason,
                qualified_at: qualified ? new Date().toISOString() : null,
                owner_name: bestOwnerName,
                owner_phone: bestOwnerPhone,
            })
            .eq("id", company.id)
            .eq("workspace_id", workspaceId)
        if (companyError) throw companyError
    }
}
