import { isLikelyPersonName, normalisePersonName } from "./person-name-normalizer.js"

type RecordLike = Record<string, unknown>

export type HillsboroughOfficialRecordRow = {
    business_name: string
    owner_name: string | null
    matched_party: string
    party_one: string | null
    party_two: string | null
    record_id: string | null
    record_type: string | null
    record_date: string | null
    status: string | null
    address: string | null
    source_url: string
}

const UNSAFE_PROPERTY_OWNER_WORD_PATTERN = /\b(?:LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|PLLC|PA|PC|DBA|D\/B\/A|TRUST|TRUSTEE|TR|TRS|ESTATE|HEIRS?|BANK|MORTGAGE|CHURCH|ASSOCIATION|ASSN|HOMEOWNERS|HOA|CONDO(?:MINIUM)?|PROPERTY|PROPERTIES|REALTY|REAL\s+ESTATE|MANAGEMENT|HOLDINGS?|INVESTMENTS?|PARTNERS?|GOVERNMENT|COUNTY|CITY|STATE|DEPARTMENT|BOARD|DIVISION|C\/O|ATTN)\b/i
const BUSINESS_WORD_PATTERN = /\b(?:LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|PLLC|PA|PC|DBA|D\/B\/A|SERVICES?|SYSTEMS?|GROUP|HOLDINGS?|ENTERPRISES?|CONSTRUCTION|CONTRACTORS?|HOMES?|BUILDERS?|ROOFING|PLUMBING|ELECTRIC|ELECTRICAL|HVAC|AIR\s+CONDITIONING|LANDSCAP(?:E|ING)|FLOORING|PAINTING|CLEANING|REMODELING|REMODELLING|PEST|WASTE|DISPOSAL|AUTO|AUTOMOTIVE|REPAIR|RECYCLING|COUNTY|CITY|STATE|DEPARTMENT|BOARD|DIVISION|TRUST|ESTATE|BANK|UNIVERSITY|SCHOOL|CHURCH)\b/i
const STATUS_WORD_PATTERN = /\b(?:active|inactive|expired|current|registered|open|closed|details|unknown|not\s+on\s+file|none|n\/a|na|null|pending|revoked|suspended)\b/i
const DBA_PATTERN = /\b(?:D\/B\/A|DBA|DOING\s+BUSINESS\s+AS)\b/i
const COMMON_GIVEN_NAME_KEYS = new Set([
    "ana", "andrew", "angel", "anthony", "antonio", "barbara", "ben", "brad", "brandon", "brian", "carlos", "charles",
    "chris", "christopher", "daniel", "david", "edward", "elizabeth", "emily", "eric", "frank", "gary", "george",
    "hector", "jack", "james", "jason", "jeff", "jennifer", "john", "jose", "joseph", "juan", "kevin", "laura",
    "linda", "lisa", "luis", "maria", "mark", "mary", "matthew", "michael", "michelle", "paul", "peter", "priya",
    "rafael", "ramon", "richard", "robert", "sam", "sarah", "scott", "stephen", "steven", "susan", "thomas",
    "tobias", "william",
])

function asRecord(value: unknown): RecordLike {
    return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : {}
}

