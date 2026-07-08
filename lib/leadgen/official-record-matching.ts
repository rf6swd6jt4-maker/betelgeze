type CandidateAddress = Record<string, unknown> | null | undefined

export type OfficialRecordCandidate = {
    display_name: string
    canonical_name?: string | null
    legal_name?: string | null
    dba_name?: string | null
    entity_number?: string | null
    filing_id?: string | null
    registered_address?: CandidateAddress
    known_aliases?: string[] | null
    identity_resolution?: Record<string, unknown> | null
    phone?: string | null
    website_domain?: string | null
    website_url?: string | null
    profile_url?: string | null
    source_record_id?: string | null
    address?: CandidateAddress
    latitude?: number | null
    longitude?: number | null
}

export type OfficialRecordAssessment = {
    matched: boolean
    confidence: number
    reasons: string[]
    signals: Record<string, unknown>
    bestRecordName: string | null
}

const LEGAL_SUFFIX_PATTERN = /\b(d\/b\/a|dba|doing business as|aka|fka|formerly known as|llc|l\.l\.c\.|inc|incorporated|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pa|pc|professional association|professional corporation)\b\.?/gi

const GENERIC_BUSINESS_TOKENS = new Set([
    "and",
    "the",
    "company",
    "co",
    "services",
    "service",
    "contractor",
    "contractors",
    "construction",
    "solutions",
    "systems",
    "group",
    "enterprise",
    "enterprises",
    "holdings",
])

const STREET_SUFFIXES = new Map([
    ["avenue", "ave"],
    ["ave", "ave"],
    ["boulevard", "blvd"],
    ["blvd", "blvd"],
    ["circle", "cir"],
    ["cir", "cir"],
    ["court", "ct"],
    ["ct", "ct"],
    ["drive", "dr"],
    ["dr", "dr"],
    ["highway", "hwy"],
    ["hwy", "hwy"],
    ["lane", "ln"],
    ["ln", "ln"],
    ["parkway", "pkwy"],
    ["pkwy", "pkwy"],
    ["place", "pl"],
    ["pl", "pl"],
    ["road", "rd"],
    ["rd", "rd"],
    ["street", "st"],
    ["st", "st"],
    ["suite", "ste"],
    ["ste", "ste"],
])

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

function normaliseBusinessToken(token: string) {
    const clean = token.toLowerCase().replace(/[^a-z0-9]/g, "")
    const replacements: Record<string, string> = {
        airconditioning: "hvac",
        auto: "automotive",
        automobile: "automotive",
        autos: "automotive",
        electrical: "electric",
        electrician: "electric",
        electricians: "electric",
        floors: "floor",
        flooring: "floor",
        gc: "general",
        heating: "hvac",
        hvacr: "hvac",
        landscapes: "landscape",
        landscaping: "landscape",
        lawncare: "landscape",
        painters: "paint",
        painting: "paint",
        pestcontrol: "pest",
        plumbers: "plumb",
        plumbing: "plumb",
        remodelers: "remodel",
        remodelling: "remodel",
        remodeling: "remodel",
        repairs: "repair",
        roofing: "roof",
        roofers: "roof",
    }
    const replaced = replacements[clean] ?? clean
    if (replaced.length > 4 && replaced.endsWith("s")) return replaced.slice(0, -1)
    return replaced
}

