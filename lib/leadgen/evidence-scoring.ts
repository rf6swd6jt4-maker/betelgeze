import { supabaseAdmin } from "@/lib/supabase/admin"
import type { PollStageKey } from "@/lib/leadgen/staged-poll"
import {
    candidateLocationAppliesToState,
    locationTargetMapFromRows,
    sourceCoverageApplies,
    type LeadgenLocationTarget,
} from "@/lib/leadgen/location-resolution"
import { normalisePersonName } from "./person-name-normalizer.js"

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
    stageKey?: Exclude<PollStageKey, "seed">
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
    "state_license.tx.plumbing",
    "state_license.tx.tda_pest",
    "regulated.tx.tceq_waste",
    "state_license.fl.dbpr",
    "state_license.fl.electrical",
    "registry.fl.sunbiz",
    "registry.fl.fictitious_names",
    "state_license.fl.fdacs_pest",
    "state_license.fl.fdacs_auto_repair",
    "registry.fl.miami_dade_lbt",
    "registry.fl.tampa_btr",
    "registry.fl.jacksonville_btr",
    "property.fl.miamidade_appraiser",
    "property.fl.hillsborough_appraiser",
    "clerk.fl.hillsborough_official_records",
    "state_license.ca.cslb",
    "state_license.ca.bar_auto_repair",
    "state_license.ca.pest_control",
    "registry.ca.los_angeles_fbn",
    "registry.ca.san_francisco_business_locations",
    "regulated.ca.calrecycle_waste",
    "state_license.az.roc",
    "state_license.az.pest_management",
    "registry.az.corp_commission",
    "state_license.nc.general_contractors",
    "permits.tx.dallas",
    "permits.tx.austin",
    "permits.fl.orlando",
    "permits.ca.los_angeles",
    "permits.az.phoenix",
    "registry.tx.comptroller",
    "registry.fl.orlando_btr",
    "safety.osha",
    "transport.fmcsa_safer",
    "transport.fmcsa_census",
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

function normalisePhone(value: string | null | undefined) {
    const digits = value?.replace(/\D/g, "") ?? ""
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
    return digits.length >= 8 ? `+${digits}` : null
}

function phoneLooksCallable(value: string | null | undefined) {
    const phone = normalisePhone(value)
    if (!phone) return false
    const digits = phone.replace(/\D/g, "")
    return digits.length >= 10 && digits.length <= 15
}

