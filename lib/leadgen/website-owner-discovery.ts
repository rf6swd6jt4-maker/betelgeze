import { normalisePersonName } from "./person-name-normalizer.js"
import { deterministicPersonNameGate, gatePersonNameCandidates, type PersonNameGateResult } from "./person-name-gate.js"

export type WebsiteStageKey = "business_validation" | "owner_identity" | "owner_phone" | "phone_validation"

export type PageExtraction = {
    url: string
    owner_name: string | null
    phone: string | null
    phones: string[]
    evidence: string[]
    owner_role?: string | null
    owner_source?: string | null
    owner_confidence?: number | null
    social_links?: string[]
    profile_links?: string[]
    snippets?: Array<Record<string, unknown>>
    discovered_links?: string[]
}

export type PageExtractionOptions = {
    businessNames?: Array<string | null | undefined>
    stageKey?: WebsiteStageKey
}

export type WebsitePage = {
    html: string
    visibleText: string
    title: string | null
    metaDescription: string | null
    links: string[]
}

type WebsiteOwnerCandidate = {
    name: string
    role: string | null
    phone: string | null
    source: string
    sourceUrl: string
    confidence: number
    index: number
    snippet: string
    gate?: PersonNameGateResult
}

const WEBSITE_MAX_HTML_CHARS = 700_000
const WEBSITE_JSON_LD_MAX_CHARS = 160_000
const OWNER_ROLE_PATTERN = String.raw`owner|founder|co-founder|co owner|principal|president|managing partner|managing member|operator|ceo|chief executive officer|license holder|qualifier|qualifying individual|general manager|operations manager`
const PERSON_PATTERN = String.raw`([A-Z][A-Za-z.'-]+(?:\s+(?:[A-Z]\.?\s+)?[A-Z][A-Za-z.'-]+){1,4})`
const SIMPLE_PERSON_PATTERN = String.raw`([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})`

function normalisePhone(value: string | null | undefined) {
    const raw = value?.trim()
    if (!raw) return null
    const digits = raw.replace(/\D/g, "")
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
    return digits.length >= 8 ? `+${digits}` : null
}