export function stripLegalSuffixes(value: string | null | undefined) {
    return cleanText(value ?? "")
        .replace(LEGAL_SUFFIX_PATTERN, " ")
        .replace(/\b(&|and)\b/gi, " ")
        .replace(/[^a-z0-9]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
}

function businessNameTokens(value: string | null | undefined, options: { dropGeneric?: boolean } = {}) {
    return stripLegalSuffixes(value)
        .split(" ")
        .map(normaliseBusinessToken)
        .filter((token) => token.length >= 2)
        .filter((token) => !options.dropGeneric || !GENERIC_BUSINESS_TOKENS.has(token))
}

export function nameTokens(value: string | null | undefined) {
    return businessNameTokens(value, { dropGeneric: true })
}

export function sharedTokenScore(left: string | null | undefined, right: string | null | undefined) {
    const leftTokens = new Set(nameTokens(left))
    const rightTokens = new Set(nameTokens(right))
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0
    const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length
    return shared / Math.max(leftTokens.size, rightTokens.size)
}

function nameAcronyms(value: string | null | undefined) {
    const tokens = businessNameTokens(value, { dropGeneric: true })
    const acronym = tokens.map((token) => token[0]).join("")
    return uniqueStrings([acronym.length >= 2 ? acronym : null, ...tokens.filter((token) => /^[a-z]{2,5}$/i.test(token))])
}

function trigrams(value: string) {
    const clean = `  ${value}  `
    if (clean.length < 3) return new Set([clean])
    const grams = new Set<string>()
    for (let index = 0; index <= clean.length - 3; index += 1) grams.add(clean.slice(index, index + 3))
    return grams
}

function trigramSimilarity(left: string, right: string) {
    if (!left || !right) return 0
    const leftTrigrams = trigrams(left)
    const rightTrigrams = trigrams(right)
    const shared = [...leftTrigrams].filter((gram) => rightTrigrams.has(gram)).length
    return (2 * shared) / (leftTrigrams.size + rightTrigrams.size)
}

function businessNameScore(left: string | null | undefined, right: string | null | undefined) {
    const leftCanonical = stripLegalSuffixes(left)
    const rightCanonical = stripLegalSuffixes(right)
    if (!leftCanonical || !rightCanonical) return 0
    if (leftCanonical === rightCanonical) return 1
    const shorter = leftCanonical.length <= rightCanonical.length ? leftCanonical : rightCanonical
    const longer = leftCanonical.length > rightCanonical.length ? leftCanonical : rightCanonical
    const containsScore = shorter.length >= 5 && longer.includes(shorter)
        ? Math.max(0.78, Math.min(0.95, shorter.length / longer.length + 0.32))
        : 0
    const tokenScore = sharedTokenScore(leftCanonical, rightCanonical)
    const trigramScore = trigramSimilarity(leftCanonical, rightCanonical) * 0.94
    const leftAcronyms = new Set(nameAcronyms(leftCanonical))
    const rightAcronyms = new Set(nameAcronyms(rightCanonical))
    const acronymScore = [...leftAcronyms].some((item) => rightAcronyms.has(item)) ? 0.72 : 0
    return Math.max(containsScore, tokenScore, trigramScore, acronymScore)
}

export function strongBusinessNameMatch(candidateName: string, ...recordNames: Array<string | null | undefined>) {
    return recordNames.some((recordName) => businessNameScore(candidateName, recordName) >= 0.64)
}

export function firstSearchTerm(candidateName: string) {
    const tokens = businessNameTokens(candidateName, { dropGeneric: true })
    return tokens.slice(0, Math.min(4, Math.max(1, tokens.length))).join(" ")
}

function searchSafeName(value: string | null | undefined) {
    return cleanText(value ?? "")
        .replace(LEGAL_SUFFIX_PATTERN, " ")
        .replace(/[^a-z0-9&'. -]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function nameVariants(value: string | null | undefined) {
    const clean = cleanText(value ?? "")
    if (!clean) return []
    const split = clean
        .replace(/\(([^)]+)\)/g, " | $1 ")
        .split(/\s+(?:d\/b\/a|dba|doing business as|aka|fka|formerly known as)\s+|\s+\|\s+|\s+-\s+/i)
    return uniqueStrings([clean, ...split, searchSafeName(clean), stripLegalSuffixes(clean)])
}

function candidateNameVariants(candidate: OfficialRecordCandidate) {
    const resolution = asRecord(candidate.identity_resolution)
    return uniqueStrings([
        ...nameVariants(candidate.display_name),
        ...nameVariants(candidate.legal_name),
        ...nameVariants(candidate.dba_name),
        ...asStringArray(candidate.known_aliases).flatMap(nameVariants),
        ...asStringArray(resolution.known_aliases).flatMap(nameVariants),
        ...asStringArray(resolution.aliases).flatMap(nameVariants),
        ...nameVariants(asString(resolution.legal_name)),
        ...nameVariants(asString(resolution.dba_name)),
        ...nameVariants(candidate.canonical_name),
        asString(asRecord(candidate.address).business_name),
        asString(asRecord(candidate.address).legal_name),
        asString(asRecord(candidate.address).dba_name),
    ])
}

function candidatePrimaryNames(candidate: OfficialRecordCandidate) {
    const resolution = asRecord(candidate.identity_resolution)
    return uniqueStrings([
        candidate.display_name,
        candidate.legal_name,
        candidate.dba_name,
        ...asStringArray(candidate.known_aliases),
        ...asStringArray(resolution.known_aliases),
        ...asStringArray(resolution.aliases),
        asString(resolution.legal_name),
        asString(resolution.dba_name),
        candidate.canonical_name,
    ])
}

function distinctiveSearchTerm(value: string | null | undefined) {
    const tokens = businessNameTokens(value, { dropGeneric: true })
    if (tokens.length === 0) return null
    if (tokens.length === 1) return tokens[0]
    return tokens.slice(0, 3).join(" ")
}

function phoneDigits(value: string | null | undefined) {
    const digits = value?.replace(/\D/g, "") ?? ""
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1)
    return digits.length >= 7 ? digits : null
}

function normalisePhone(value: string | null | undefined) {
    const digits = phoneDigits(value)
    if (!digits) return null
    if (digits.length === 10) return `+1${digits}`
    return digits.length === 11 && digits.startsWith("1") ? `+${digits}` : `+${digits}`
}

function domainFromUrl(value: string | null | undefined) {
    if (!value) return null
    try {
        return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "") || null
    } catch {
        const match = value.toLowerCase().match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/)
        return match?.[1] ?? null
    }
}

