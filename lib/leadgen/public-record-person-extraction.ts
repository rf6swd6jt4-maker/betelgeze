import { isLikelyPersonName, normalisePersonName } from "./person-name-normalizer.js"

export type PublicRecordPersonCandidate = {
    name: string
    role: string
    sourceField: string
    confidence: number
    reason: string
}

type FieldSpec = {
    fields: string[]
    role: string
    confidence: number
    reason: string
}

const DEFAULT_FIELD_SPECS: FieldSpec[] = [
    {
        fields: [
            "owner_name",
            "owner_full_name",
            "business_owner_name",
            "registered_owner_name",
            "RegisteredOwnerName",
            "registrant_name",
            "license_owner_name",
            "proprietor_name",
        ],
        role: "owner_or_registrant",
        confidence: 98,
        reason: "owner or registrant field",
    },
    {
        fields: [
            "qualifying_individual",
            "qualifier_name",
            "qualifying_party",
            "responsible_master_plumber",
            "responsible_applicator",
            "RESPONSIBLE_APPLICATOR",
            "certified_operator",
            "applicator_name",
            "operator_name",
            "OPERATOR",
            "licensee_name",
            "license_holder_name",
        ],
        role: "license_principal",
        confidence: 94,
        reason: "license principal field",
    },
    {
        fields: [
            "principal_name",
            "principal",
            "officer_name",
            "president_name",
            "manager_name",
            "managing_member_name",
            "member_name",
            "partner_name",
            "authorized_official_name",
            "authorized_official",
        ],
        role: "officer_or_principal",
        confidence: 88,
        reason: "officer or principal field",
    },
    {
        fields: [
            "registered_agent_name",
            "statutory_agent_name",
            "agent_name",
            "registered_agent",
        ],
        role: "registered_agent",
        confidence: 78,
        reason: "registered-agent field",
    },
    {
        fields: [
            "applicant_name",
            "permit_applicant",
            "contact_name",
            "primary_contact_name",
            "Point_of_Contact",
            "point_of_contact",
            "contact",
            "affiliated_customer_name",
        ],
        role: "contact_or_applicant",
        confidence: 68,
        reason: "contact or applicant field",
    },
]

const FIRST_MIDDLE_LAST_GROUPS = [
    { role: "owner_or_registrant", confidence: 98, prefix: "owner", first: ["owner_first_name"], middle: ["owner_middle_name"], last: ["owner_last_name"] },
    { role: "license_principal", confidence: 94, prefix: "principal", first: ["principal_first_name"], middle: ["principal_middle_name"], last: ["principal_last_name"] },
    { role: "officer_or_principal", confidence: 88, prefix: "officer", first: ["officer_first_name"], middle: ["officer_middle_name"], last: ["officer_last_name"] },
    { role: "registered_agent", confidence: 78, prefix: "registered_agent", first: ["registered_agent_first_name", "agent_first_name"], middle: ["registered_agent_middle_name", "agent_middle_name"], last: ["registered_agent_last_name", "agent_last_name"] },
    { role: "contact_or_applicant", confidence: 68, prefix: "applicant", first: ["applicant_first_name", "contact_first_name"], middle: ["applicant_middle_name", "contact_middle_name"], last: ["applicant_last_name", "contact_last_name"] },
]

const ROLE_PREFIX_PATTERN = /\b(?:owner|principal|qualifying(?:\s+individual|\s+party)?|registered\s+agent|statutory\s+agent|agent|officer|manager|member|president|partner|applicant|contact|operator|responsible\s+applicator|certified\s+operator|licensee|license\s+holder|authorized\s+official)\b/i
const ROLE_SUFFIX_PATTERN = /\b(?:owner|principal|qualifying(?:\s+individual|\s+party)?|registered\s+agent|statutory\s+agent|agent|officer|manager|member|president|vice\s+president|secretary|treasurer|partner|applicant|contact|operator|responsible\s+applicator|certified\s+operator|licensee|license\s+holder|authorized\s+official|rmp|qi)\b/i
const BUSINESS_WORD_PATTERN = /\b(?:LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|PLLC|PA|PC|DBA|D\/B\/A|SERVICES?|SYSTEMS?|GROUP|HOLDINGS?|ENTERPRISES?|CONSTRUCTION|CONTRACTORS?|HOMES?|BUILDERS?|ROOFING|PLUMBING|ELECTRIC|ELECTRICAL|HVAC|AIR\s+CONDITIONING|LANDSCAP(?:E|ING)|FLOORING|PAINTING|CLEANING|REMODELING|REMODELLING|PEST|WASTE|DISPOSAL|AUTO|AUTOMOTIVE|REPAIR|RECYCLING|COUNTY|CITY|STATE|DEPARTMENT|BOARD|DIVISION|TRUST|ESTATE|BANK|UNIVERSITY|SCHOOL|CHURCH)\b/i
const STATUS_WORD_PATTERN = /\b(?:active|inactive|expired|current|registered|open|closed|details|unknown|not\s+on\s+file|none|n\/a|na|null|pending|revoked|suspended)\b/i

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
    return (value ?? "")
        .replace(/\s+/g, " ")
        .replace(/\u00a0/g, " ")
        .trim()
}

function normaliseKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function rowValue(row: Record<string, unknown>, field: string) {
    const direct = asString(row[field])
    if (direct) return direct
    const wanted = normaliseKey(field)
    const matchingKey = Object.keys(row).find((key) => normaliseKey(key) === wanted)
    return matchingKey ? asString(row[matchingKey]) : null
}

function stripRoleText(value: string) {
    let clean = cleanText(value)
    clean = clean.replace(/^c\/o\s+/i, "")
    clean = clean.replace(/^attn\.?\s+/i, "")
    clean = clean.replace(new RegExp(`^${ROLE_PREFIX_PATTERN.source}\\s*[:\\-]\\s*`, "i"), "")
    clean = clean.replace(new RegExp(`\\s*[,;:/|\\-]\\s*${ROLE_SUFFIX_PATTERN.source}\\.?$`, "i"), "")
    clean = clean.replace(new RegExp(`\\s*\\(${ROLE_SUFFIX_PATTERN.source}\\.?\\)\\s*$`, "i"), "")
    clean = clean.replace(/\b(?:Jr|Sr|II|III|IV)\.$/i, (match) => match.replace(/\.$/, ""))
    return cleanText(clean)
}

function normaliseCommaName(value: string) {
    const clean = cleanText(value)
    const comma = clean.match(/^([A-Za-z][A-Za-z.' -]{1,45}),\s*([A-Za-z][A-Za-z.' -]{1,45})$/)
    if (!comma) return clean
    return cleanText(`${comma[2]} ${comma[1]}`)
}

export function normalisePublicRecordPersonName(value: string | null | undefined) {
    let clean = stripRoleText(value ?? "")
    if (!clean) return null
    clean = clean.replace(/\s+(?:and|&)\s+.+$/i, "")
    clean = clean.split(/[;\n|]/)[0] ?? clean
    clean = normaliseCommaName(stripRoleText(clean))
    return normalisePersonName(clean, { allowExtraction: true, allowAllCaps: true, ownerContext: true, minConfidence: 55 })
}