function uniqueValues(values: Array<string | null | undefined>) {
    return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function decodeHtml(value: string) {
    return value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
}

function stripHtml(value: string) {
    return decodeHtml(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim()
}

function htmlAttributeValue(tag: string, name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return decodeHtml(tag.match(new RegExp(`${escaped}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? "")
}

function pageTitle(html: string) {
    const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    return title || null
}

function metaContent(html: string, names: string[]) {
    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
        const meta = tag[0]
        const name = htmlAttributeValue(meta, "name") || htmlAttributeValue(meta, "property")
        if (!names.some((item) => item.toLowerCase() === name.toLowerCase())) continue
        const content = htmlAttributeValue(meta, "content")
        if (content) return content
    }
    return null
}

function visibleTextFromHtml(html: string) {
    return stripHtml(html
        .replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " "))
}

function ownerishContext(value: string | null | undefined) {
    return new RegExp(String.raw`\b(?:${OWNER_ROLE_PATTERN}|owned by|founded by|founded|started|established|opened|launched|led by|managed by|run by|owned and operated by)\b`, "i").test(value ?? "")
}

function normaliseOwnerName(value: string | null | undefined, context: string | null | undefined = null, businessNames: Array<string | null | undefined> = []) {
    const ownerContext = ownerishContext(`${value ?? ""} ${context ?? ""}`)
    return normalisePersonName(value, {
        allowExtraction: true,
        ownerContext,
        minConfidence: ownerContext ? 58 : 66,
        contextNames: businessNames,
    })
}

function extractPhones(text: string) {
    const candidates = [
        ...text.matchAll(/href=["']tel:([^"']+)["']/gi),
        ...text.matchAll(/telephone["']?\s*[:=]\s*["']([^"']+)["']/gi),
        ...text.matchAll(/phone["']?\s*[:=]\s*["']([^"']+)["']/gi),
        ...text.matchAll(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g),
    ]
        .map((match) => normalisePhone(match[1] ?? match[0]))
        .filter((phone): phone is string => Boolean(phone))
    return uniqueValues(candidates)
}

function phoneMatches(text: string) {
    return [...text.matchAll(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g)]
        .map((match) => ({ phone: normalisePhone(match[0]), index: match.index ?? -1 }))
        .filter((match): match is { phone: string; index: number } => Boolean(match.phone && match.index >= 0))
}

function snippetAround(text: string, index: number, radius = 260) {
    if (index < 0) return text.slice(0, radius * 2).trim()
    const start = Math.max(0, index - radius)
    const end = Math.min(text.length, index + radius)
    return text.slice(start, end).replace(/\s+/g, " ").trim()
}

function roleConfidence(role: string | null | undefined, source: string) {
    const text = `${role ?? ""} ${source}`.toLowerCase()
    if (/\bowner|founder|co-founder|co owner\b/.test(text)) return 88
    if (/\bprincipal|president|ceo|chief executive|managing partner|managing member\b/.test(text)) return 78
    if (/\bqualifier|qualifying individual|license holder|operator\b/.test(text)) return 70
    if (/\bgeneral manager|operations manager\b/.test(text)) return 55
    return source === "json_ld" ? 62 : source === "team_card" ? 58 : 50
}

function ownerCandidate(input: {
    name: string | null | undefined
    role?: string | null
    phone?: string | null
    source: string
    sourceUrl: string
    index?: number
    snippet?: string | null
    confidence?: number | null
    businessNames?: Array<string | null | undefined>
}): WebsiteOwnerCandidate | null {
    const context = [input.role, input.snippet, input.source].filter(Boolean).join(" ")
    const name = normaliseOwnerName(input.name, context, input.businessNames ?? [])
    if (!name) return null
    return {
        name,
        role: input.role ?? null,
        phone: input.phone ?? null,
        source: input.source,
        sourceUrl: input.sourceUrl,
        confidence: Math.min(100, Math.max(0, Math.round(input.confidence ?? roleConfidence(input.role, input.source)))),
        index: input.index ?? -1,
        snippet: input.snippet?.replace(/\s+/g, " ").trim() ?? "",
    }
}

function ownerAssociatedPhone(text: string, ownerIndex: number) {
    if (ownerIndex < 0) return null
    const nearbyPhones = phoneMatches(text)
        .filter((match) => Math.abs(match.index - ownerIndex) <= 1100)
        .map((match) => match.phone)
    return uniqueValues(nearbyPhones)[0] ?? null
}

function extractOwnerCandidatesFromText(url: string, text: string, source = "visible_text", businessNames: Array<string | null | undefined> = []) {
    const patterns: Array<{ regex: RegExp; nameGroup: number; roleGroup?: number; confidence?: number }> = [
        { regex: new RegExp(String.raw`\b(${OWNER_ROLE_PATTERN})\s*(?:is|:|,|-|\u2013)?\s*${PERSON_PATTERN}`, "gi"), roleGroup: 1, nameGroup: 2, confidence: 86 },
        { regex: new RegExp(String.raw`${PERSON_PATTERN}\s*(?:,|-|\u2013|\||/)?\s*(?:the\s+)?(${OWNER_ROLE_PATTERN})\b`, "gi"), nameGroup: 1, roleGroup: 2, confidence: 84 },
        { regex: new RegExp(String.raw`\b(?:owned and operated by|owned by|founded by|led by|run by|started by|locally owned by|family owned by)\s+${PERSON_PATTERN}`, "gi"), nameGroup: 1, confidence: 84 },
        { regex: new RegExp(String.raw`\b[Mm]eet\s+(?:the|our)?\s*(?:owner|founder|president|principal|team)?\s*${PERSON_PATTERN}`, "g"), nameGroup: 1, confidence: 70 },
        { regex: new RegExp(String.raw`${SIMPLE_PERSON_PATTERN}\s+(?:founded|started|established|opened|launched)\b`, "g"), nameGroup: 1, confidence: 78 },
    ]
    const candidates: WebsiteOwnerCandidate[] = []
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern.regex)) {
            const name = match[pattern.nameGroup]
            const role = pattern.roleGroup ? match[pattern.roleGroup] ?? null : null
            const index = match.index ?? -1
            const snippet = snippetAround(text, index)
            const candidate = ownerCandidate({
                name,
                role,
                phone: ownerAssociatedPhone(text, index) ?? extractPhones(snippet)[0] ?? null,
                source,
                sourceUrl: url,
                index,
                snippet,
                confidence: pattern.confidence ?? null,
                businessNames,
            })
            if (candidate) candidates.push(candidate)
        }
    }
    return candidates
}

function htmlBlocks(html: string) {
    const blocks = [
        ...html.matchAll(/<(?:article|section|li|div)\b[^>]*(?:class|id)=["'][^"']*(?:team|staff|owner|founder|leadership|member|person|profile|bio|card|employee)[^"']*["'][^>]*>([\s\S]{40,2500}?)<\/(?:article|section|li|div)>/gi),
        ...html.matchAll(/<(?:article|section|li|div)\b[^>]*>([\s\S]{40,1800}?\b(?:owner|founder|principal|president|ceo|manager|qualifier|team|staff)\b[\s\S]{0,1200}?)<\/(?:article|section|li|div)>/gi),
    ]
    return blocks.map((match) => ({
        html: match[1] ?? "",
        text: stripHtml(match[1] ?? ""),
    })).filter((block) => block.text.length >= 20)
}

function headingNamesFromHtml(html: string, businessNames: Array<string | null | undefined> = []) {
    return [...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]{2,160}?)<\/h[1-4]>/gi)]
        .map((match) => {
            const heading = stripHtml(match[1] ?? "")
            return normalisePersonName(heading, {
                allowExtraction: ownerishContext(heading),
                ownerContext: ownerishContext(heading),
                minConfidence: ownerishContext(heading) ? 58 : 70,
                contextNames: businessNames,
            })
        })
        .filter((name): name is string => Boolean(name))
}

function extractOwnerCandidatesFromCards(url: string, html: string, businessNames: Array<string | null | undefined> = []) {
    return htmlBlocks(html).flatMap((block) => {
        const role = block.text.match(new RegExp(OWNER_ROLE_PATTERN, "i"))?.[0] ?? null
        const headingCandidates = headingNamesFromHtml(block.html, businessNames).flatMap((name) => {
            const candidate = ownerCandidate({
                name,
                role,
                phone: extractPhones(block.text)[0] ?? null,
                source: "team_card",
                sourceUrl: url,
                snippet: block.text.slice(0, 520),
                confidence: role ? roleConfidence(role, "team_card") + 4 : 58,
                businessNames,
            })
            return candidate ? [candidate] : []
        })
        const textCandidates = extractOwnerCandidatesFromText(url, block.text, "team_card", businessNames).map((candidate) => ({
            ...candidate,
            snippet: candidate.snippet || block.text.slice(0, 520),
            confidence: Math.max(candidate.confidence, roleConfidence(candidate.role, "team_card")),
        }))
        return [...headingCandidates, ...textCandidates]
    })
}

function extractTitleCandidates(url: string, title: string | null, description: string | null, businessNames: Array<string | null | undefined> = []) {
    const text = [title, description].filter(Boolean).join(" ")
    if (!text) return []
    return extractOwnerCandidatesFromText(url, text, "title_or_meta", businessNames).map((candidate) => ({
        ...candidate,
        confidence: Math.max(candidate.confidence, 72),
    }))
}

function extractLinks(html: string, pageUrl: string) {
    const base = new URL(pageUrl)
    const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)]
        .flatMap((match) => {
            const raw = decodeHtml(match[1] ?? "").trim()
            if (!raw || /^(?:mailto|tel|javascript|sms):/i.test(raw) || raw.startsWith("#")) return []
            try {
                const next = new URL(raw, base)
                next.hash = ""
                if (!["http:", "https:"].includes(next.protocol)) return []
                return [next.toString()]
            } catch {
                return []
            }
        })
    return uniqueValues(links)
}

export function sameSiteUrl(url: string, baseUrl: string) {
    try {
        const candidate = new URL(url)
        const base = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`)
        return candidate.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")
    } catch {
        return false
    }
}

function socialLinks(links: string[]) {
    return links.filter((link) => /\b(?:linkedin\.com\/(?:in|company)|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|bbb\.org|buildzoom\.com|angi\.com|yelp\.com)\b/i.test(link)).slice(0, 12)
}

function profileLinks(links: string[]) {
    return links.filter((link) => /\/(?:team|staff|people|person|profile|bio|about|leadership|owners?|founders?)(?:\/|$|-)|linkedin\.com\/in\//i.test(link)).slice(0, 12)
}

export function crawlScore(url: string, stageKey: WebsiteStageKey) {
    let score = 10
    const path = new URL(url).pathname.toLowerCase()
    if (path === "/" || path === "") score += stageKey === "business_validation" ? 100 : 45
    if (/\/(?:about|about-us|our-company|company|who-we-are|our-story)(?:\/|$|-)/.test(path)) score += 75
    if (/\/(?:team|our-team|meet-the-team|meet-our-team|staff|leadership|people|owners?|founders?|meet-the-owner|meet-our-owner|meet-the-founder|bio|profile)(?:\/|$|-)/.test(path)) score += 110
    if (/\/(?:license|licenses|licensing|certifications?|credentials?)(?:\/|$|-)/.test(path)) score += stageKey === "owner_identity" ? 40 : 15
    if (/\/(?:contact|contact-us|locations?)(?:\/|$|-)/.test(path)) score += stageKey === "owner_phone" ? 80 : 35
    if (/\/(?:blog|news|privacy|terms|login|cart|checkout|careers?|jobs?|gallery|portfolio|project|coupon|financing|wp-content|tag|category)(?:\/|$|-)/.test(path)) score -= 80
    if (/\.(?:pdf|jpg|jpeg|png|gif|webp|svg|zip|docx?)$/i.test(path)) score -= 100
    return score
}

export function defaultWebsiteUrls(baseUrl: string, depth: number, stageKey: WebsiteStageKey) {
    const url = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`)
    const stagePaths = stageKey === "business_validation"
        ? ["/"]
        : [
            "/",
            "/about",
            "/about-us",
            "/our-story",
            "/our-company",
            "/company",
            "/who-we-are",
            "/meet-the-owner",
            "/meet-our-owner",
            "/meet-the-founder",
            "/team",
            "/our-team",
            "/meet-the-team",
            "/meet-our-team",
            "/staff",
            "/leadership",
            "/owners",
            "/owner",
            "/founder",
            "/license",
            "/licenses",
            "/contact",
            "/contact-us",
        ]
    const maxDefaults = depth <= 1 ? 1 : depth === 2 ? 9 : stagePaths.length
    return stagePaths.slice(0, maxDefaults).map((path) => new URL(path, url.origin).toString())
}

export function discoverWebsiteUrlsFromHtml(baseUrl: string, pageUrl: string, html: string, stageKey: WebsiteStageKey, depth: number) {
    if (stageKey === "business_validation" || depth <= 1) return []
    return extractLinks(html, pageUrl)
        .filter((link) => sameSiteUrl(link, baseUrl))
        .filter((link) => crawlScore(link, stageKey) > 0)
        .sort((left, right) => crawlScore(right, stageKey) - crawlScore(left, stageKey))
        .slice(0, 18)
}

async function fetchTextUrl(url: string, timeoutSeconds: number, accept = "text/plain,text/xml,application/xml,text/html,*/*") {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)", Accept: accept },
            cache: "no-store",
            signal: controller.signal,
        })
        if (!response.ok) return null
        return (await response.text()).slice(0, WEBSITE_MAX_HTML_CHARS)
    } finally {
        clearTimeout(timeout)
    }
}

function sitemapLocations(xml: string) {
    return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) => decodeHtml(match[1] ?? "").trim()).filter(Boolean)
}

export async function discoverSitemapUrls(baseUrl: string, stageKey: WebsiteStageKey, depth: number, timeoutSeconds: number) {
    if (stageKey === "business_validation" || depth <= 1) return []
    const base = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`)
    const sitemapSeeds = new Set<string>([
        new URL("/sitemap.xml", base.origin).toString(),
        new URL("/sitemap_index.xml", base.origin).toString(),
    ])
    try {
        const robots = await fetchTextUrl(new URL("/robots.txt", base.origin).toString(), Math.min(2, timeoutSeconds))
        for (const match of robots?.matchAll(/^sitemap:\s*(.+)$/gim) ?? []) {
            const sitemap = match[1]?.trim()
            if (sitemap) sitemapSeeds.add(new URL(sitemap, base.origin).toString())
        }
    } catch {
        // Sitemap discovery is opportunistic.
    }
    const discovered: string[] = []
    for (const sitemapUrl of [...sitemapSeeds].slice(0, 4)) {
        try {
            const xml = await fetchTextUrl(sitemapUrl, Math.min(3, timeoutSeconds))
            if (!xml) continue
            const locations = sitemapLocations(xml)
            const nestedSitemaps = locations.filter((loc) => /sitemap/i.test(loc)).slice(0, 3)
            for (const loc of locations.filter((loc) => sameSiteUrl(loc, base.origin))) discovered.push(loc)
            for (const nested of nestedSitemaps) {
                const nestedXml = await fetchTextUrl(nested, Math.min(3, timeoutSeconds))
                if (nestedXml) discovered.push(...sitemapLocations(nestedXml).filter((loc) => sameSiteUrl(loc, base.origin)))
            }
        } catch {
            continue
        }
    }
    return uniqueValues(discovered)
        .filter((url) => crawlScore(url, stageKey) > 0)
        .sort((left, right) => crawlScore(right, stageKey) - crawlScore(left, stageKey))
        .slice(0, 24)
}

export async function fetchWebsitePage(url: string, timeoutSeconds: number): Promise<WebsitePage | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)", Accept: "text/html,text/plain" },
            cache: "no-store",
            signal: controller.signal,
        })
        if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
        const contentType = response.headers.get("content-type") ?? ""
        if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null
        const html = (await response.text()).slice(0, WEBSITE_MAX_HTML_CHARS)
        return {
            html,
            visibleText: visibleTextFromHtml(html),
            title: pageTitle(html),
            metaDescription: metaContent(html, ["description", "og:description", "twitter:description"]),
            links: extractLinks(html, url),
        }
    } finally {
        clearTimeout(timeout)
    }
}

