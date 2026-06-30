import { supabaseAdmin } from "@/lib/supabase/admin"

export type PollStageKey = "seed" | "business_validation" | "owner_identity" | "owner_phone" | "phone_validation"

type StageStatus = "queued" | "running" | "completed" | "failed" | "skipped"
type CompanyStageStatus = "passed" | "failed" | "skipped"

type EvidenceClaim = {
    company_id: string
    source_key: string
    claim_kind: string
    claim_value: unknown
    points_awarded: number | null
}

type StageCompany = {
    id: string
    display_name: string
    phone: string | null
    website_url: string | null
    profile_url: string | null
    owner_name: string | null
    owner_phone: string | null
    owner_identity_points: number | null
    owner_phone_points: number | null
    business_support_points: number | null
    created_at?: string | null
}

type StageMetrics = {
    businessSupportPoints: number
    ownerIdentityPoints: number
    ownerPhonePoints: number
    hasOwnerIdentityEvidence: boolean
    hasOwnerPhoneEvidence: boolean
    ownerName: string | null
    ownerPhone: string | null
    sourceKeys: string[]
}

const STAGE_ORDER: Record<PollStageKey, number> = {
    seed: 1,
    business_validation: 2,
    owner_identity: 3,
    owner_phone: 4,
    phone_validation: 5,
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function ownerNameFromClaim(value: Record<string, unknown>) {
    return asString(value.owner_name) ?? asString(value.full_name) ?? asString(value.person_name) ?? asString(value.name)
}

function ownerPhoneFromClaim(value: Record<string, unknown>) {
    return asString(value.owner_phone) ?? asString(value.phone)
}

function missingStagedSchema(error: { code?: string; message?: string } | null) {
    return error?.code === "42P01" || /leadgen_(poll_stage_runs|company_stage_status|source_stage_capabilities)/i.test(error?.message ?? "")
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

async function updatePollStageColumns(workspaceId: string, pollId: string) {
    const { data, error } = await supabaseAdmin
        .from("leadgen_poll_stage_runs")
        .select("stage_key, status, input_count, passed_count, failed_count, skipped_count, replaced_count, target_count, metrics")
        .eq("workspace_id", workspaceId)
        .eq("poll_id", pollId)
    if (error) {
        if (missingStagedSchema(error)) return
        throw error
    }
    const stages = data ?? []
    const byStage = new Map(stages.map((stage) => [stage.stage_key as PollStageKey, stage]))
    const stageSummary = Object.fromEntries(stages.map((stage) => [stage.stage_key, {
        status: stage.status,
        input_count: stage.input_count,
        passed_count: stage.passed_count,
        failed_count: stage.failed_count,
        skipped_count: stage.skipped_count,
        replaced_count: stage.replaced_count,
        target_count: stage.target_count,
        metrics: stage.metrics ?? {},
    }]))
    const { error: updateError } = await supabaseAdmin
        .from("leadgen_polls")
        .update({
            seeded_count: byStage.get("seed")?.passed_count ?? 0,
            validation_passed_count: byStage.get("business_validation")?.passed_count ?? 0,
            owner_identity_count: byStage.get("owner_identity")?.passed_count ?? 0,
            owner_phone_count: byStage.get("owner_phone")?.passed_count ?? 0,
            callable_phone_count: byStage.get("phone_validation")?.passed_count ?? 0,
            stage_summary: stageSummary,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", pollId)
    if (updateError && !missingStagedSchema(updateError)) throw updateError
}

export async function startPollStage({ workspaceId, pollId, stageKey, targetCount = null, inputCount = 0 }: { workspaceId: string; pollId: string; stageKey: PollStageKey; targetCount?: number | null; inputCount?: number }) {
    const now = new Date().toISOString()
    const { error } = await supabaseAdmin
        .from("leadgen_poll_stage_runs")
        .upsert({
            workspace_id: workspaceId,
            poll_id: pollId,
            stage_key: stageKey,
            stage_order: STAGE_ORDER[stageKey],
            status: "running" satisfies StageStatus,
            target_count: targetCount,
            input_count: inputCount,
            error: null,
            started_at: now,
            completed_at: null,
        }, { onConflict: "poll_id,stage_key" })
    if (error) {
        if (missingStagedSchema(error)) return
        throw error
    }
    const { error: pollError } = await supabaseAdmin
        .from("leadgen_polls")
        .update({ current_stage: stageKey })
        .eq("workspace_id", workspaceId)
        .eq("id", pollId)
    if (pollError && !missingStagedSchema(pollError)) throw pollError
}

export async function finishPollStage({
    workspaceId,
    pollId,
    stageKey,
    status = "completed",
    targetCount = null,
    inputCount,
    passedCount,
    failedCount = 0,
    skippedCount = 0,
    replacedCount = 0,
    error = null,
    metrics = {},
}: {
    workspaceId: string
    pollId: string
    stageKey: PollStageKey
    status?: StageStatus
    targetCount?: number | null
    inputCount: number
    passedCount: number
    failedCount?: number
    skippedCount?: number
    replacedCount?: number
    error?: string | null
    metrics?: Record<string, unknown>
}) {
    const { error: upsertError } = await supabaseAdmin
        .from("leadgen_poll_stage_runs")
        .upsert({
            workspace_id: workspaceId,
            poll_id: pollId,
            stage_key: stageKey,
            stage_order: STAGE_ORDER[stageKey],
            status,
            target_count: targetCount,
            input_count: inputCount,
            passed_count: passedCount,
            failed_count: failedCount,
            skipped_count: skippedCount,
            replaced_count: replacedCount,
            error,
            metrics,
            completed_at: new Date().toISOString(),
        }, { onConflict: "poll_id,stage_key" })
    if (upsertError) {
        if (missingStagedSchema(upsertError)) return
        throw upsertError
    }
    await updatePollStageColumns(workspaceId, pollId)
}

export async function loadStageSourceKeys(stageKey: PollStageKey, enabledSourceKeys: string[]) {
    const enabledSet = new Set(enabledSourceKeys)
    const { data, error } = await supabaseAdmin
        .from("leadgen_source_stage_capabilities")
        .select("source_key")
        .eq("stage_key", stageKey)
        .eq("enabled", true)
        .order("priority", { ascending: true })
    if (error) {
        if (missingStagedSchema(error)) return enabledSourceKeys
        throw error
    }
    const keys = (data ?? []).map((row) => String(row.source_key))
    return keys.filter((key) => enabledSet.has(key))
}

export async function loadPollCompanies(workspaceId: string, pollId: string, limit = 500) {
    const { data, error } = await supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, phone, website_url, profile_url, owner_name, owner_phone, owner_identity_points, owner_phone_points, business_support_points, created_at")
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
        .order("created_at", { ascending: true })
        .limit(limit)
    if (error) throw error
    return (data ?? []) as StageCompany[]
}

async function loadClaims(workspaceId: string, pollId: string, companyIds: string[]) {
    if (companyIds.length === 0) return new Map<string, EvidenceClaim[]>()
    const { data, error } = await supabaseAdmin
        .from("leadgen_evidence_claims")
        .select("company_id, source_key, claim_kind, claim_value, points_awarded")
        .eq("workspace_id", workspaceId)
        .eq("poll_id", pollId)
        .in("company_id", companyIds)
    if (error) throw error
    const byCompany = new Map<string, EvidenceClaim[]>()
    for (const claim of (data ?? []) as EvidenceClaim[]) {
        byCompany.set(claim.company_id, [...(byCompany.get(claim.company_id) ?? []), claim])
    }
    return byCompany
}

function metricsForCompany(company: StageCompany, claims: EvidenceClaim[]): StageMetrics {
    let businessSupportPoints = 0
    let ownerIdentityPoints = 0
    let ownerPhonePoints = 0
    let hasOwnerIdentityEvidence = false
    let hasOwnerPhoneEvidence = false
    let ownerName: string | null = null
    let ownerPhone: string | null = null
    const sourceKeys = new Set<string>()
    const ownerPhoneClaims: Array<{ points: number; ownerName: string | null; ownerPhone: string | null }> = []
    for (const claim of claims) {
        sourceKeys.add(claim.source_key)
        const points = Math.max(0, Number(claim.points_awarded) || 0)
        if (["business_support", "business_phone", "permit_activity", "licence_activity"].includes(claim.claim_kind)) businessSupportPoints += points
        const value = asRecord(claim.claim_value)
        if (["owner_identity", "officer_identity"].includes(claim.claim_kind)) {
            const claimOwnerName = ownerNameFromClaim(value)
            if (claimOwnerName) {
                ownerName ||= claimOwnerName
                hasOwnerIdentityEvidence = true
                ownerIdentityPoints += points
            }
        }
        if (claim.claim_kind === "owner_phone") {
            const claimOwnerName = ownerNameFromClaim(value)
            const claimOwnerPhone = ownerPhoneFromClaim(value)
            if (claimOwnerName) {
                ownerName ||= claimOwnerName
                hasOwnerIdentityEvidence = true
            }
            if (claimOwnerPhone) {
                ownerPhone ||= claimOwnerPhone
                hasOwnerPhoneEvidence = true
            }
            ownerPhoneClaims.push({ points, ownerName: claimOwnerName, ownerPhone: claimOwnerPhone })
        }
    }
    for (const claim of ownerPhoneClaims) {
        if (claim.ownerPhone && (claim.ownerName || ownerName)) ownerPhonePoints += claim.points
    }
    if (company.phone || company.website_url || company.profile_url) businessSupportPoints = Math.max(businessSupportPoints, 1)
    return {
        businessSupportPoints,
        ownerIdentityPoints,
        ownerPhonePoints,
        hasOwnerIdentityEvidence,
        hasOwnerPhoneEvidence,
        ownerName,
        ownerPhone,
        sourceKeys: [...sourceKeys],
    }
}

async function upsertCompanyStages(rows: Array<{
    workspace_id: string
    poll_id: string
    company_id: string
    stage_key: Exclude<PollStageKey, "seed">
    status: CompanyStageStatus
    source_keys: string[]
    score: number
    reason: string | null
    metrics: Record<string, unknown>
    completed_at: string
}>) {
    if (rows.length === 0) return
    const { error } = await supabaseAdmin
        .from("leadgen_company_stage_status")
        .upsert(rows, { onConflict: "poll_id,company_id,stage_key" })
    if (error) {
        if (missingStagedSchema(error)) return
        throw error
    }
}

export async function recordSeedStage({ workspaceId, pollId, targetCount, maxSeedCandidates, seededCount }: { workspaceId: string; pollId: string; targetCount: number; maxSeedCandidates: number; seededCount: number }) {
    await finishPollStage({
        workspaceId,
        pollId,
        stageKey: "seed",
        targetCount: maxSeedCandidates,
        inputCount: seededCount,
        passedCount: seededCount,
        metrics: { target_validated_businesses: targetCount, max_seed_candidates: maxSeedCandidates },
    })
}

export async function recordBusinessValidationStage({ workspaceId, pollId, targetCount, companies }: { workspaceId: string; pollId: string; targetCount: number; companies: StageCompany[] }) {
    const claims = await loadClaims(workspaceId, pollId, companies.map((company) => company.id))
    const evaluated = companies.map((company) => {
        const metrics = metricsForCompany(company, claims.get(company.id) ?? [])
        return { company, metrics, valid: metrics.businessSupportPoints > 0 }
    })
    const valid = evaluated.filter((item) => item.valid)
    const selected = valid.slice(0, targetCount)
    const selectedIds = new Set(selected.map((item) => item.company.id))
    const now = new Date().toISOString()
    await upsertCompanyStages(evaluated.map((item) => {
        const status: CompanyStageStatus = item.valid
            ? selectedIds.has(item.company.id) ? "passed" : "skipped"
            : "failed"
        return {
            workspace_id: workspaceId,
            poll_id: pollId,
            company_id: item.company.id,
            stage_key: "business_validation",
            status,
            source_keys: item.metrics.sourceKeys,
            score: item.metrics.businessSupportPoints,
            reason: status === "passed"
                ? "Business has enough source-backed support to enter the owner pipeline."
                : status === "skipped"
                    ? "Business validated, but the target set was already filled."
                    : "No source-backed business validation evidence found.",
            metrics: {
                business_support_points: item.metrics.businessSupportPoints,
                owner_identity_points: item.metrics.ownerIdentityPoints,
                owner_phone_points: item.metrics.ownerPhonePoints,
            },
            completed_at: now,
        }
    }))
    await finishPollStage({
        workspaceId,
        pollId,
        stageKey: "business_validation",
        status: selected.length === 0 ? "failed" : "completed",
        targetCount,
        inputCount: companies.length,
        passedCount: selected.length,
        failedCount: evaluated.filter((item) => !item.valid).length,
        skippedCount: valid.length - selected.length,
        replacedCount: Math.max(0, companies.length - selected.length),
        error: selected.length === 0 ? "No seeded businesses passed validation." : selected.length < targetCount ? `Only ${selected.length} businesses passed validation.` : null,
        metrics: {
            valid_businesses_found: valid.length,
            selected_valid_businesses: selected.length,
            seed_candidates_needed: companies.length,
        },
    })
    return selected.map((item) => item.company.id)
}

export async function recordOwnerIdentityStage({ workspaceId, pollId, companyIds }: { workspaceId: string; pollId: string; companyIds: string[] }) {
    const companies = (await loadPollCompanies(workspaceId, pollId)).filter((company) => companyIds.includes(company.id))
    const claims = await loadClaims(workspaceId, pollId, companyIds)
    const now = new Date().toISOString()
    const passed: string[] = []
    await upsertCompanyStages(companies.map((company) => {
        const metrics = metricsForCompany(company, claims.get(company.id) ?? [])
        const hasOwner = Boolean(metrics.ownerName && metrics.hasOwnerIdentityEvidence)
        if (hasOwner) passed.push(company.id)
        return {
            workspace_id: workspaceId,
            poll_id: pollId,
            company_id: company.id,
            stage_key: "owner_identity",
            status: hasOwner ? "passed" : "failed",
            source_keys: metrics.sourceKeys,
            score: metrics.ownerIdentityPoints,
            reason: hasOwner ? "Source-backed owner/principal identity found." : "No source-backed owner/principal identity found.",
            metrics: {
                owner_identity_points: metrics.ownerIdentityPoints,
                has_owner_identity_evidence: metrics.hasOwnerIdentityEvidence,
                owner_name: metrics.ownerName,
            },
            completed_at: now,
        }
    }))
    await finishPollStage({
        workspaceId,
        pollId,
        stageKey: "owner_identity",
        targetCount: companyIds.length,
        inputCount: companyIds.length,
        passedCount: passed.length,
        failedCount: companyIds.length - passed.length,
        metrics: { owner_identity_rate: companyIds.length ? passed.length / companyIds.length : 0 },
    })
    return passed
}

export async function recordOwnerPhoneStage({ workspaceId, pollId, companyIds }: { workspaceId: string; pollId: string; companyIds: string[] }) {
    const companies = (await loadPollCompanies(workspaceId, pollId)).filter((company) => companyIds.includes(company.id))
    const claims = await loadClaims(workspaceId, pollId, companyIds)
    const now = new Date().toISOString()
    const passed: string[] = []
    await upsertCompanyStages(companies.map((company) => {
        const metrics = metricsForCompany(company, claims.get(company.id) ?? [])
        const hasOwnerPhone = Boolean(metrics.ownerName && metrics.ownerPhone && metrics.hasOwnerPhoneEvidence)
        if (hasOwnerPhone) passed.push(company.id)
        return {
            workspace_id: workspaceId,
            poll_id: pollId,
            company_id: company.id,
            stage_key: "owner_phone",
            status: hasOwnerPhone ? "passed" : "failed",
            source_keys: metrics.sourceKeys,
            score: metrics.ownerPhonePoints,
            reason: hasOwnerPhone ? "Source-backed owner phone evidence found for the discovered owner/principal." : "Owner identity exists, but no source-backed owner phone evidence was found.",
            metrics: {
                owner_phone_points: metrics.ownerPhonePoints,
                has_owner_phone_evidence: metrics.hasOwnerPhoneEvidence,
                owner_phone: metrics.ownerPhone,
            },
            completed_at: now,
        }
    }))
    await finishPollStage({
        workspaceId,
        pollId,
        stageKey: "owner_phone",
        targetCount: companyIds.length,
        inputCount: companyIds.length,
        passedCount: passed.length,
        failedCount: companyIds.length - passed.length,
        metrics: { owner_phone_rate: companyIds.length ? passed.length / companyIds.length : 0 },
    })
    return passed
}

export async function recordPhoneValidationStage({ workspaceId, pollId, companyIds }: { workspaceId: string; pollId: string; companyIds: string[] }) {
    const companies = (await loadPollCompanies(workspaceId, pollId)).filter((company) => companyIds.includes(company.id))
    const claims = await loadClaims(workspaceId, pollId, companyIds)
    const now = new Date().toISOString()
    const passed: string[] = []
    await upsertCompanyStages(companies.map((company) => {
        const metrics = metricsForCompany(company, claims.get(company.id) ?? [])
        const normalisedPhone = normalisePhone(metrics.ownerPhone)
        const callable = Boolean(metrics.ownerName && metrics.hasOwnerPhoneEvidence && phoneLooksCallable(normalisedPhone))
        if (callable) passed.push(company.id)
        return {
            workspace_id: workspaceId,
            poll_id: pollId,
            company_id: company.id,
            stage_key: "phone_validation",
            status: callable ? "passed" : "failed",
            source_keys: ["phone.basic_format_validation"],
            score: callable ? 1 : 0,
            reason: callable ? "Owner phone has a callable-length phone format. Line type is not verified yet." : "Owner phone could not be normalized into a callable phone format.",
            metrics: {
                owner_phone: metrics.ownerPhone,
                normalised_phone: normalisedPhone,
                line_type: "unknown",
                mobile: "unknown",
                validation_source: "phone.basic_format_validation",
            },
            completed_at: now,
        }
    }))
    await finishPollStage({
        workspaceId,
        pollId,
        stageKey: "phone_validation",
        targetCount: companyIds.length,
        inputCount: companyIds.length,
        passedCount: passed.length,
        failedCount: companyIds.length - passed.length,
        metrics: {
            callable_phone_rate: companyIds.length ? passed.length / companyIds.length : 0,
            line_type_verified: false,
        },
    })
    return passed
}
