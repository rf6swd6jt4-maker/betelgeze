import { normalisePersonName } from "./person-name-normalizer.js"

export type PersonNameGateSource = "official_field" | "public_record" | "state_license" | "json_ld" | "team_card" | "visible_text" | "title_or_meta" | "website" | "heuristic"

export type PersonNameGateInput = {
    id?: string
    candidateName: string | null | undefined
    text?: string | null
    source?: PersonNameGateSource | string | null
    role?: string | null
    businessNames?: Array<string | null | undefined>
}

export type PersonNameGateResult = {
    accepted: boolean
    name: string | null
    confidence: number
    method: "official_field" | "json_ld" | "ner" | "heuristic" | "rejected"
    reason: string
}

type NerResponseItem = {
    id?: string
    acceptedName?: unknown
    name?: unknown
    persons?: unknown
    confidence?: unknown
}

const HARD_REJECT_TOKENS = new Set([
    "about", "areas", "blog", "book", "careers", "contact", "customer", "customers", "faq", "faqs", "featured",
    "gallery", "help", "home", "how", "learn", "locations", "login", "our", "page", "portal", "privacy", "project",
    "projects", "quote", "reviews", "schedule", "services", "service", "staff", "story", "support", "team", "testimonials",
    "terms", "us", "we", "what", "when", "where", "who", "why", "work", "works",
])

const BUSINESS_TOKENS = new Set([
    "air", "auto", "automotive", "builders", "building", "company", "concrete", "construction", "contracting",
    "contractor", "contractors", "corp", "corporation", "design", "disposal", "drywall", "electric", "electrical",
    "enterprises", "excavating", "flooring", "group", "gutters", "heating", "holdings", "homes", "hvac", "inc",
    "incorporated", "installation", "landscaping", "llc", "ltd", "painting", "pest", "plumbing", "remodeling",
    "renovation", "repair", "restoration", "roofing", "solution", "solutions", "systems", "waste",
])

const TRUSTED_SOURCES = new Set(["official_field", "public_record", "state_license"])
const WEAK_WEBSITE_SOURCES = new Set(["visible_text", "title_or_meta", "website"])

function boolEnv(value: string | undefined, defaultValue = false) {
    if (value == null || value === "") return defaultValue
    return /^(1|true|yes|on)$/i.test(value)
}

function cleanText(value: string | null | undefined) {
    return (value ?? "").replace(/\s+/g, " ").trim()
}

function wordKey(value: string) {
    return value.toLowerCase().replace(/[^a-z]/g, "")
}