function jsonLdScripts(html: string) {
    return [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
        .map((match) => match[1]?.replace(/<!--|-->/g, "").trim())
        .map((value) => value && value.length > WEBSITE_JSON_LD_MAX_CHARS ? null : value)
        .filter((value): value is string => Boolean(value))
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) return value.flatMap(flattenJsonLd)
    if (!value || typeof value !== "object") return []
    const record = value as Record<string, unknown>
    const graph = Array.isArray(record["@graph"]) ? record["@graph"].flatMap(flattenJsonLd) : []
    return [record, ...graph]
}

function jsonLdName(value: unknown, businessNames: Array<string | null | undefined> = []): string | null {
    if (typeof value === "string") return normalisePersonName(value, { allowExtraction: false, ownerContext: true, minConfidence: 58, contextNames: businessNames })
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    const direct = normalisePersonName(typeof record.name === "string" ? record.name : null, { allowExtraction: false, ownerContext: true, minConfidence: 58, contextNames: businessNames })
    if (direct) return direct
    const given = typeof record.givenName === "string" ? record.givenName.trim() : null
    const family = typeof record.familyName === "string" ? record.familyName.trim() : null
    return normalisePersonName([given, family].filter(Boolean).join(" "), { allowExtraction: false, ownerContext: true, minConfidence: 58, contextNames: businessNames })
}