export function candidateDomain(candidate: OfficialRecordCandidate) {
    return domainFromUrl(candidate.website_domain) ?? domainFromUrl(candidate.website_url) ?? domainFromUrl(candidate.profile_url)
}

function registeredDomainKey(domain: string | null | undefined) {
    const clean = domain?.toLowerCase().replace(/^www\./, "") ?? ""
    const labels = clean.split(".").filter(Boolean)
    if (labels.length <= 2) return clean || null
    return labels.slice(-2).join(".")
}

function candidateStreet(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.address)
    return asString(address.street)
        ?? asString(address.address)
        ?? asString(address.street_address)
        ?? asString(address.address_1)
        ?? asString(address.line1)
}

function registeredStreet(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.registered_address)
    return asString(address.street)
        ?? asString(address.address)
        ?? asString(address.street_address)
        ?? asString(address.address_1)
        ?? asString(address.line1)
}

function candidateCity(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.address)
    return asString(address.city) ?? asString(address.locality) ?? asString(address.town) ?? asString(address.municipality)
}

function registeredCity(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.registered_address)
    return asString(address.city) ?? asString(address.locality) ?? asString(address.town) ?? asString(address.municipality)
}

function candidatePostcode(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.address)
    const value = asString(address.postcode) ?? asString(address.postal_code) ?? asString(address.zip)
    return value?.slice(0, 10) ?? null
}

function registeredPostcode(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.registered_address)
    const value = asString(address.postcode) ?? asString(address.postal_code) ?? asString(address.zip)
    return value?.slice(0, 10) ?? null
}

function candidateState(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.address)
    const direct = asString(address.state) ?? asString(address.region) ?? asString(address.state_code) ?? asString(address.region_code)
    return direct && /^[A-Z]{2}$/i.test(direct) ? direct.toUpperCase() : null
}

function registeredState(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.registered_address)
    const direct = asString(address.state) ?? asString(address.region) ?? asString(address.state_code) ?? asString(address.region_code)
    return direct && /^[A-Z]{2}$/i.test(direct) ? direct.toUpperCase() : null
}

