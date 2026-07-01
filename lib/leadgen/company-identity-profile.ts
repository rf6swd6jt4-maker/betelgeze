export type CompanyIdentityFields = {
    legal_name?: string | null
    dba_name?: string | null
    entity_number?: string | null
    filing_id?: string | null
    registered_address?: Record<string, unknown> | null
    known_aliases?: string[] | null
    identity_resolution?: Record<string, unknown> | null
    identity_source_key?: string | null
    identity_confidence?: number | null
    identity_resolved_at?: string | null
}

export type CompanyIdentityProfile = {
    legalName: string | null
    dbaName: string | null
    entityNumber: string | null
    filingId: string | null
    registeredAddress: Record<string, unknown>
    knownAliases: string[]
    sourceKey: string
    sourceLabel: string | null
    confidence: number
    status: string | null
    recordType: string | null
    raw: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function asStringArray(value: unknown) {
    return Array.isArray(value) ? value.map(asString).filter((item): item is string => Boolean(item)) : []
}

function cleanText(value: string | null | undefined) {
    return (value ?? "").replace(/\s+/g, " ").trim()
}

function pickString(row: Record<string, unknown>, fields: string[]) {
    for (const field of fields) {
        const value = asString(row[field])
        if (value) return value
    }
    return null
}

function uniqueStrings(values: Array<string | null | undefined>) {
    const seen = new Set<string>()
    const output: string[] = []
    for (const value of values) {
        const clean = cleanText(value ?? "")
        if (!clean) continue
        const key = clean.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        output.push(clean)
    }
    return output
}

function normaliseIdentifier(value: string | null | undefined) {
    const clean = cleanText(value ?? "")
    if (!clean) return null
    const compact = clean.toUpperCase().replace(/[^A-Z0-9-]/g, "")
    return compact.length >= 3 ? compact : clean
}

function isLikelyBusinessName(value: string | null | undefined) {
    const clean = cleanText(value ?? "")
    if (!clean) return false
    if (/^\d+$/.test(clean)) return false
    if (clean.length < 3 || clean.length > 120) return false
    if (/\b(active|inactive|open|closed|current|expired|registered|details|owner|operator|agent|manager|member)\b/i.test(clean)) return false
    return /[a-z]/i.test(clean)
}

function firstPresentAddress(row: Record<string, unknown>, fieldSets: Array<{ street: string[]; city: string[]; state: string[]; postcode: string[]; label: string }>) {
    for (const fields of fieldSets) {
        const street = pickString(row, fields.street)
        const city = pickString(row, fields.city)
        const state = pickString(row, fields.state)
        const postcode = pickString(row, fields.postcode)
        if (street || city || state || postcode) {
            return {
                street,
                city,
                state,
                postcode,
                country: "US",
                source: fields.label,
            }
        }
    }
    return {}
}

function registeredAddressFromRecord(row: Record<string, unknown>) {
    return firstPresentAddress(row, [
        {
            label: "registered_office",
            street: ["registered_office_address_street", "registered_address_street", "registered_street", "registered_address"],
            city: ["registered_office_address_city", "registered_address_city", "registered_city"],
            state: ["registered_office_address_state", "registered_address_state", "registered_state"],
            postcode: ["registered_office_address_zip", "registered_address_zip", "registered_postcode", "registered_zip"],
        },
        {
            label: "mailing_address",
            street: ["mailing_address_street", "mailing_address", "mailing_street"],
            city: ["mailing_address_city", "mailing_city"],
            state: ["mailing_address_state", "mailing_state"],
            postcode: ["mailing_address_zip", "mailing_zip", "mailing_postcode"],
        },
        {
            label: "business_address",
            street: ["business_address", "BusinessAddress", "street", "Street_Address", "address", "physical_address"],
            city: ["business_city", "BusinessCity", "city", "City"],
            state: ["business_state", "BusinessState", "state", "State"],
            postcode: ["business_zip", "BusinessZipCode", "postcode", "postal_code", "zip", "Zip", "ZIP_Code"],
        },
    ])
}

function bestBusinessNames(row: Record<string, unknown>) {
    const explicitLegal = pickString(row, [
        "legal_name",
        "legal_business_name",
        "LEGAL_BUSINESS_NAME",
        "entity_name",
        "organization_name",
        "organisation_name",
        "Reporting_Agency_Legal_Name",
        "name",
    ])
    const explicitDba = pickString(row, [
        "dba_name",
        "DBA",
        "trade_name",
        "fictitious_business_name",
        "BusinessName",
        "business_name",
        "company_name",
        "contractor_name",
        "Contractor",
        "regulated_entity_name",
        "facility_name",
        "establishment_name",
    ])
    const businessName = pickString(row, [
        "business_name",
        "company_name",
        "contractor_name",
        "Contractor",
        "BusinessName",
        "regulated_entity_name",
        "facility_name",
        "establishment_name",
        "recipient_name",
    ])
    const legalName = explicitLegal ?? businessName
    const dbaName = explicitDba && legalName && explicitDba.toLowerCase() !== legalName.toLowerCase() ? explicitDba : null
    return { legalName, dbaName, businessName }
}

export function extractCompanyIdentityProfile(row: Record<string, unknown>, context: {
    sourceKey: string
    sourceLabel?: string | null
    confidence?: number | null
    seedDisplayName?: string | null
}): CompanyIdentityProfile | null {
    const { legalName, dbaName, businessName } = bestBusinessNames(row)
    const entityNumber = normaliseIdentifier(pickString(row, [
        "entity_number",
        "taxpayer_id",
        "taxpayerId",
        "registration_number",
        "document_number",
        "corp_number",
        "corporation_number",
        "sos_file_number",
        "fei_number",
        "npi",
        "usdot_number",
    ]))
    const filingId = normaliseIdentifier(pickString(row, [
        "filing_id",
        "filing_number",
        "FilingNumber",
        "sos_file_number",
        "license_number",
        "permit_number",
        "record_id",
        "rn_number",
        "cn_number",
    ]))
    const registeredAddress = registeredAddressFromRecord(row)
    const aliases = uniqueStrings([
        context.seedDisplayName,
        legalName,
        dbaName,
        businessName,
        pickString(row, ["candidate_display_name", "additional_match_name", "Site_Name"]),
    ]).filter(isLikelyBusinessName)
    const hasAddress = Object.values(registeredAddress).some(Boolean)
    if (!legalName && !dbaName && !entityNumber && !filingId && !hasAddress && aliases.length <= 1) return null
    const confidence = Math.min(100, Math.max(0, Math.round(context.confidence ?? 70)))
    return {
        legalName: isLikelyBusinessName(legalName) ? legalName : null,
        dbaName: isLikelyBusinessName(dbaName) ? dbaName : null,
        entityNumber,
        filingId,
        registeredAddress,
        knownAliases: aliases,
        sourceKey: context.sourceKey,
        sourceLabel: context.sourceLabel ?? null,
        confidence,
        status: pickString(row, ["status", "license_status", "primary_status", "sos_registration_status", "right_to_transact_tx"]),
        recordType: pickString(row, ["record_type", "license_type", "entity_type", "BusinessType"]),
        raw: row,
    }
}

function existingAliases(existing: CompanyIdentityFields) {
    const resolution = asRecord(existing.identity_resolution)
    return uniqueStrings([
        ...asStringArray(existing.known_aliases),
        ...asStringArray(resolution.known_aliases),
        ...asStringArray(resolution.aliases),
        existing.legal_name,
        existing.dba_name,
    ])
}

export function mergeCompanyIdentity(existing: CompanyIdentityFields, incomingProfiles: CompanyIdentityProfile[]) {
    const profiles = incomingProfiles.filter(Boolean).sort((left, right) => right.confidence - left.confidence)
    const best = profiles[0]
    if (!best) return null
    const existingConfidence = typeof existing.identity_confidence === "number" ? existing.identity_confidence : 0
    const keepExisting = existingConfidence > best.confidence
    const legalName = keepExisting ? existing.legal_name ?? best.legalName : best.legalName ?? existing.legal_name ?? null
    const dbaName = keepExisting ? existing.dba_name ?? best.dbaName : best.dbaName ?? existing.dba_name ?? null
    const entityNumber = keepExisting ? existing.entity_number ?? best.entityNumber : best.entityNumber ?? existing.entity_number ?? null
    const filingId = keepExisting ? existing.filing_id ?? best.filingId : best.filingId ?? existing.filing_id ?? null
    const registeredAddress = Object.keys(best.registeredAddress).length > 0 && !keepExisting
        ? best.registeredAddress
        : asRecord(existing.registered_address).street || asRecord(existing.registered_address).city
            ? asRecord(existing.registered_address)
            : best.registeredAddress
    const knownAliases = uniqueStrings([
        ...existingAliases(existing),
        legalName,
        dbaName,
        ...profiles.flatMap((profile) => profile.knownAliases),
    ]).filter(isLikelyBusinessName).slice(0, 20)
    const confidence = Math.max(existingConfidence, best.confidence)
    return {
        legal_name: legalName,
        dba_name: dbaName,
        entity_number: entityNumber,
        filing_id: filingId,
        registered_address: registeredAddress,
        known_aliases: knownAliases,
        identity_source_key: keepExisting ? existing.identity_source_key ?? best.sourceKey : best.sourceKey,
        identity_confidence: confidence,
        identity_resolved_at: new Date().toISOString(),
        identity_resolution: {
            legal_name: legalName,
            dba_name: dbaName,
            entity_number: entityNumber,
            filing_id: filingId,
            registered_address: registeredAddress,
            known_aliases: knownAliases,
            confidence,
            primary_source_key: keepExisting ? existing.identity_source_key ?? best.sourceKey : best.sourceKey,
            primary_source_label: keepExisting ? asString(asRecord(existing.identity_resolution).primary_source_label) ?? best.sourceLabel : best.sourceLabel,
            status: best.status,
            record_type: best.recordType,
            profile_count: profiles.length,
            profiles: profiles.slice(0, 5).map((profile) => ({
                source_key: profile.sourceKey,
                source_label: profile.sourceLabel,
                confidence: profile.confidence,
                legal_name: profile.legalName,
                dba_name: profile.dbaName,
                entity_number: profile.entityNumber,
                filing_id: profile.filingId,
                status: profile.status,
                record_type: profile.recordType,
            })),
        },
    }
}

export function identityUpdatePayload(identity: NonNullable<ReturnType<typeof mergeCompanyIdentity>>) {
    return {
        legal_name: identity.legal_name,
        dba_name: identity.dba_name,
        entity_number: identity.entity_number,
        filing_id: identity.filing_id,
        registered_address: identity.registered_address,
        known_aliases: identity.known_aliases,
        identity_resolution: identity.identity_resolution,
        identity_source_key: identity.identity_source_key,
        identity_confidence: identity.identity_confidence,
        identity_resolved_at: identity.identity_resolved_at,
    }
}