function jsonLdPhone(value: unknown) {
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    return normalisePhone(typeof record.telephone === "string" ? record.telephone : typeof record.phone === "string" ? record.phone : null)
}

function extractJsonLdOwnerCandidates(url: string, html: string, businessNames: Array<string | null | undefined> = []) {
    const candidates: WebsiteOwnerCandidate[] = []
    for (const script of jsonLdScripts(html)) {
        try {
            const nodes = flattenJsonLd(JSON.parse(script))
            for (const node of nodes) {
                const type = Array.isArray(node["@type"]) ? node["@type"].map(String) : [String(node["@type"] ?? "")]
                if (type.some((item) => item.toLowerCase() === "person")) {
                    const role = [node.jobTitle, node.title, node.description].map((value) => typeof value === "string" ? value : "").join(" ")
                    const personName = jsonLdName(node, businessNames)
                    if (personName && /\b(owner|founder|principal|president|ceo|managing partner|managing member|operator|license holder|qualifier|manager)\b/i.test(role)) {
                        const candidate = ownerCandidate({ name: personName, role, phone: jsonLdPhone(node), source: "json_ld", sourceUrl: url, snippet: `${personName} ${role}`.trim(), confidence: roleConfidence(role, "json_ld"), businessNames })
                        if (candidate) candidates.push(candidate)
                    }
                }
                for (const key of ["founder", "founders", "owner", "employee", "member", "foundingTeam", "alumni"]) {
                    const candidateName = jsonLdName(node[key], businessNames)
                    const candidate = ownerCandidate({ name: candidateName, role: key, phone: jsonLdPhone(node[key]), source: "json_ld", sourceUrl: url, snippet: `${key}: ${candidateName ?? ""}`, confidence: key.includes("founder") || key === "owner" ? 82 : 60, businessNames })
                    if (candidate) candidates.push(candidate)
                    if (Array.isArray(node[key])) {
                        for (const item of node[key]) {
                            const arrayCandidateName = jsonLdName(item, businessNames)
                            const arrayCandidate = ownerCandidate({ name: arrayCandidateName, role: key, phone: jsonLdPhone(item), source: "json_ld", sourceUrl: url, snippet: `${key}: ${arrayCandidateName ?? ""}`, confidence: key.includes("founder") || key === "owner" ? 82 : 60, businessNames })
                            if (arrayCandidate) candidates.push(arrayCandidate)
                        }
                    }
                }
            }
        } catch {
            continue
        }
    }
    return dedupeOwnerCandidates(candidates)
}