export function isLikelyPublicRecordPersonName(value: string | null | undefined) {
    const name = normalisePublicRecordPersonName(value)
    if (!name) return false
    if (name.length < 5 || name.length > 80) return false
    if (/\d|@|www\.|https?:/i.test(name)) return false
    if (BUSINESS_WORD_PATTERN.test(name)) return false
    if (STATUS_WORD_PATTERN.test(name)) return false
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length < 2 || parts.length > 6) return false
    const namePartPattern = /^(?:[A-Za-z][A-Za-z.'-]*|[A-Z])$/
    return parts.every((part) => namePartPattern.test(part)) && isLikelyPersonName(name, { allowAllCaps: true, ownerContext: true, minConfidence: 55 })
}

function candidateNamesFromValue(value: string | null | undefined) {
    const raw = cleanText(value ?? "")
    if (!raw) return []
    const candidates = [
        raw,
        ...raw.split(/[;\n|]/),
        ...raw.matchAll(new RegExp(`${ROLE_PREFIX_PATTERN.source}\\s*[:\\-]\\s*([A-Za-z][A-Za-z .',-]{3,80})`, "gi")).map((match) => match[1]),
    ]
    return candidates
        .map(normalisePublicRecordPersonName)
        .filter((candidate): candidate is string => Boolean(candidate && isLikelyPublicRecordPersonName(candidate)))
}

function addCandidate(candidates: PublicRecordPersonCandidate[], input: {
    name: string | null | undefined
    role: string
    sourceField: string
    confidence: number
    reason: string
}) {
    for (const name of candidateNamesFromValue(input.name)) {
        candidates.push({
            name,
            role: input.role,
            sourceField: input.sourceField,
            confidence: input.confidence,
            reason: input.reason,
        })
    }
}

function configuredFieldSpecs(metadata: Record<string, unknown>): FieldSpec[] {
    const fieldMap = asRecord(metadata.field_map)
    const configuredOwnerFields = asStringArray(fieldMap.owner_name)
    const configuredApplicantFields = asStringArray(fieldMap.applicant_name)
    const configuredPersonFields = asStringArray(fieldMap.person_name)
    return [
        configuredOwnerFields.length ? {
            fields: configuredOwnerFields,
            role: asString(metadata.person_role) ?? "configured_owner_identity",
            confidence: 100,
            reason: "configured owner-identity field",
        } : null,
        configuredPersonFields.length ? {
            fields: configuredPersonFields,
            role: asString(metadata.person_role) ?? "configured_person_identity",
            confidence: 94,
            reason: "configured person field",
        } : null,
        configuredApplicantFields.length ? {
            fields: configuredApplicantFields,
            role: "applicant_or_contact",
            confidence: 72,
            reason: "configured applicant field",
        } : null,
    ].filter((spec): spec is FieldSpec => Boolean(spec))
}

function sourceFieldsFromPatterns(row: Record<string, unknown>) {
    const fields: FieldSpec[] = []
    for (const key of Object.keys(row)) {
        const normalised = normaliseKey(key)
        if (/propertyowner|parcelowner|owneraddress|agentaddress|mailing/.test(normalised)) continue
        if (/owner.*name|registrant.*name/.test(normalised)) fields.push({ fields: [key], role: "owner_or_registrant", confidence: 92, reason: "owner-like field name" })
        else if (/qualif|applicator|operator|licensee|licenseholder/.test(normalised)) fields.push({ fields: [key], role: "license_principal", confidence: 88, reason: "license-principal field name" })
        else if (/officer|principal|manager|member|partner|authorizedofficial|president/.test(normalised)) fields.push({ fields: [key], role: "officer_or_principal", confidence: 82, reason: "principal-like field name" })
        else if (/registeredagent|statutoryagent/.test(normalised)) fields.push({ fields: [key], role: "registered_agent", confidence: 76, reason: "agent-like field name" })
        else if (/contact|applicant|pointofcontact/.test(normalised)) fields.push({ fields: [key], role: "contact_or_applicant", confidence: 64, reason: "contact-like field name" })
    }
    return fields
}

function addConfiguredNameParts(candidates: PublicRecordPersonCandidate[], row: Record<string, unknown>) {
    for (const group of FIRST_MIDDLE_LAST_GROUPS) {
        const first = group.first.map((field) => rowValue(row, field)).find(Boolean) ?? null
        const middle = group.middle.map((field) => rowValue(row, field)).find(Boolean) ?? null
        const last = group.last.map((field) => rowValue(row, field)).find(Boolean) ?? null
        const name = [first, middle, last].map((part) => cleanText(part ?? "")).filter(Boolean).join(" ")
        addCandidate(candidates, {
            name,
            role: group.role,
            sourceField: `${group.prefix}_first_middle_last`,
            confidence: group.confidence,
            reason: "first/middle/last fields",
        })
    }
}

function dedupeCandidates(candidates: PublicRecordPersonCandidate[]) {
    const bestByName = new Map<string, PublicRecordPersonCandidate>()
    for (const candidate of candidates) {
        const key = candidate.name.toLowerCase().replace(/[^a-z]/g, "")
        const existing = bestByName.get(key)
        if (!existing || candidate.confidence > existing.confidence) bestByName.set(key, candidate)
    }
    return [...bestByName.values()].sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name))
}

export function publicRecordPersonCandidates(row: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
    const candidates: PublicRecordPersonCandidate[] = []
    const specs = [
        ...configuredFieldSpecs(metadata),
        ...DEFAULT_FIELD_SPECS,
        ...sourceFieldsFromPatterns(row),
    ]
    for (const spec of specs) {
        for (const field of spec.fields) {
            addCandidate(candidates, {
                name: rowValue(row, field),
                role: spec.role,
                sourceField: field,
                confidence: spec.confidence,
                reason: spec.reason,
            })
        }
    }
    addConfiguredNameParts(candidates, row)
    return dedupeCandidates(candidates)
}

export function bestPublicRecordPerson(row: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
    return publicRecordPersonCandidates(row, metadata)[0] ?? null
}