export function buildOfficialRecordSearchTerms(candidate: OfficialRecordCandidate, options: { includeNonNameSignals?: boolean; maxTerms?: number } = {}) {
    const nameTerms: string[] = []
    const signalTerms: string[] = []
    const primaryNames = candidatePrimaryNames(candidate)
    nameTerms.push(...primaryNames)
    for (const name of uniqueStrings([...primaryNames, ...candidateNameVariants(candidate)])) {
        nameTerms.push(searchSafeName(name))
        nameTerms.push(stripLegalSuffixes(name))
        nameTerms.push(firstSearchTerm(name))
        const distinctive = distinctiveSearchTerm(name)
        if (distinctive) nameTerms.push(distinctive)
    }
    if (options.includeNonNameSignals) {
        const phone = phoneDigits(candidate.phone)
        const domain = candidateDomain(candidate)
        const street = candidateStreet(candidate)
        const registeredAddressStreet = registeredStreet(candidate)
        const postcode = candidatePostcode(candidate)
        const registeredAddressPostcode = registeredPostcode(candidate)
        const identifiers = candidateIdentifiers(candidate)
        if (phone) signalTerms.push(phone)
        signalTerms.push(...identifiers.slice(0, 3))
        if (domain) {
            signalTerms.push(domain)
            signalTerms.push(domain.split(".")[0])
        }
        if (registeredAddressStreet) signalTerms.push(registeredAddressStreet)
        if (street) signalTerms.push(street)
        if (registeredAddressPostcode) signalTerms.push(registeredAddressPostcode.slice(0, 5))
        if (postcode) signalTerms.push(postcode.slice(0, 5))
    }
    const maxTerms = Math.min(10, Math.max(1, options.maxTerms ?? (options.includeNonNameSignals ? 7 : 5)))
    const signals = uniqueStrings(signalTerms)
    const reservedNameSlots = options.includeNonNameSignals ? Math.max(4, maxTerms - signals.length) : maxTerms
    return uniqueStrings([
        ...uniqueStrings(nameTerms).slice(0, reservedNameSlots),
        ...signals,
        ...nameTerms,
    ])
        .filter((term) => term.length >= 2 && term.length <= 90)
        .slice(0, maxTerms)
}

function fieldsFromMap(metadata: Record<string, unknown>, key: string) {
    return asStringArray(asRecord(metadata.field_map)[key])
}

function recordBusinessNames(row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const configuredFields = [
        ...fieldsFromMap(metadata, "business_name"),
        ...fieldsFromMap(metadata, "contractor_name"),
        ...fieldsFromMap(metadata, "additional_match_name"),
        ...fieldsFromMap(metadata, "legal_name"),
        ...fieldsFromMap(metadata, "dba_name"),
    ]
    const genericFields = [
        "business_name",
        "legal_business_name",
        "legal_name",
        "dba_name",
        "trade_name",
        "fictitious_business_name",
        "company_name",
        "contractor_name",
        "contractor",
        "name",
        "entity_name",
        "organization_name",
        "organisation_name",
        "regulated_entity_name",
        "facility_name",
        "establishment_name",
        "recipient_name",
        "candidate_display_name",
        "registrant_name",
        "owner_business_name",
        "applicant_business_name",
        "BUSINESS_NAME",
        "LEGAL_BUSINESS_NAME",
        "DBA",
        "Contractor",
    ]
    return uniqueStrings([...configuredFields, ...genericFields].map((field) => pickString(row, [field])))
}

function recordPhoneValues(row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const configuredFields = fieldsFromMap(metadata, "phone")
    const genericFields = [
        "phone",
        "business_phone",
        "telephone",
        "telephone_number",
        "contact_phone",
        "owner_phone",
        "authorized_official_phone",
        "Cont Phone",
    ]
    const fieldValues = uniqueStrings([...configuredFields, ...genericFields].map((field) => pickString(row, [field])))
    const embeddedValues = Object.values(row).flatMap((value) => {
        const text = asString(value)
        return text ? [...text.matchAll(/\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/g)].map((match) => match[0]) : []
    })
    return uniqueStrings([...fieldValues, ...embeddedValues]).map(normalisePhone).filter((phone): phone is string => Boolean(phone))
}

