export type LeadgenLocationTarget = {
    value: string
    label?: string | null
    location_kind?: string | null
    country?: string | null
    region?: string | null
    locality?: string | null
    metadata?: Record<string, unknown> | null
}

export type CompanyLocationCandidate = {
    address?: Record<string, unknown> | null
    registered_address?: Record<string, unknown> | null
    location_value?: string | null
    industry_value?: string | null
    website_domain?: string | null
    website_url?: string | null
}

type StaticLocationTarget = LeadgenLocationTarget & {
    cityAliases?: string[]
    countyAliases?: string[]
}

export type LocationSignals = {
    targetStates: Set<string>
    addressStates: Set<string>
    states: Set<string>
    targetCities: Set<string>
    addressCities: Set<string>
    cities: Set<string>
    targetCounties: Set<string>
    addressCounties: Set<string>
    counties: Set<string>
    postcode: string | null
}

const US_STATE_CODES = new Set([
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
])

const STATE_NAME_TO_CODE: Record<string, string> = {
    alabama: "AL",
    alaska: "AK",
    arizona: "AZ",
    arkansas: "AR",
    california: "CA",
    colorado: "CO",
    connecticut: "CT",
    delaware: "DE",
    florida: "FL",
    georgia: "GA",
    hawaii: "HI",
    idaho: "ID",
    illinois: "IL",
    indiana: "IN",
    iowa: "IA",
    kansas: "KS",
    kentucky: "KY",
    louisiana: "LA",
    maine: "ME",
    maryland: "MD",
    massachusetts: "MA",
    michigan: "MI",
    minnesota: "MN",
    mississippi: "MS",
    missouri: "MO",
    montana: "MT",
    nebraska: "NE",
    nevada: "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    ohio: "OH",
    oklahoma: "OK",
    oregon: "OR",
    pennsylvania: "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    tennessee: "TN",
    texas: "TX",
    utah: "UT",
    vermont: "VT",
    virginia: "VA",
    washington: "WA",
    "west virginia": "WV",
    wisconsin: "WI",
    wyoming: "WY",
    "district of columbia": "DC",
}

const STATE_CODE_TO_NAME = Object.fromEntries(Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name]))

