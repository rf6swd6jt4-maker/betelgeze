import { createHash, createHmac } from "node:crypto"

// Public lead intake for Scaylup's own landing-page funnels. Contract: docs/campaign-intake.md.

export const CAMPAIGN_INTAKE_MAX_BYTES = 32_768
const READ_DEADLINE_MS = 10_000
const KEY = /^[A-Za-z0-9_-]{32}$/
const SLUG = /^[a-z0-9_-]{1,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOP_LEVEL = new Set(["version", "submission_id", "offer", "answers", "contact", "consent", "attribution", "website"])
const CONTACT = new Set(["first_name", "last_name", "company", "phone", "email"])
const ATTRIBUTION = ["page_url", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "fbc", "fbp"] as const

export type CampaignIntakeInput = {
    submission_id: string
    offer: string
    answers: { id: string; question: string; answer: string }[]
    first_name: string
    last_name: string | null
    company: string | null
    phone_e164: string
    email: string | null
    consent_text: string
    consent_sha256: string
    attribution: Partial<Record<(typeof ATTRIBUTION)[number], string>>
}

export type ParsedIntake =
    | { ok: true; bot: false; input: CampaignIntakeInput }
    | { ok: true; bot: true }
    | { ok: false; field: string; error: string }

type StoreResult = { accepted?: boolean; reference?: string; failure?: string }
type Target = { status: string; allowed_origins: string[] } | null

export type CampaignIntakeDependencies = {
    enabled: boolean
    ipSecret: string
    target: (key: string) => Promise<Target>
    store: (key: string, input: CampaignIntakeInput & { ip_hmac: string; user_agent: string | null }) => Promise<StoreResult>
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const fail = (field: string, error: string): ParsedIntake => ({ ok: false, field, error })

function text(value: unknown, max: number, min = 0): string | null | undefined {
    if (value == null) return min ? undefined : null
    if (typeof value !== "string") return undefined
    const trimmed = value.trim().replace(/\s+/g, " ")
    if (!trimmed) return min ? undefined : null
    return trimmed.length >= min && trimmed.length <= max ? trimmed : undefined
}

/** US numbers only: the funnels serve Texas businesses. Returns +1XXXXXXXXXX or null. */
export function normalizeUsPhone(value: unknown): string | null {
    if (typeof value !== "string" || value.length > 40) return null
    const plus = value.trim().startsWith("+")
    const digits = value.replace(/\D/g, "")
    let national: string
    if (digits.length === 10 && !plus) national = digits
    else if (digits.length === 11 && digits.startsWith("1")) national = digits.slice(1)
    else return null
    // NANP: area code and exchange cannot start with 0 or 1.
    return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null
}

export function parseCampaignIntake(body: unknown): ParsedIntake {
    if (!object(body)) return fail("body", "Send a JSON object.")
    for (const key of Object.keys(body)) if (!TOP_LEVEL.has(key)) return fail(key, "This field is not part of the intake format.")
    if (body.website != null && body.website !== "") return { ok: true, bot: true }
    if (body.version !== 1) return fail("version", "Version must be 1.")
    if (typeof body.submission_id !== "string" || !UUID.test(body.submission_id)) return fail("submission_id", "Send a UUID made once per submission.")
    if (typeof body.offer !== "string" || !SLUG.test(body.offer)) return fail("offer", "Offer must be 1 to 64 lowercase letters, digits, hyphens or underscores.")

    if (!Array.isArray(body.answers) || body.answers.length < 1 || body.answers.length > 20) return fail("answers", "Send 1 to 20 answers.")
    const answers: CampaignIntakeInput["answers"] = []
    for (const [index, item] of body.answers.entries()) {
        if (!object(item) || typeof item.id !== "string" || !SLUG.test(item.id)) return fail(`answers.${index}.id`, "Each answer needs an id of 1 to 64 lowercase letters, digits, hyphens or underscores.")
        const question = text(item.question, 300, 1), answer = text(item.answer, 300, 1)
        if (!question) return fail(`answers.${index}.question`, "Each answer needs its question, 1 to 300 characters.")
        if (!answer) return fail(`answers.${index}.answer`, "Each answer needs a value, 1 to 300 characters.")
        answers.push({ id: item.id, question, answer })
    }

    const contact = body.contact
    if (!object(contact)) return fail("contact", "Send the contact details.")
    for (const key of Object.keys(contact)) if (!CONTACT.has(key)) return fail(`contact.${key}`, "This field is not part of the intake format.")
    const first = text(contact.first_name, 80, 1)
    if (!first) return fail("contact.first_name", "First name is required, up to 80 characters.")
    const last = text(contact.last_name, 80)
    if (last === undefined) return fail("contact.last_name", "Last name can be up to 80 characters.")
    const company = text(contact.company, 160)
    if (company === undefined) return fail("contact.company", "Business name can be up to 160 characters.")
    const phone = normalizeUsPhone(contact.phone)
    if (!phone) return fail("contact.phone", "Send a 10-digit US mobile number.")
    const email = text(contact.email, 254)
    if (email === undefined || (email && !EMAIL.test(email))) return fail("contact.email", "Email must look like an address, up to 254 characters.")

    const consent = body.consent
    if (!object(consent) || consent.agreed !== true) return fail("consent.agreed", "Consent must be given before a lead is sent.")
    if (typeof consent.text !== "string") return fail("consent.text", "Send the consent wording shown on the form.")
    const consentText = consent.text.trim()
    if (consentText.length < 20 || consentText.length > 2000) return fail("consent.text", "Consent wording must be 20 to 2,000 characters.")

    const attribution: CampaignIntakeInput["attribution"] = {}
    if (body.attribution != null) {
        if (!object(body.attribution)) return fail("attribution", "Attribution must be an object.")
        for (const [key, value] of Object.entries(body.attribution)) {
            if (!(ATTRIBUTION as readonly string[]).includes(key)) return fail(`attribution.${key}`, "This field is not part of the intake format.")
            if (value == null || value === "") continue
            if (typeof value !== "string") return fail(`attribution.${key}`, "Attribution values must be text.")
            if (key === "page_url") {
                let url: URL | null = null
                try { url = new URL(value) } catch { /* reported below */ }
                if (value.length > 2000 || url?.protocol !== "https:") return fail("attribution.page_url", "Page URL must be an https address, up to 2,000 characters.")
            } else if (value.length > 500) return fail(`attribution.${key}`, "Attribution values can be up to 500 characters.")
            attribution[key as (typeof ATTRIBUTION)[number]] = value
        }
    }

    return {
        ok: true, bot: false, input: {
            submission_id: body.submission_id.toLowerCase(), offer: body.offer, answers,
            first_name: first, last_name: last, company, phone_e164: phone, email: email ? email.toLowerCase() : null,
            consent_text: consentText, consent_sha256: createHash("sha256").update(consentText, "utf8").digest("hex"),
            attribution,
        },
    }
}

function corsHeaders(origin: string | null): Record<string, string> {
    return origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" } : { Vary: "Origin" }
}

function reply(status: number, body: Record<string, unknown>, origin: string | null = null) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...corsHeaders(origin) } })
}