function recordDomains(row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const fieldMap = asRecord(metadata.field_map)
    const configuredFields = [
        ...asStringArray(fieldMap.website),
        ...asStringArray(fieldMap.website_url),
        ...asStringArray(fieldMap.domain),
        ...asStringArray(fieldMap.email),
    ]
    const genericFields = Object.keys(row).filter((key) => {
        const lower = key.toLowerCase()
        if (lower === "source_url" || lower === "profile_url" || lower.includes("provenance")) return false
        return lower.includes("website") || lower.includes("domain") || lower.includes("email") || lower === "url" || lower === "common_name"
    })
    return uniqueStrings([...configuredFields, ...genericFields].flatMap((field) => {
        const value = asString(row[field])
        if (!value) return []
        const domains = [...value.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi)].map((match) => match[1])
        const emailDomain = value.match(/@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i)?.[1]
        return [domainFromUrl(value), emailDomain, ...domains]
    }))
}

function identifierValues(value: unknown) {
    const text = asString(value)
    if (!text) return []
    const direct = text.toUpperCase().replace(/[^A-Z0-9]/g, "")
    const chunks = [...text.matchAll(/\b[A-Z]{0,4}\d[A-Z0-9-]{3,}\b/gi)].map((match) => match[0].toUpperCase().replace(/[^A-Z0-9]/g, ""))
    return uniqueStrings([direct.length >= 5 ? direct : null, ...chunks])
}

function candidateIdentifiers(candidate: OfficialRecordCandidate) {
    const address = asRecord(candidate.address)
    const resolution = asRecord(candidate.identity_resolution)
    const fields = [
        candidate.entity_number,
        candidate.filing_id,
        candidate.source_record_id,
        asString(address.entity_id),
        asString(address.license_number),
        asString(address.taxpayer_id),
        asString(address.sos_file_number),
        asString(address.registration_number),
        asString(address.permit_number),
        asString(resolution.entity_number),
        asString(resolution.filing_id),
        asString(resolution.taxpayer_id),
        asString(resolution.sos_file_number),
        asString(resolution.registration_number),
    ]
    return uniqueStrings(fields.flatMap(identifierValues))
}

function recordIdentifiers(row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const configuredFields = fieldsFromMap(metadata, "record_id")
    const genericFields = Object.keys(row).filter((key) => /(?:id|number|num|license|licence|permit|registration|taxpayer|sos|npi|usdot|rn|cn)$/i.test(key))
    return uniqueStrings([...configuredFields, ...genericFields].flatMap((field) => identifierValues(row[field])))
}

function normalisePostcode(value: string | null | undefined) {
    return value?.replace(/[^\d]/g, "").slice(0, 5) || null
}