function asString(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function cleanText(value: string | null | undefined) {
    return (value ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function uniqueStrings(values: Array<string | null | undefined>) {
    const seen = new Set<string>()
    const output: string[] = []
    for (const value of values) {
        const clean = cleanText(value)
        if (!clean) continue
        const key = clean.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        output.push(clean)
    }
    return output
}

export function splitCountyOwnerNames(value: string | null | undefined) {
    const clean = cleanText(value)
    if (!clean) return []
    return uniqueStrings(
        clean
            .split(/\s*(?:;|\n|\||\s+&\s+|\s+AND\s+)\s*/i)
            .map((part) => part.replace(/^\s*(?:OWNER|OWNERS?)\s*[:#-]\s*/i, "")),
    )
}

function looksUnsafePropertyOwnerName(value: string) {
    if (!value || value.length > 90) return true
    if (/\d|@|www\.|https?:/i.test(value)) return true
    return UNSAFE_PROPERTY_OWNER_WORD_PATTERN.test(value)
}

function normalisePublicRecordPersonName(value: string | null | undefined) {
    return normalisePersonName(value, { allowExtraction: true, allowAllCaps: true, ownerContext: true, minConfidence: 55 })
}

function isLikelyPublicRecordPersonName(value: string | null | undefined) {
    const name = normalisePublicRecordPersonName(value)
    if (!name || name.length < 5 || name.length > 80) return false
    if (/\d|@|www\.|https?:/i.test(name)) return false
    if (BUSINESS_WORD_PATTERN.test(name) || STATUS_WORD_PATTERN.test(name)) return false
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length < 2 || parts.length > 6) return false
    const namePartPattern = /^(?:[A-Za-z][A-Za-z.'-]*|[A-Z])$/
    return parts.every((part) => namePartPattern.test(part)) && isLikelyPersonName(name, { allowAllCaps: true, ownerContext: true, minConfidence: 55 })
}

function normaliseBusinessName(value: string | null | undefined) {
    return cleanText(value)
        .replace(/\b(?:d\/b\/a|dba|doing business as|aka|fka|formerly known as|llc|l\.l\.c\.|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pa|pc|professional association|professional corporation)\b\.?/gi, " ")
        .replace(/\b(?:and|&)\b/gi, " ")
        .replace(/[^a-z0-9]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
}

function businessTokens(value: string | null | undefined) {
    return normaliseBusinessName(value)
        .split(" ")
        .filter((token) => token.length >= 2)
        .filter((token) => !["and", "the", "services", "service", "contractor", "contractors", "construction", "group", "holdings"].includes(token))
}

function strongBusinessNameMatch(candidateName: string | null | undefined, recordName: string | null | undefined) {
    const left = normaliseBusinessName(candidateName)
    const right = normaliseBusinessName(recordName)
    if (!left || !right) return false
    if (left === right) return true
    const shorter = left.length <= right.length ? left : right
    const longer = left.length > right.length ? left : right
    if (shorter.length >= 5 && longer.includes(shorter)) return true
    const leftTokens = new Set(businessTokens(left))
    const rightTokens = new Set(businessTokens(right))
    if (leftTokens.size === 0 || rightTokens.size === 0) return false
    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length
    return shared / Math.max(leftTokens.size, rightTokens.size) >= 0.64
}

function maybeLastFirstName(value: string) {
    const clean = cleanText(value.replace(/,/g, " "))
    if (!/^[A-Z .'-]+$/.test(clean) || /[a-z]/.test(clean)) return clean
    const parts = clean.split(/\s+/).filter(Boolean)
    if (parts.length < 2 || parts.length > 4) return clean
    if (COMMON_GIVEN_NAME_KEYS.has(parts[0].toLowerCase())) return clean
    return [...parts.slice(1), parts[0]].join(" ")
}

function titleCaseName(value: string) {
    return cleanText(value)
        .toLowerCase()
        .replace(/\b([a-z])([a-z.'-]*)/g, (_match, first: string, rest: string) => `${first.toUpperCase()}${rest}`)
}

function preserveFullCountyName(candidate: string, normalised: string) {
    const titled = titleCaseName(candidate)
    const parts = titled.split(/\s+/).filter(Boolean)
    if (parts.length < 2 || parts.length > 4) return normalised
    if (!parts.every((part) => /^[A-Za-z][A-Za-z.'-]*$/.test(part))) return normalised
    const normalisedKey = normalised.toLowerCase()
    const titledKey = titled.toLowerCase()
    return titledKey === normalisedKey || titledKey.startsWith(`${normalisedKey} `) ? titled : normalised
}

export function cautiousCountyPropertyOwnerName(
    values: Array<string | null | undefined>,
    options: { lastNameFirst?: boolean } = {},
) {
    for (const part of values.flatMap(splitCountyOwnerNames)) {
        if (looksUnsafePropertyOwnerName(part)) continue
        const candidate = options.lastNameFirst ? maybeLastFirstName(part) : part
        const normalised = normalisePublicRecordPersonName(candidate)
        if (normalised && isLikelyPublicRecordPersonName(normalised)) return preserveFullCountyName(candidate, normalised)
    }
    return null
}

function partyList(value: unknown) {
    if (Array.isArray(value)) return uniqueStrings(value.map(asString))
    const clean = asString(value)
    return clean ? splitCountyOwnerNames(clean) : []
}

function recordDateFromUnixSeconds(value: unknown) {
    const seconds = Number(value)
    if (!Number.isFinite(seconds) || seconds <= 0) return null
    const date = new Date(seconds * 1000)
    if (!Number.isFinite(date.getTime())) return null
    return date.toISOString()
}

function sourceUrlForInstrument(instrument: string | null) {
    if (!instrument) return "https://publicaccess.hillsclerk.com/oripublicaccess/"
    return `https://publicaccess.hillsclerk.com/oripublicaccess/?instrument=${encodeURIComponent(instrument)}`
}

function matchedBusinessParty(parties: string[], candidateName: string, searchTerm: string) {
    return parties.find((party) => strongBusinessNameMatch(candidateName, party))
        ?? parties.find((party) => strongBusinessNameMatch(searchTerm, party))
        ?? null
}

export function cautiousClerkOwnerNameFromMatchedParty(party: string | null | undefined, candidateName: string) {
    const clean = cleanText(party)
    if (!clean || !DBA_PATTERN.test(clean)) return null
    const [humanSide, businessSide] = clean.split(DBA_PATTERN).map(cleanText)
    if (!humanSide || !businessSide) return null
    if (!strongBusinessNameMatch(candidateName, businessSide)) return null
    if (looksUnsafePropertyOwnerName(humanSide)) return null
    const normalised = normalisePublicRecordPersonName(maybeLastFirstName(humanSide))
    return normalised && isLikelyPublicRecordPersonName(normalised) ? normalised : null
}

export function hillsboroughOfficialRecordRowsFromResults(
    payload: unknown,
    context: { candidateName: string; searchTerm: string; maxRows?: number },
): HillsboroughOfficialRecordRow[] {
    const parsed = asRecord(payload)
    const results = Array.isArray(parsed.ResultList) ? parsed.ResultList.map(asRecord) : []
    const rows: HillsboroughOfficialRecordRow[] = []
    const maxRows = Math.min(25, Math.max(1, context.maxRows ?? 10))
    for (const result of results) {
        const partiesOne = partyList(result.PartiesOne)
        const partiesTwo = partyList(result.PartiesTwo)
        const matchedParty = matchedBusinessParty([...partiesOne, ...partiesTwo], context.candidateName, context.searchTerm)
        if (!matchedParty) continue
        const instrument = asString(result.Instrument)
        const recordDate = recordDateFromUnixSeconds(result.RecordDate)
        rows.push({
            business_name: matchedParty,
            owner_name: cautiousClerkOwnerNameFromMatchedParty(matchedParty, context.candidateName),
            matched_party: matchedParty,
            party_one: partiesOne.join("; ") || null,
            party_two: partiesTwo.join("; ") || null,
            record_id: instrument,
            record_type: asString(result.DocType),
            record_date: recordDate,
            status: recordDate ? `Recorded ${recordDate.slice(0, 10)}` : null,
            address: asString(result.Legal),
            source_url: sourceUrlForInstrument(instrument),
        })
        if (rows.length >= maxRows) break
    }
    return rows
}