function nameTokens(value: string) {
    return [...value.matchAll(/[A-Za-z][A-Za-z.'-]*/g)].map((match) => match[0])
}

function compactNameKey(value: string | null | undefined) {
    return nameTokens(value ?? "").map(wordKey).filter(Boolean).join("")
}

function contextNameKeys(value: string | null | undefined) {
    return nameTokens(value ?? "")
        .map(wordKey)
        .filter((key) => key && !["co", "corp", "corporation", "company", "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited"].includes(key))
}

function sourceKey(input: PersonNameGateInput) {
    return String(input.source ?? "heuristic").toLowerCase()
}

function sourceTrust(input: PersonNameGateInput) {
    const source = sourceKey(input)
    const role = `${input.role ?? ""} ${input.text ?? ""}`.toLowerCase()
    if (TRUSTED_SOURCES.has(source)) return 96
    if (source === "json_ld" && /\b(owner|founder|co-founder|principal|president|ceo|managing partner|managing member)\b/.test(role)) return 90
    if (source === "json_ld") return 82
    if (source === "team_card" && /\b(owner|founder|co-founder|principal|president|ceo|managing partner|managing member)\b/.test(role)) return 84
    if (source === "team_card") return 74
    if (/\b(owner|founder|owned by|founded by|founded|started|established|opened|launched|managed by|led by|run by|principal|president|ceo)\b/.test(role)) return 72
    return 62
}

function hasRepeatedContentToken(tokens: string[]) {
    const seen = new Set<string>()
    for (const token of tokens) {
        const key = wordKey(token)
        if (!key || ["jr", "sr", "ii", "iii", "iv", "v"].includes(key)) continue
        if (seen.has(key)) return true
        seen.add(key)
    }
    return false
}

function matchesBusinessContext(tokens: string[], businessNames: Array<string | null | undefined>) {
    const keys = tokens.map(wordKey).filter(Boolean)
    if (keys.length < 2) return false
    for (const businessName of businessNames) {
        const contextKeys = contextNameKeys(businessName)
        if (contextKeys.length < 2) continue
        const contextSet = new Set(contextKeys)
        if (keys.every((key) => contextSet.has(key))) return true
    }
    return false
}

function hasRepeatedSentenceFragment(name: string, text: string | null | undefined) {
    const clean = cleanText(text)
    if (!clean) return false
    const tokens = nameTokens(name)
    const first = tokens[0]
    if (!first) return false
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, String.raw`\s+`)
    const escapedFirst = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(String.raw`\b${escapedName}\s+${escapedFirst}\s+(?:is|are|has|have|was|were|runs?|owns?|founded|started)\b`, "i").test(clean)
}

function hardRejectReason(name: string, input: PersonNameGateInput) {
    const tokens = nameTokens(name)
    if (tokens.length < 2) return "Candidate does not contain a first and last name."
    if (tokens.length > 4) return "Candidate contains too many name-like words."
    const keys = tokens.map(wordKey).filter(Boolean)
    if (keys.some((key) => HARD_REJECT_TOKENS.has(key))) return "Candidate contains website navigation or sentence-fragment words."
    if (keys.some((key) => BUSINESS_TOKENS.has(key))) return "Candidate contains business/service words."
    if (hasRepeatedContentToken(tokens)) return "Candidate repeats a name token."
    if (matchesBusinessContext(tokens, input.businessNames ?? [])) return "Candidate matches the business name."
    if (hasRepeatedSentenceFragment(name, input.text)) return "Candidate appears inside a repeated sentence fragment."
    return null
}

function normaliseCandidate(input: PersonNameGateInput) {
    return normalisePersonName(input.candidateName, {
        allowExtraction: false,
        allowAllCaps: true,
        ownerContext: true,
        minConfidence: 55,
        contextNames: input.businessNames,
    })
}

export function deterministicPersonNameGate(input: PersonNameGateInput): PersonNameGateResult {
    const name = normaliseCandidate(input)
    if (!name) return { accepted: false, name: null, confidence: 0, method: "rejected", reason: "Candidate could not be normalized as a person name." }
    const hardReject = hardRejectReason(name, input)
    if (hardReject) return { accepted: false, name: null, confidence: 0, method: "rejected", reason: hardReject }
    const trust = sourceTrust(input)
    const roleText = `${input.role ?? ""} ${input.text ?? ""}`.toLowerCase()
    const ownerContextBoost = /\b(owner|founder|co-founder|principal|president|ceo|managed by|owned by|founded by|founded|started|established|opened|launched|led by|run by)\b/.test(roleText) ? 6 : 0
    const confidence = Math.min(98, trust + ownerContextBoost)
    const source = sourceKey(input)
    const method = source === "json_ld" ? "json_ld" : TRUSTED_SOURCES.has(source) ? "official_field" : "heuristic"
    const threshold = WEAK_WEBSITE_SOURCES.has(source) ? 68 : 64
    if (confidence < threshold) {
        return { accepted: false, name, confidence, method: "rejected", reason: "Candidate did not meet the source trust threshold." }
    }
    return { accepted: true, name, confidence, method, reason: `Accepted by ${method} gate.` }
}

function nerEndpoint() {
    return cleanText(process.env.LEADGEN_NER_ENDPOINT)
}

function nerEnabled() {
    return boolEnv(process.env.LEADGEN_NER_ENABLED, Boolean(nerEndpoint()))
}

function nerTimeoutMs() {
    const configured = Number(process.env.LEADGEN_NER_TIMEOUT_MS)
    return Number.isFinite(configured) && configured >= 250 ? Math.min(configured, 10_000) : 1_800
}

function requireNerForWeakWebsite() {
    return boolEnv(process.env.LEADGEN_NER_REQUIRE_WEAK_WEBSITE, true)
}

function shouldAskNer(input: PersonNameGateInput, deterministic: PersonNameGateResult) {
    if (!nerEnabled() || !nerEndpoint() || !deterministic.name) return false
    const source = sourceKey(input)
    if (TRUSTED_SOURCES.has(source) || source === "json_ld") return false
    if (WEAK_WEBSITE_SOURCES.has(source)) return true
    return deterministic.confidence < 84
}

async function callNerService(inputs: PersonNameGateInput[]) {
    const endpoint = nerEndpoint()
    if (!endpoint) return new Map<string, NerResponseItem>()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), nerTimeoutMs())
    try {
        const token = cleanText(process.env.LEADGEN_NER_TOKEN)
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
                items: inputs.map((input, index) => ({
                    id: input.id ?? String(index),
                    text: input.text ?? input.candidateName ?? "",
                    candidate: input.candidateName ?? "",
                })),
            }),
            signal: controller.signal,
        })
        if (!response.ok) throw new Error(`NER service returned HTTP ${response.status}`)
        const payload = await response.json() as unknown
        const items = Array.isArray(payload)
            ? payload
            : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
                ? (payload as { items: unknown[] }).items
                : []
        return new Map(items
            .filter((item): item is NerResponseItem => Boolean(item && typeof item === "object"))
            .map((item, index) => [String(item.id ?? inputs[index]?.id ?? index), item]))
    } finally {
        clearTimeout(timeout)
    }
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map((item) => typeof item === "string" ? item : null).filter((item): item is string => Boolean(item)) : []
}