function normaliseStreet(value: string | null | undefined) {
    const clean = cleanText(value ?? "")
        .replace(/\b(?:suite|ste|unit|apt|apartment|#)\s*[a-z0-9-]+/gi, " ")
        .replace(/[^a-z0-9\s]/gi, " ")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
    return clean.split(" ")
        .map((token) => STREET_SUFFIXES.get(token) ?? token)
        .filter((token) => token.length > 1)
        .join(" ")
}

function streetNumber(value: string | null | undefined) {
    return cleanText(value ?? "").match(/\b\d{1,6}\b/)?.[0] ?? null
}

function streetCore(value: string | null | undefined) {
    return normaliseStreet(value)
        .split(" ")
        .filter((token) => !/^\d+$/.test(token))
        .filter((token) => !["ste", "suite", "unit", "apt"].includes(token))
        .join(" ")
}

function normaliseCity(value: string | null | undefined) {
    return cleanText(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function addressFromRow(row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const fieldMap = asRecord(metadata.field_map)
    const configuredState = asString(asRecord(metadata.default_address).state)
    const configuredCity = asString(asRecord(metadata.default_address).city)
    return {
        street: pickString(row, [
            ...asStringArray(fieldMap.address),
            "street",
            "address",
            "business_address",
            "mailing_address",
            "physical_address",
            "street_address",
            "Address",
            "BusinessAddress",
            "Street_Address",
        ]),
        city: pickString(row, [...asStringArray(fieldMap.city), "city", "City", "mailing_address_city"]) ?? configuredCity,
        state: pickString(row, [...asStringArray(fieldMap.state), "state", "State", "ST_CD", "mailing_address_state"]) ?? configuredState,
        postcode: pickString(row, [...asStringArray(fieldMap.postcode), "postcode", "postal_code", "zip", "Zip", "mailing_address_zip"]),
    }
}

function candidateAddressVariants(candidate: OfficialRecordCandidate) {
    return [
        {
            street: candidateStreet(candidate),
            city: candidateCity(candidate),
            state: candidateState(candidate),
            postcode: candidatePostcode(candidate),
            source: "seed_address",
        },
        {
            street: registeredStreet(candidate),
            city: registeredCity(candidate),
            state: registeredState(candidate),
            postcode: registeredPostcode(candidate),
            source: "registered_address",
        },
    ].filter((address) => address.street || address.city || address.state || address.postcode)
}

function rowPoint(row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const fieldMap = asRecord(metadata.field_map)
    for (const field of asStringArray(fieldMap.geopoint)) {
        const value = row[field]
        if (value && typeof value === "object") {
            const coordinates = (value as { coordinates?: unknown }).coordinates
            if (Array.isArray(coordinates) && coordinates.length >= 2) {
                const longitude = Number(coordinates[0])
                const latitude = Number(coordinates[1])
                if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude }
            }
        }
    }
    const latitude = Number(pickString(row, ["lat", "latitude", "Latitude"]))
    const longitude = Number(pickString(row, ["lon", "lng", "longitude", "Longitude"]))
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : { latitude: null, longitude: null }
}

function distanceMiles(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
    const radians = (degrees: number) => degrees * Math.PI / 180
    const earthMiles = 3958.8
    const dLat = radians(right.latitude - left.latitude)
    const dLon = radians(right.longitude - left.longitude)
    const lat1 = radians(left.latitude)
    const lat2 = radians(right.latitude)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
    return 2 * earthMiles * Math.asin(Math.sqrt(a))
}

function addressScore(candidate: OfficialRecordCandidate, row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const candidateAddresses = candidateAddressVariants(candidate)
    const recordAddress = addressFromRow(row, metadata)
    let best = { score: 0, stateConflicts: false, candidateAddress: candidateAddresses[0] ?? { street: null, city: null, state: null, postcode: null, source: "none" } }
    for (const candidateAddress of candidateAddresses) {
        const candidateStateValue = candidateAddress.state
        const recordStateValue = recordAddress.state && /^[A-Z]{2}$/i.test(recordAddress.state) ? recordAddress.state.toUpperCase() : null
        const stateConflicts = Boolean(candidateStateValue && recordStateValue && candidateStateValue !== recordStateValue)
        const candidateZip = normalisePostcode(candidateAddress.postcode)
        const recordZip = normalisePostcode(recordAddress.postcode)
        const zipMatches = Boolean(candidateZip && recordZip && candidateZip === recordZip)
        const cityMatches = Boolean(candidateAddress.city && recordAddress.city && normaliseCity(candidateAddress.city) === normaliseCity(recordAddress.city))
        const streetNumbersMatch = Boolean(candidateAddress.street && recordAddress.street && streetNumber(candidateAddress.street) && streetNumber(candidateAddress.street) === streetNumber(recordAddress.street))
        const candidateStreetCore = streetCore(candidateAddress.street)
        const recordStreetCore = streetCore(recordAddress.street)
        const streetMatches = Boolean(candidateStreetCore && recordStreetCore && (
            candidateStreetCore === recordStreetCore
            || candidateStreetCore.includes(recordStreetCore)
            || recordStreetCore.includes(candidateStreetCore)
            || sharedTokenScore(candidateStreetCore, recordStreetCore) >= 0.72
        ))
        let score = 0
        if (!stateConflicts) {
            if (streetNumbersMatch && streetMatches && zipMatches) score = Math.max(score, 0.97)
            else if (streetNumbersMatch && streetMatches && (cityMatches || Boolean(candidateStateValue && recordStateValue))) score = Math.max(score, 0.88)
            else if (streetMatches && zipMatches) score = Math.max(score, 0.84)
            else if (zipMatches && cityMatches) score = Math.max(score, 0.74)
            else if (streetMatches && cityMatches) score = Math.max(score, 0.72)
            else if (zipMatches) score = Math.max(score, 0.48)
            else if (cityMatches && candidateStateValue && recordStateValue) score = Math.max(score, 0.34)
        }
        if (score > best.score || (score === best.score && !stateConflicts && best.stateConflicts)) best = { score, stateConflicts, candidateAddress }
    }
    const recordPoint = rowPoint(row, metadata)
    let geoScore = 0
    if (typeof candidate.latitude === "number" && typeof candidate.longitude === "number" && typeof recordPoint.latitude === "number" && typeof recordPoint.longitude === "number") {
        const miles = distanceMiles(
            { latitude: candidate.latitude, longitude: candidate.longitude },
            { latitude: recordPoint.latitude, longitude: recordPoint.longitude }
        )
        if (miles <= 0.15) geoScore = Math.max(geoScore, 0.96)
        else if (miles <= 1) geoScore = Math.max(geoScore, 0.84)
        else if (miles <= 3) geoScore = Math.max(geoScore, 0.64)
    }
    return { score: Math.max(best.score, geoScore), stateConflicts: best.stateConflicts, candidateAddress: best.candidateAddress, recordAddress }
}

function bestNameMatch(candidate: OfficialRecordCandidate, recordNames: string[]) {
    const candidateNames = candidateNameVariants(candidate)
    let best = { score: 0, candidateName: null as string | null, recordName: null as string | null }
    for (const candidateName of candidateNames) {
        for (const recordName of recordNames) {
            const score = businessNameScore(candidateName, recordName)
            if (score > best.score) best = { score, candidateName, recordName }
        }
    }
    return best
}

function phoneMatchScore(candidate: OfficialRecordCandidate, row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const candidatePhone = normalisePhone(candidate.phone)
    const rowPhones = recordPhoneValues(row, metadata)
    if (!candidatePhone || rowPhones.length === 0) return { score: 0, candidatePhone, recordPhones: rowPhones }
    const candidateDigits = phoneDigits(candidatePhone)
    const exact = rowPhones.some((phone) => phone === candidatePhone)
    const lastSeven = rowPhones.some((phone) => {
        const rowDigits = phoneDigits(phone)
        return candidateDigits && rowDigits && candidateDigits.slice(-7) === rowDigits.slice(-7)
    })
    return { score: exact ? 1 : lastSeven ? 0.84 : 0, candidatePhone, recordPhones: rowPhones }
}

function domainMatchScore(candidate: OfficialRecordCandidate, row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const candidateValue = candidateDomain(candidate)
    const candidateKey = registeredDomainKey(candidateValue)
    const rowDomains = recordDomains(row, metadata)
    if (!candidateKey || rowDomains.length === 0) return { score: 0, candidateDomain: candidateValue, recordDomains: rowDomains }
    const exact = rowDomains.some((domain) => domain.toLowerCase().replace(/^www\./, "") === candidateKey || registeredDomainKey(domain) === candidateKey)
    return { score: exact ? 1 : 0, candidateDomain: candidateValue, recordDomains: rowDomains }
}

function identifierMatchScore(candidate: OfficialRecordCandidate, row: Record<string, unknown>, metadata: Record<string, unknown>) {
    const candidateValues = candidateIdentifiers(candidate)
    const rowValues = recordIdentifiers(row, metadata)
    const overlap = candidateValues.filter((value) => rowValues.includes(value))
    return { score: overlap.length > 0 ? 1 : 0, candidateIdentifiers: candidateValues, recordIdentifiers: rowValues, overlap }
}

export function assessOfficialRecordMatch(row: Record<string, unknown>, candidate: OfficialRecordCandidate, metadata: Record<string, unknown> = {}): OfficialRecordAssessment {
    const recordNames = recordBusinessNames(row, metadata)
    const name = bestNameMatch(candidate, recordNames)
    const address = addressScore(candidate, row, metadata)
    const phone = phoneMatchScore(candidate, row, metadata)
    const domain = domainMatchScore(candidate, row, metadata)
    const identifier = identifierMatchScore(candidate, row, metadata)
    const reasons: string[] = []
    let confidence = 0
    if (name.score >= 0.93) {
        confidence = Math.max(confidence, 91)
        reasons.push("near-exact business name")
    } else if (name.score >= 0.78) {
        confidence = Math.max(confidence, 84)
        reasons.push("strong business name")
    } else if (name.score >= 0.64) {
        confidence = Math.max(confidence, 76)
        reasons.push("probable business name")
    }
    if (identifier.score >= 1) {
        confidence = Math.max(confidence, 97)
        reasons.push("shared official identifier")
    }
    if (domain.score >= 1) {
        confidence = Math.max(confidence, 94)
        reasons.push("shared website domain")
    }
    if (phone.score >= 1) {
        confidence = Math.max(confidence, 93)
        reasons.push("exact business phone")
    } else if (phone.score >= 0.8) {
        confidence = Math.max(confidence, 88)
        reasons.push("matching local phone")
    }
    if (address.score >= 0.9) reasons.push("same street address")
    else if (address.score >= 0.7) reasons.push("compatible address")
    if (name.score >= 0.52 && address.score >= 0.7) confidence = Math.max(confidence, 88)
    if (name.score >= 0.42 && phone.score >= 0.8) confidence = Math.max(confidence, 91)
    if (name.score >= 0.42 && domain.score >= 1) confidence = Math.max(confidence, 91)
    if (name.score >= 0.34 && identifier.score >= 1) confidence = Math.max(confidence, 96)
    if (address.score >= 0.84 && phone.score >= 0.8) confidence = Math.max(confidence, 92)
    if (address.score >= 0.84 && domain.score >= 1) confidence = Math.max(confidence, 92)
    if (domain.score >= 1 && phone.score >= 0.8) confidence = Math.max(confidence, 94)
    if (name.score >= 0.58 && address.score >= 0.34) confidence = Math.max(confidence, 72)
    if (address.stateConflicts && identifier.score === 0 && domain.score === 0 && phone.score === 0) confidence = Math.min(confidence, 40)
    confidence = Math.max(0, Math.min(100, Math.round(confidence)))
    return {
        matched: confidence >= 72,
        confidence,
        reasons: uniqueStrings(reasons),
        bestRecordName: name.recordName,
        signals: {
            name_score: Number(name.score.toFixed(3)),
            address_score: Number(address.score.toFixed(3)),
            phone_score: Number(phone.score.toFixed(3)),
            domain_score: Number(domain.score.toFixed(3)),
            identifier_score: Number(identifier.score.toFixed(3)),
            best_candidate_name: name.candidateName,
            best_record_name: name.recordName,
            record_names: recordNames.slice(0, 8),
            record_phones: phone.recordPhones.slice(0, 4),
            record_domains: domain.recordDomains.slice(0, 4),
            identifier_overlap: identifier.overlap,
            candidate_address: address.candidateAddress,
            record_address: address.recordAddress,
            state_conflicts: address.stateConflicts,
        },
    }
}

export function officialRecordMatchesCandidate(row: Record<string, unknown>, candidate: OfficialRecordCandidate, metadata: Record<string, unknown> = {}) {
    return assessOfficialRecordMatch(row, candidate, metadata).matched
}

export function summarizeOfficialRecordRejections(rows: Record<string, unknown>[], candidate: OfficialRecordCandidate, metadata: Record<string, unknown>, limit = 5) {
    return rows
        .map((row) => assessOfficialRecordMatch(row, candidate, metadata))
        .sort((left, right) => right.confidence - left.confidence)
        .slice(0, limit)
        .map((assessment) => ({
            confidence: assessment.confidence,
            matched: assessment.matched,
            best_record_name: assessment.bestRecordName,
            reasons: assessment.reasons,
            signals: assessment.signals,
        }))
}