async function readTarget(key: string, origin: string | null, dependencies: CampaignIntakeDependencies) {
    if (!dependencies.enabled) return { response: reply(503, { error: "Lead intake is switched off." }) }
    if (!KEY.test(key)) return { response: reply(404, { error: "No campaign uses this address." }) }
    let target: Target
    try { target = await dependencies.target(key) } catch { return { response: reply(503, { error: "Lead intake is unavailable. Nothing was stored." }) } }
    if (!target || target.status === "archived") return { response: reply(404, { error: "No campaign uses this address." }) }
    if (!origin || !target.allowed_origins.includes(origin.toLowerCase())) return { response: reply(403, { error: "This page is not allowed to send leads to this campaign." }) }
    return { origin }
}

export async function handleCampaignIntakePreflight(request: Request, key: string, dependencies: CampaignIntakeDependencies) {
    const result = await readTarget(key, request.headers.get("origin"), dependencies)
    return result.response ?? new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ...corsHeaders(result.origin) } })
}

export function clientIp(request: Request): string {
    const real = request.headers.get("x-real-ip")?.trim()
    const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    return (real || forwarded || "unknown").slice(0, 100)
}

async function readBody(request: Request): Promise<{ raw: string } | { status: number; error: string }> {
    const length = request.headers.get("content-length")
    if (length && (!/^\d+$/.test(length) || Number(length) > CAMPAIGN_INTAKE_MAX_BYTES)) return { status: 413, error: "The lead is larger than 32 KB." }
    const reader = request.body?.getReader()
    if (!reader) return { status: 400, error: "Send a JSON object." }
    const chunks: Uint8Array[] = []
    let size = 0, expired = false
    const timeout = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}) }, READ_DEADLINE_MS)
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (expired) return { status: 408, error: "The lead took too long to arrive." }
            if (done) break
            size += value.byteLength
            if (size > CAMPAIGN_INTAKE_MAX_BYTES) { await reader.cancel().catch(() => {}); return { status: 413, error: "The lead is larger than 32 KB." } }
            chunks.push(value)
        }
    } catch { return { status: 400, error: "Send a JSON object." } }
    finally { clearTimeout(timeout); reader.releaseLock() }
    return { raw: Buffer.concat(chunks).toString("utf8") }
}

export async function handleCampaignIntake(request: Request, key: string, dependencies: CampaignIntakeDependencies) {
    const checked = await readTarget(key, request.headers.get("origin"), dependencies)
    if (checked.response) return checked.response
    const origin = checked.origin
    const body = await readBody(request)
    if ("status" in body) return reply(body.status, { error: body.error }, origin)
    let json: unknown
    try { json = JSON.parse(body.raw) } catch { return reply(400, { error: "Send a JSON object.", field: "body" }, origin) }
    const parsed = parseCampaignIntake(json)
    if (!parsed.ok) return reply(400, { error: parsed.error, field: parsed.field }, origin)
    // Bots that fill the hidden field get an ordinary answer and nothing is stored.
    if (parsed.bot) return reply(202, { accepted: true, reference: createHash("sha256").update(body.raw).digest("hex") }, origin)
    const ip_hmac = createHmac("sha256", dependencies.ipSecret).update(clientIp(request)).digest("hex")
    const userAgent = request.headers.get("user-agent")?.slice(0, 300) || null
    let result: StoreResult
    try { result = await dependencies.store(key, { ...parsed.input, ip_hmac, user_agent: userAgent }) }
    catch { return reply(503, { error: "Lead intake is unavailable. Nothing was stored." }, origin) }
    if (result.failure === "rate_limited") return reply(429, { error: "Too many submissions. Try again in a few minutes." }, origin)
    if (result.failure === "campaign") return reply(404, { error: "No campaign uses this address." }, origin)
    if (result.failure === "invalid") return reply(400, { error: "The lead could not be stored as sent.", field: "body" }, origin)
    if (result.accepted !== true || typeof result.reference !== "string") return reply(503, { error: "Lead intake is unavailable. Nothing was stored." }, origin)
    return reply(202, { accepted: true, reference: result.reference }, origin)
}