function fallbackOwnerPhone(url: string, visibleText: string, phones: string[], ownerName: string | null) {
    if (!ownerName || phones.length !== 1) return null
    const ownerishPage = /\/(about|about-us|team|our-team|meet-the-team|staff|leadership|owner|owners|founder|contact|contact-us)(?:\/|$)/i.test(new URL(url).pathname)
    const ownerishText = /\b(owner|founder|principal|president|managed by|owned and operated|founded by)\b/i.test(visibleText)
    return ownerishPage && ownerishText ? phones[0] : null
}

function dedupeOwnerCandidates(candidates: WebsiteOwnerCandidate[]) {
    const best = new Map<string, WebsiteOwnerCandidate>()
    for (const candidate of candidates) {
        const key = candidate.name.toLowerCase().replace(/[^a-z]/g, "")
        const existing = best.get(key)
        if (!existing || candidateIdentityScore(candidate) > candidateIdentityScore(existing) || (candidateIdentityScore(candidate) === candidateIdentityScore(existing) && candidate.phone && !existing.phone)) best.set(key, candidate)
    }
    return [...best.values()]
}

function candidateSourceTrust(candidate: WebsiteOwnerCandidate) {
    const role = `${candidate.role ?? ""} ${candidate.snippet}`.toLowerCase()
    if (candidate.source === "json_ld" && /\b(owner|founder|co-founder)\b/.test(role)) return 28
    if (candidate.source === "json_ld") return 20
    if (candidate.source === "team_card" && /\b(owner|founder|co-founder|principal|president|ceo|managing partner|managing member)\b/.test(role)) return 18
    if (candidate.source === "team_card") return 10
    if (/\b(owner|founder|owned by|founded by|founded|started|established|opened|launched|managed by|led by|run by|principal|president|ceo)\b/.test(role)) return 8
    return 0
}