function nameFromNer(item: NerResponseItem | undefined, input: PersonNameGateInput) {
    if (!item) return null
    const direct = typeof item.acceptedName === "string" ? item.acceptedName : typeof item.name === "string" ? item.name : null
    const candidateKey = compactNameKey(input.candidateName)
    const candidates = [direct, ...stringArray(item.persons)]
        .map((value) => normalisePersonName(value, { allowExtraction: false, allowAllCaps: true, ownerContext: true, minConfidence: 55, contextNames: input.businessNames }))
        .filter((name): name is string => Boolean(name))
    for (const name of candidates) {
        const key = compactNameKey(name)
        if (!candidateKey || key === candidateKey || candidateKey.includes(key) || key.includes(candidateKey)) return name
    }
    return null
}

export async function gatePersonNameCandidates(inputs: PersonNameGateInput[]): Promise<PersonNameGateResult[]> {
    const indexedInputs = inputs.map((input, index) => ({ ...input, id: input.id ?? String(index) }))
    const deterministic = indexedInputs.map(deterministicPersonNameGate)
    const nerInputs = indexedInputs.filter((input, index) => shouldAskNer(input, deterministic[index]))
    if (nerInputs.length === 0) return deterministic
    let nerResults: Map<string, NerResponseItem>
    try {
        nerResults = await callNerService(nerInputs)
    } catch {
        return deterministic.map((result, index) => shouldAskNer(indexedInputs[index], result) && result.accepted
            ? { ...result, reason: `${result.reason} NER was unavailable, so deterministic fallback was used.` }
            : result)
    }
    const needsNer = new Set(nerInputs.map((input, index) => input.id ?? String(index)))
    return indexedInputs.map((input, index) => {
        const base = deterministic[index]
        if (!shouldAskNer(input, base)) return base
        const item = nerResults.get(input.id ?? String(index))
        const name = nameFromNer(item, input)
        if (name) {
            const hardReject = hardRejectReason(name, input)
            if (hardReject) return { accepted: false, name: null, confidence: 0, method: "rejected", reason: hardReject }
            const confidence = Math.max(base.confidence, Math.min(98, Number(item?.confidence) || 86))
            return { accepted: true, name, confidence, method: "ner", reason: "Accepted by NER PERSON entity match." }
        }
        const source = sourceKey(input)
        if (needsNer.has(input.id ?? String(index)) && requireNerForWeakWebsite() && WEAK_WEBSITE_SOURCES.has(source)) {
            return { accepted: false, name: null, confidence: base.confidence, method: "rejected", reason: "NER did not confirm a PERSON entity for this weak website candidate." }
        }
        return base
    })
}