function sourceAppliesToCompany(source: { source_key: string; coverage?: unknown }, company: { address?: Record<string, unknown> | null; registered_address?: Record<string, unknown> | null; location_value?: string | null; industry_value?: string | null; website_domain?: string | null; website_url?: string | null }, locationTargets?: Map<string, LeadgenLocationTarget>) {
    if (source.source_key === "state_license.tx.tdlr") return candidateLocationAppliesToState(company, "TX", locationTargets)
    if (source.source_key === "state_license.tx.plumbing") return candidateLocationAppliesToState(company, "TX", locationTargets) && company.industry_value === "plumbers"
    if (source.source_key === "state_license.fl.dbpr") return candidateLocationAppliesToState(company, "FL", locationTargets) && ["general_contractors", "home_builders", "remodellers", "roofers", "hvac_contractors", "plumbers", "pool_builders", "solar_installers", "flooring_contractors", "lighting_contractors"].includes(company.industry_value ?? "")
    if (source.source_key === "state_license.fl.electrical") return candidateLocationAppliesToState(company, "FL", locationTargets) && ["electricians", "lighting_contractors", "solar_installers", "pool_builders", "hvac_contractors", "general_contractors"].includes(company.industry_value ?? "")
    if (source.source_key === "state_license.nc.general_contractors") return candidateLocationAppliesToState(company, "NC", locationTargets) && ["concrete_contractors", "deck_builders", "fencing_contractors", "general_contractors", "hardscaping_contractors", "home_builders", "insulation_contractors", "kitchen_remodelling", "masonry_contractors", "patio_contractors", "pool_builders", "remodellers", "restoration_companies", "roofers", "siding_contractors", "window_and_door_contractors"].includes(company.industry_value ?? "")
    return sourceCoverageApplies(source, company, locationTargets)
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
    const stageKey = input.stageKey ?? "business_validation"
    const payload: Record<string, unknown> = {
        workspace_id: input.workspaceId,
        poll_id: input.pollId,
        company_id: input.companyId,
        source_key: input.sourceKey,
        stage_key: stageKey,
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
        .upsert(payload, { onConflict: "poll_id,company_id,source_key,stage_key" })
    if (error) throw error
}

export async function createInvestigationTasksForPoll({ workspaceId, pollId, enabledSourceKeys, companyIds, stageKey = "business_validation" }: { workspaceId: string; pollId: string; enabledSourceKeys?: string[]; companyIds?: string[]; stageKey?: Exclude<PollStageKey, "seed"> }) {
    let companiesQuery = supabaseAdmin
        .from("leadgen_companies")
        .select("id, address, registered_address, location_value, industry_value, website_domain, website_url")
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
    if (companyIds?.length) companiesQuery = companiesQuery.in("id", companyIds)
    let catalogQuery = supabaseAdmin
        .from("leadgen_source_catalog")
        .select("source_key, implementation_status, run_stage, enabled, coverage")
    if (Array.isArray(enabledSourceKeys)) catalogQuery = catalogQuery.in("source_key", enabledSourceKeys.length ? enabledSourceKeys : ["__none__"])
    else catalogQuery = catalogQuery.eq("run_stage", "candidate_investigation")
    const [companiesResult, catalogResult] = await Promise.all([
        companiesQuery,
        catalogQuery,
    ])
    if (companiesResult.error) throw companiesResult.error
    if (catalogResult.error) throw catalogResult.error
    const companies = companiesResult.data ?? []
    const locationValues = [...new Set(companies.map((company) => asString(company.location_value)).filter((value): value is string => Boolean(value)))]
    const locationTargetsResult = locationValues.length
        ? await supabaseAdmin
            .from("leadgen_icp_locations")
            .select("value, label, location_kind, country, region, locality, metadata")
            .in("value", locationValues)
        : { data: [], error: null }
    if (locationTargetsResult.error) throw locationTargetsResult.error
    const locationTargets = locationTargetMapFromRows((locationTargetsResult.data ?? []) as LeadgenLocationTarget[])
    const enabledSet = new Set((enabledSourceKeys ?? []).map(String))
    const restrictToWorkspaceSources = Array.isArray(enabledSourceKeys)
    const catalog = (catalogResult.data ?? [])
        .filter((source) => !restrictToWorkspaceSources || enabledSet.has(source.source_key))
        .filter((source) => source.enabled || source.implementation_status === "planned")
        .filter((source) => CURRENTLY_EXECUTABLE_INVESTIGATION_SOURCES.has(source.source_key) || source.implementation_status === "planned")
    const tasks = companies.flatMap((company) => catalog.filter((source) => sourceAppliesToCompany(source, company, locationTargets)).map((source) => {
        const executable = source.enabled && CURRENTLY_EXECUTABLE_INVESTIGATION_SOURCES.has(source.source_key)
        return {
            workspace_id: workspaceId,
            poll_id: pollId,
            company_id: company.id,
            source_key: source.source_key,
            stage_key: stageKey,
            status: executable ? "queued" : "skipped",
            skip_reason: executable ? null : "Adapter is catalogued but not implemented yet or is disabled in the source catalogue.",
        }
    }))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin
        .from("leadgen_investigation_tasks")
        .upsert(tasks, { onConflict: "poll_id,company_id,source_key,stage_key", ignoreDuplicates: true })
    if (error) throw error
    return tasks.length
}

function scoreFromClaim(kind: string, points: number) {
    if (kind === "owner_identity" || kind === "officer_identity") return { ownerIdentity: points, ownerPhone: 0, businessSupport: 0 }
    if (kind === "owner_phone") return { ownerIdentity: 0, ownerPhone: points, businessSupport: 0 }
    if (kind === "business_support" || kind === "business_phone" || kind === "permit_activity" || kind === "licence_activity") return { ownerIdentity: 0, ownerPhone: 0, businessSupport: points }
    return { ownerIdentity: 0, ownerPhone: 0, businessSupport: 0 }
}

function ownerNameFromClaim(value: Record<string, unknown>, contextNames: Array<string | null | undefined> = []) {
    const raw = asString(value.owner_name) ?? asString(value.full_name) ?? asString(value.person_name) ?? asString(value.name)
    return normalisePersonName(raw, { allowExtraction: true, allowAllCaps: true, ownerContext: true, minConfidence: 58, contextNames })
}

function ownerPhoneFromClaim(value: Record<string, unknown>) {
    return asString(value.owner_phone) ?? asString(value.phone)
}

export async function scorePollCompanies({ workspaceId, pollId }: { workspaceId: string; pollId: string }) {
    const companiesResult = await supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, owner_source_key, phone, website_url, profile_url")
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
    if (companiesResult.error) throw companiesResult.error
    const companies = companiesResult.data ?? []
    for (const company of companies) {
        const claimsResult = await supabaseAdmin
            .from("leadgen_evidence_claims")
            .select("claim_kind, points_awarded, claim_value, source_key")
            .eq("workspace_id", workspaceId)
            .eq("poll_id", pollId)
            .eq("company_id", company.id)
        if (claimsResult.error) throw claimsResult.error
        let ownerIdentityPoints = 0
        let ownerPhonePoints = 0
        let businessSupportPoints = 0
        let bestOwnerName: string | null = null
        let bestOwnerPhone: string | null = null
        let bestOwnerSourceKey: string | null = null
        const ownerPhoneClaims: Array<{ points: number; ownerName: string | null; ownerPhone: string | null; sourceKey: string }> = []
        for (const claim of claimsResult.data ?? []) {
            const points = Math.max(0, Number(claim.points_awarded) || 0)
            const score = scoreFromClaim(claim.claim_kind, points)
            businessSupportPoints += score.businessSupport
            const value = asRecord(claim.claim_value)
            if (["owner_identity", "officer_identity"].includes(claim.claim_kind)) {
                const claimOwnerName = ownerNameFromClaim(value, [company.display_name])
                if (claimOwnerName && points > 0) {
                    bestOwnerName ||= claimOwnerName
                    bestOwnerSourceKey ||= claim.source_key
                    ownerIdentityPoints += score.ownerIdentity
                }
            }
            if (claim.claim_kind === "owner_phone") {
                const claimOwnerName = ownerNameFromClaim(value, [company.display_name])
                const claimOwnerPhone = ownerPhoneFromClaim(value)
                if (claimOwnerName) {
                    bestOwnerName ||= claimOwnerName
                    bestOwnerSourceKey ||= claim.source_key
                }
                if (claimOwnerPhone) bestOwnerPhone ||= claimOwnerPhone
                ownerPhoneClaims.push({ points: score.ownerPhone, ownerName: claimOwnerName, ownerPhone: claimOwnerPhone, sourceKey: claim.source_key })
            }
        }
        for (const claim of ownerPhoneClaims) {
            if (claim.ownerPhone && (claim.ownerName || bestOwnerName) && claim.points > 0) {
                ownerPhonePoints += claim.points
                bestOwnerSourceKey ||= claim.sourceKey
            }
        }
        if (company.phone || company.website_url || company.profile_url) businessSupportPoints = Math.max(businessSupportPoints, 1)
        if (!bestOwnerName) bestOwnerPhone = null
        const qualified = Boolean(bestOwnerName && phoneLooksCallable(bestOwnerPhone))
        const status = qualified ? "qualified" : ownerIdentityPoints === 0 && ownerPhonePoints === 0 ? "rejected" : "researching"
        const reason = qualified
            ? null
            : !bestOwnerName
                ? "No source-backed owner/principal found."
                : !bestOwnerPhone
                    ? "Owner/principal found, but no source-backed owner phone."
                    : "Owner phone evidence exists, but the phone could not be normalized into a callable format."
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
                gate: { owner_identity: "source_claim_present", owner_phone: "source_claim_present", phone: "callable_format" },
                claim_count: claimsResult.data?.length ?? 0,
            },
            updated_at: new Date().toISOString(),
        }
        const { error: scoreError } = await supabaseAdmin
            .from("leadgen_candidate_scores")
            .upsert(scorePayload, { onConflict: "company_id" })
        if (scoreError) throw scoreError
        const companyUpdate: Record<string, unknown> = {
            owner_identity_points: ownerIdentityPoints,
            owner_phone_points: ownerPhonePoints,
            business_support_points: businessSupportPoints,
            lead_score: totalScore,
            qualification_status: status,
            disqualification_reason: reason,
            qualified_at: qualified ? new Date().toISOString() : null,
            owner_name: bestOwnerName,
            owner_phone: bestOwnerPhone,
            owner_source_key: bestOwnerName ? bestOwnerSourceKey ?? company.owner_source_key : null,
        }
        if (!bestOwnerName) companyUpdate.owner_confidence = null
        const { error: companyError } = await supabaseAdmin
            .from("leadgen_companies")
            .update(companyUpdate)
            .eq("id", company.id)
            .eq("workspace_id", workspaceId)
        if (companyError) throw companyError
    }
}