function candidateIdentityScore(candidate: WebsiteOwnerCandidate) {
    return candidate.confidence + candidateSourceTrust(candidate) + (candidate.gate?.accepted ? Math.min(18, Math.max(0, candidate.gate.confidence - 70)) : 0)
}

function sortOwnerCandidates(candidates: WebsiteOwnerCandidate[], stageKey: WebsiteStageKey) {
    return [...candidates].sort((left, right) => {
        if (stageKey === "owner_phone") {
            const phoneDelta = Number(Boolean(right.phone)) - Number(Boolean(left.phone))
            if (phoneDelta) return phoneDelta
        }
        const identityDelta = candidateIdentityScore(right) - candidateIdentityScore(left)
        if (identityDelta) return identityDelta
        const phoneDelta = Number(Boolean(right.phone)) - Number(Boolean(left.phone))
        if (phoneDelta) return phoneDelta
        return right.confidence - left.confidence
    })
}

function pageOwnerCandidates(url: string, html: string, visibleText: string, title: string | null, metaDescription: string | null, businessNames: Array<string | null | undefined>) {
    return [
        ...extractOwnerCandidatesFromText(url, visibleText, "visible_text", businessNames),
        ...extractTitleCandidates(url, title, metaDescription, businessNames),
        ...extractOwnerCandidatesFromCards(url, html, businessNames),
        ...extractJsonLdOwnerCandidates(url, html, businessNames),
    ]
}

function gateInputsForCandidates(candidates: WebsiteOwnerCandidate[], businessNames: Array<string | null | undefined>) {
    return candidates.map((candidate, index) => ({
        id: `${index}`,
        candidateName: candidate.name,
        text: candidate.snippet,
        source: candidate.source,
        role: candidate.role,
        businessNames,
    }))
}