const PILOT_LOCATION_TARGETS: Record<string, StaticLocationTarget> = {
    texas: { value: "texas", label: "Texas", location_kind: "state", country: "US", region: "TX" },
    florida: { value: "florida", label: "Florida", location_kind: "state", country: "US", region: "FL" },
    california: { value: "california", label: "California", location_kind: "state", country: "US", region: "CA" },
    arizona: { value: "arizona", label: "Arizona", location_kind: "state", country: "US", region: "AZ" },
    "north_carolina": { value: "north_carolina", label: "North Carolina", location_kind: "state", country: "US", region: "NC" },

    dallas_tx: { value: "dallas_tx", label: "Dallas, TX", location_kind: "city", country: "US", region: "TX", locality: "Dallas", cityAliases: ["Dallas"], countyAliases: ["Dallas"] },
    fort_worth_tx: { value: "fort_worth_tx", label: "Fort Worth, TX", location_kind: "city", country: "US", region: "TX", locality: "Fort Worth", cityAliases: ["Fort Worth"], countyAliases: ["Tarrant"] },
    dfw_tx: { value: "dfw_tx", label: "Dallas-Fort Worth, TX", location_kind: "metro", country: "US", region: "TX", locality: "Dallas-Fort Worth", cityAliases: ["Dallas", "Fort Worth"], countyAliases: ["Dallas", "Tarrant"] },
    austin_tx: { value: "austin_tx", label: "Austin, TX", location_kind: "city", country: "US", region: "TX", locality: "Austin", cityAliases: ["Austin"], countyAliases: ["Travis"] },
    houston_tx: { value: "houston_tx", label: "Houston, TX", location_kind: "city", country: "US", region: "TX", locality: "Houston", cityAliases: ["Houston"], countyAliases: ["Harris"] },
    greater_houston_tx: { value: "greater_houston_tx", label: "Greater Houston, TX", location_kind: "metro", country: "US", region: "TX", locality: "Houston", cityAliases: ["Houston"], countyAliases: ["Harris", "Fort Bend", "Montgomery"] },
    san_antonio_tx: { value: "san_antonio_tx", label: "San Antonio, TX", location_kind: "city", country: "US", region: "TX", locality: "San Antonio", cityAliases: ["San Antonio"], countyAliases: ["Bexar"] },

    miami_fl: { value: "miami_fl", label: "Miami, FL", location_kind: "city", country: "US", region: "FL", locality: "Miami", cityAliases: ["Miami"], countyAliases: ["Miami-Dade"] },
    orlando_fl: { value: "orlando_fl", label: "Orlando, FL", location_kind: "city", country: "US", region: "FL", locality: "Orlando", cityAliases: ["Orlando"], countyAliases: ["Orange"] },
    tampa_fl: { value: "tampa_fl", label: "Tampa, FL", location_kind: "city", country: "US", region: "FL", locality: "Tampa", cityAliases: ["Tampa"], countyAliases: ["Hillsborough"] },
    jacksonville_fl: { value: "jacksonville_fl", label: "Jacksonville, FL", location_kind: "city", country: "US", region: "FL", locality: "Jacksonville", cityAliases: ["Jacksonville"], countyAliases: ["Duval"] },

    los_angeles_ca: { value: "los_angeles_ca", label: "Los Angeles, CA", location_kind: "city", country: "US", region: "CA", locality: "Los Angeles", cityAliases: ["Los Angeles"], countyAliases: ["Los Angeles"] },
    san_diego_ca: { value: "san_diego_ca", label: "San Diego, CA", location_kind: "city", country: "US", region: "CA", locality: "San Diego", cityAliases: ["San Diego"], countyAliases: ["San Diego"] },
    bay_area_ca: { value: "bay_area_ca", label: "Bay Area, CA", location_kind: "metro", country: "US", region: "CA", locality: "San Francisco Bay Area", cityAliases: ["San Francisco", "Oakland", "San Jose"], countyAliases: ["San Francisco", "Alameda", "Santa Clara", "San Mateo"] },
    san_francisco_ca: { value: "san_francisco_ca", label: "San Francisco, CA", location_kind: "city", country: "US", region: "CA", locality: "San Francisco", cityAliases: ["San Francisco"], countyAliases: ["San Francisco"] },
    oakland_ca: { value: "oakland_ca", label: "Oakland, CA", location_kind: "city", country: "US", region: "CA", locality: "Oakland", cityAliases: ["Oakland"], countyAliases: ["Alameda"] },
    san_jose_ca: { value: "san_jose_ca", label: "San Jose, CA", location_kind: "city", country: "US", region: "CA", locality: "San Jose", cityAliases: ["San Jose"], countyAliases: ["Santa Clara"] },

    phoenix_az: { value: "phoenix_az", label: "Phoenix, AZ", location_kind: "city", country: "US", region: "AZ", locality: "Phoenix", cityAliases: ["Phoenix"], countyAliases: ["Maricopa"] },
    tucson_az: { value: "tucson_az", label: "Tucson, AZ", location_kind: "city", country: "US", region: "AZ", locality: "Tucson", cityAliases: ["Tucson"], countyAliases: ["Pima"] },
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

function titleCaseSlug(value: string) {
    return value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .trim()
}

function normaliseText(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function normaliseCoveragePlace(value: string | null | undefined) {
    return normaliseText(value ?? "")
}

export function normalizeStateCode(value: unknown) {
    const raw = asString(value)
    if (!raw) return null
    const trimmed = raw.trim()
    const exactCode = trimmed.toUpperCase().replace(/^US[-_\s]/, "")
    if (/^[A-Z]{2}$/.test(exactCode) && US_STATE_CODES.has(exactCode)) return exactCode
    const name = normaliseText(trimmed)
    return STATE_NAME_TO_CODE[name] ?? null
}

function stateCodesFromFreeform(value: unknown) {
    const text = asString(value)
    if (!text) return []
    const states = new Set<string>()
    const normalised = normaliseText(text)
    for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
        if (new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`).test(normalised)) states.add(code)
    }
    for (const match of text.toUpperCase().matchAll(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/g)) {
        states.add(match[1])
    }
    return [...states]
}

function postcodeFromFreeform(value: unknown) {
    const text = asString(value)
    return text?.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? null
}

function citiesFromFreeform(value: unknown) {
    const text = asString(value)
    if (!text) return []
    const stateAlternatives = [
        ...Object.keys(STATE_NAME_TO_CODE).map((name) => name.replace(/\s+/g, "\\s+")),
        ...US_STATE_CODES,
    ].join("|")
    const cities: string[] = []
    for (const match of text.matchAll(new RegExp(`(?:^|,)\\s*([^,]+?)\\s*,\\s*(?:${stateAlternatives})\\b`, "gi"))) {
        const city = match[1]?.trim()
        if (city && !/\d/.test(city)) cities.push(city)
    }
    return cities
}

function normaliseCounty(value: string | null | undefined) {
    return normaliseText((value ?? "").replace(/\b(county|parish|borough)\b/gi, ""))
}

function addNormalised(set: Set<string>, value: string | null | undefined) {
    const normalised = normaliseCoveragePlace(value)
    if (normalised) set.add(normalised)
}

function addCounty(set: Set<string>, value: string | null | undefined) {
    const normalised = normaliseCounty(value)
    if (normalised) set.add(normalised)
}

function addState(set: Set<string>, value: unknown) {
    const state = normalizeStateCode(value)
    if (state) set.add(state)
}

function stateFromLocationValue(value: string | null | undefined) {
    const raw = asString(value)
    if (!raw) return null
    if (PILOT_LOCATION_TARGETS[raw]?.region) return normalizeStateCode(PILOT_LOCATION_TARGETS[raw].region)
    const suffix = raw.match(/_([a-z]{2})$/i)?.[1]?.toUpperCase()
    if (suffix && US_STATE_CODES.has(suffix)) return suffix
    return normalizeStateCode(raw)
}

function inferredTargetFromValue(value: string | null | undefined): StaticLocationTarget | null {
    const raw = asString(value)
    if (!raw) return null
    const known = PILOT_LOCATION_TARGETS[raw]
    if (known) return known
    const state = stateFromLocationValue(raw)
    if (!state) return null
    const stateName = STATE_CODE_TO_NAME[state]
    const citySlug = raw.replace(new RegExp(`_${state.toLowerCase()}$`, "i"), "")
    const locationKind = citySlug && citySlug !== raw ? "city" : "state"
    const locality = locationKind === "city" ? titleCaseSlug(citySlug) : null
    return {
        value: raw,
        label: locality ? `${locality}, ${state}` : titleCaseSlug(stateName ?? raw),
        location_kind: locationKind,
        country: "US",
        region: state,
        locality,
        cityAliases: locality ? [locality] : [],
    }
}

function mergeTarget(value: string | null | undefined, targetLookup?: Map<string, LeadgenLocationTarget>) {
    const key = asString(value)
    if (!key) return null
    const fallback = inferredTargetFromValue(key)
    const mapped = targetLookup?.get(key) ?? null
    if (!fallback && !mapped) return null
    const metadata = {
        ...asRecord(fallback?.metadata),
        ...asRecord(mapped?.metadata),
    }
    return {
        ...fallback,
        ...mapped,
        value: key,
        metadata,
        cityAliases: [
            ...asStringArray((fallback as StaticLocationTarget | null)?.cityAliases),
            ...asStringArray(metadata.city_aliases),
            ...asStringArray(metadata.cities),
            asString(mapped?.locality),
        ].filter((city): city is string => Boolean(city)),
        countyAliases: [
            ...asStringArray((fallback as StaticLocationTarget | null)?.countyAliases),
            ...asStringArray(metadata.county_aliases),
            ...asStringArray(metadata.counties),
            asString(metadata.county),
        ].filter((county): county is string => Boolean(county)),
    }
}

function addTargetSignals(target: ReturnType<typeof mergeTarget>, signals: Pick<LocationSignals, "targetStates" | "targetCities" | "targetCounties">) {
    if (!target) return
    addState(signals.targetStates, target.region)
    addState(signals.targetStates, target.value)
    const kind = asString(target.location_kind) ?? asString(asRecord(target.metadata).location_kind)
    const isStateOnly = kind === "state"
    if (!isStateOnly) {
        for (const city of target.cityAliases) addNormalised(signals.targetCities, city)
        if (!target.cityAliases.length) addNormalised(signals.targetCities, asString(target.locality))
    }
    for (const county of target.countyAliases) addCounty(signals.targetCounties, county)
}

function addAddressSignals(value: unknown, signals: Pick<LocationSignals, "addressStates" | "addressCities" | "addressCounties"> & { postcodes: string[] }) {
    const address = asRecord(value)
    if (Object.keys(address).length === 0) return
    for (const field of ["state", "region", "state_code", "region_code", "province"]) addState(signals.addressStates, address[field])
    for (const field of ["freeform", "formatted", "label", "full", "display_name"]) {
        for (const state of stateCodesFromFreeform(address[field])) signals.addressStates.add(state)
        for (const city of citiesFromFreeform(address[field])) addNormalised(signals.addressCities, city)
        const postcode = postcodeFromFreeform(address[field])
        if (postcode) signals.postcodes.push(postcode)
    }
    for (const field of ["city", "locality", "town", "municipality"]) addNormalised(signals.addressCities, asString(address[field]))
    for (const field of ["county", "county_name", "parish", "borough"]) addCounty(signals.addressCounties, asString(address[field]))
    const postcode = asString(address.postcode) ?? asString(address.postal_code) ?? asString(address.zip) ?? asString(address.zip_code)
    if (postcode) signals.postcodes.push(postcode.slice(0, 10))
}

export function locationTargetMapFromRows(rows: LeadgenLocationTarget[]) {
    return new Map(rows.map((row) => [row.value, row]))
}

export function locationSignalsForCompany(company: CompanyLocationCandidate, targetLookup?: Map<string, LeadgenLocationTarget>): LocationSignals {
    const signals: LocationSignals & { postcodes: string[] } = {
        targetStates: new Set(),
        addressStates: new Set(),
        states: new Set(),
        targetCities: new Set(),
        addressCities: new Set(),
        cities: new Set(),
        targetCounties: new Set(),
        addressCounties: new Set(),
        counties: new Set(),
        postcode: null,
        postcodes: [],
    }
    addTargetSignals(mergeTarget(company.location_value, targetLookup), signals)
    addAddressSignals(company.address, signals)
    addAddressSignals(company.registered_address, signals)
    for (const state of [...signals.targetStates, ...signals.addressStates]) signals.states.add(state)
    for (const city of [...signals.targetCities, ...signals.addressCities]) signals.cities.add(city)
    for (const county of [...signals.targetCounties, ...signals.addressCounties]) signals.counties.add(county)
    signals.postcode = signals.postcodes[0]?.slice(0, 10) ?? null
    return signals
}

function preferredStates(signals: LocationSignals) {
    return signals.targetStates.size > 0 ? signals.targetStates : signals.states
}

function preferredCities(signals: LocationSignals) {
    return signals.targetCities.size > 0 ? signals.targetCities : signals.cities
}

function preferredCounties(signals: LocationSignals) {
    return signals.targetCounties.size > 0 ? signals.targetCounties : signals.counties
}

export function candidatePrimaryState(company: CompanyLocationCandidate, targetLookup?: Map<string, LeadgenLocationTarget>) {
    return [...preferredStates(locationSignalsForCompany(company, targetLookup))][0] ?? null
}

export function candidatePrimaryCity(company: CompanyLocationCandidate, targetLookup?: Map<string, LeadgenLocationTarget>) {
    const city = [...preferredCities(locationSignalsForCompany(company, targetLookup))][0] ?? null
    return city ? titleCaseSlug(city) : null
}

export function candidatePrimaryPostcode(company: CompanyLocationCandidate, targetLookup?: Map<string, LeadgenLocationTarget>) {
    return locationSignalsForCompany(company, targetLookup).postcode
}

export function candidateLocationAppliesToState(company: CompanyLocationCandidate, stateCode: string, targetLookup?: Map<string, LeadgenLocationTarget>) {
    const state = normalizeStateCode(stateCode)
    if (!state) return false
    return preferredStates(locationSignalsForCompany(company, targetLookup)).has(state)
}

function intersects<T>(left: Set<T>, right: T[]) {
    return right.some((item) => left.has(item))
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

export function sourceCoverageApplies(
    source: { source_key: string; coverage?: unknown },
    company: CompanyLocationCandidate,
    targetLookup?: Map<string, LeadgenLocationTarget>
) {
    if (source.source_key === "website" || source.source_key === "web.json_ld") return true
    if ((source.source_key === "web.rdap_whois" || source.source_key === "web.certificate_transparency") && !domainFromUrl(company.website_domain) && !domainFromUrl(company.website_url)) return false
    const coverage = asRecord(source.coverage)
    const industries = asStringArray(coverage.industries)
    const allIndustries = industries.includes("all_enabled") || industries.includes("all") || industries.includes("*")
    if (!allIndustries && industries.length > 0 && (!company.industry_value || !industries.includes(company.industry_value))) return false

    const sourceStates = asStringArray(coverage.states).map(normalizeStateCode).filter((state): state is string => Boolean(state))
    const sourceCities = asStringArray(coverage.cities).map(normaliseCoveragePlace).filter(Boolean)
    const sourceCounties = asStringArray(coverage.counties).map(normaliseCounty).filter(Boolean)
    if (sourceStates.length === 0 && sourceCities.length === 0 && sourceCounties.length === 0) return true

    const signals = locationSignalsForCompany(company, targetLookup)
    if (sourceStates.length > 0) {
        const candidateStates = preferredStates(signals)
        if (candidateStates.size > 0 && !intersects(candidateStates, sourceStates)) return false
        if (candidateStates.size === 0 && (sourceCities.length > 0 || sourceCounties.length > 0)) return false
    }
    if (sourceCities.length > 0 && !intersects(preferredCities(signals), sourceCities)) return false
    if (sourceCounties.length > 0 && !intersects(preferredCounties(signals), sourceCounties)) return false
    return true
}