function applyDeterministicGate(candidates: WebsiteOwnerCandidate[], businessNames: Array<string | null | undefined>) {
    const inputs = gateInputsForCandidates(candidates, businessNames)
    return candidates.flatMap((candidate, index) => {
        const gate = deterministicPersonNameGate(inputs[index])
        if (!gate.accepted || !gate.name) return []
        return [{ ...candidate, name: gate.name, confidence: Math.max(candidate.confidence, gate.confidence), gate }]
    })
}

async function applyPersonNameGate(candidates: WebsiteOwnerCandidate[], businessNames: Array<string | null | undefined>) {
    const inputs = gateInputsForCandidates(candidates, businessNames)
    const gates = await gatePersonNameCandidates(inputs)
    return candidates.flatMap((candidate, index) => {
        const gate = gates[index]
        if (!gate.accepted || !gate.name) return []
        return [{ ...candidate, name: gate.name, confidence: Math.max(candidate.confidence, gate.confidence), gate }]
    })
}

function buildPageExtraction(url: string, html: string, visibleText: string, candidates: WebsiteOwnerCandidate[], stageKey: WebsiteStageKey): PageExtraction {
    const phones = extractPhones(`${html} ${visibleText}`)
    const links = extractLinks(html, url)
    const sortedCandidates = sortOwnerCandidates(dedupeOwnerCandidates(candidates), stageKey)
    const bestCandidate = sortedCandidates[0] ?? null
    const ownerName = bestCandidate?.name ?? null
    const ownerPhone = bestCandidate?.phone ?? fallbackOwnerPhone(url, visibleText, phones, ownerName)
    const socials = socialLinks(links)
    const profiles = profileLinks(links)
    const evidence = [
        phones.length ? `phone:${phones.join(",")}` : null,
        ownerName ? `owner:${ownerName}` : null,
        ownerPhone ? `owner_phone:${ownerPhone}` : null,
        candidates.some((candidate) => candidate.source === "json_ld") ? `json_ld_owner:${candidates.find((candidate) => candidate.source === "json_ld")?.name}` : null,
        candidates.some((candidate) => candidate.source === "team_card") ? "team_card_owner_candidate" : null,
        candidates.some((candidate) => candidate.source === "title_or_meta") ? "title_owner_candidate" : null,
        socials.length ? `social_links:${socials.length}` : null,
        profiles.length ? `profile_links:${profiles.length}` : null,
        /application\/ld\+json/i.test(html) ? "json_ld_present" : null,
        /href=["']tel:/i.test(html) ? "tel_link_present" : null,
    ].filter((value): value is string => Boolean(value))
    return {
        url,
        owner_name: ownerName,
        phone: ownerPhone,
        phones,
        evidence,
        owner_role: bestCandidate?.role ?? null,
        owner_source: bestCandidate?.source ?? null,
        owner_confidence: bestCandidate?.confidence ?? null,
        social_links: socials,
        profile_links: profiles,
        snippets: sortedCandidates.slice(0, 6).map((candidate) => ({
            name: candidate.name,
            role: candidate.role,
            source: candidate.source,
            confidence: candidate.confidence,
            gate: candidate.gate,
            phone: candidate.phone,
            snippet: candidate.snippet,
            url: candidate.sourceUrl,
        })),
    }
}

export function extractPageEvidence(url: string, html: string, visibleText = visibleTextFromHtml(html), title: string | null = pageTitle(html), metaDescription: string | null = metaContent(html, ["description", "og:description", "twitter:description"]), options: PageExtractionOptions = {}): PageExtraction {
    const businessNames = options.businessNames ?? []
    const stageKey = options.stageKey ?? "owner_identity"
    const candidates = applyDeterministicGate(pageOwnerCandidates(url, html, visibleText, title, metaDescription, businessNames), businessNames)
    return buildPageExtraction(url, html, visibleText, candidates, stageKey)
}

export async function extractPageEvidenceWithPersonGate(url: string, html: string, visibleText = visibleTextFromHtml(html), title: string | null = pageTitle(html), metaDescription: string | null = metaContent(html, ["description", "og:description", "twitter:description"]), options: PageExtractionOptions = {}): Promise<PageExtraction> {
    const businessNames = options.businessNames ?? []
    const stageKey = options.stageKey ?? "owner_identity"
    const candidates = await applyPersonNameGate(pageOwnerCandidates(url, html, visibleText, title, metaDescription, businessNames), businessNames)
    return buildPageExtraction(url, html, visibleText, candidates, stageKey)
}
