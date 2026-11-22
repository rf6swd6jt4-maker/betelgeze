import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { handleCampaignIntake, handleCampaignIntakePreflight, normalizeUsPhone, parseCampaignIntake, type CampaignIntakeDependencies } from "../lib/campaigns/intake.ts"

const KEY = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
const ORIGIN = "https://go.scaylup.com"
const CONSENT = "By submitting, you agree to receive calls and texts from Scaylup about your request. Reply STOP to opt out."

function body(overrides: Record<string, unknown> = {}) {
    return {
        version: 1,
        submission_id: "6f0b8c1e-5a0e-4b6f-9d55-2f1c7a9e4b10",
        offer: "teardown",
        answers: [{ id: "trade", question: "What kind of work do you do?", answer: "Roofing" }],
        contact: { first_name: " Marcus ", last_name: "Hale", company: "Hale Roofing", phone: "(512) 555-0142", email: "Marcus@HaleRoofing.example" },
        consent: { agreed: true, text: CONSENT },
        attribution: { page_url: "https://go.scaylup.com/teardown/?utm_source=facebook", utm_source: "facebook", fbclid: "IwAR1" },
        website: "",
        ...overrides,
    }
}

function deps(overrides: Partial<CampaignIntakeDependencies> = {}) {
    const stored: unknown[] = []
    const value: CampaignIntakeDependencies = {
        enabled: true,
        ipSecret: "test-secret",
        target: async key => key === KEY ? { status: "live", allowed_origins: [ORIGIN] } : null,
        store: async (_key, input) => { stored.push(input); return { accepted: true, reference: "a".repeat(64) } },
        ...overrides,
    }
    return { value, stored }
}

function post(payload: unknown, headers: Record<string, string> = {}) {
    return new Request(`https://app.example/api/campaigns/intake/${KEY}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "x-real-ip": "203.0.113.7", ...headers },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
    })
}

test("US phone numbers normalize to +1 and other numbers are refused", () => {
    assert.equal(normalizeUsPhone("(512) 555-0142"), "+15125550142")
    assert.equal(normalizeUsPhone("1 512 555 0142"), "+15125550142")
    assert.equal(normalizeUsPhone("+1 512-555-0142"), "+15125550142")
    assert.equal(normalizeUsPhone("555-0142"), null)
    assert.equal(normalizeUsPhone("+44 20 7946 0958"), null)
    assert.equal(normalizeUsPhone("(112) 555-0142"), null, "area codes cannot start with 1")
    assert.equal(normalizeUsPhone("+5125550142"), null, "a plus sign needs the country code")
})

test("a valid submission is normalized and its consent wording is hashed", () => {
    const parsed = parseCampaignIntake(body())
    assert.ok(parsed.ok && !parsed.bot)
    assert.equal(parsed.input.first_name, "Marcus")
    assert.equal(parsed.input.phone_e164, "+15125550142")
    assert.equal(parsed.input.email, "marcus@haleroofing.example")
    assert.equal(parsed.input.consent_sha256, createHash("sha256").update(CONSENT).digest("hex"))
    assert.deepEqual(parsed.input.attribution, { page_url: "https://go.scaylup.com/teardown/?utm_source=facebook", utm_source: "facebook", fbclid: "IwAR1" })
})

test("each broken rule names the field that broke it", () => {
    const cases: [Record<string, unknown>, string][] = [
        [{ version: 2 }, "version"],
        [{ submission_id: "not-a-uuid" }, "submission_id"],
        [{ offer: "Tear Down" }, "offer"],
        [{ answers: [] }, "answers"],
        [{ answers: [{ id: "trade", question: "", answer: "Roofing" }] }, "answers.0.question"],
        [{ contact: { first_name: "", phone: "5125550142" } }, "contact.first_name"],
        [{ contact: { first_name: "Ann", phone: "555" } }, "contact.phone"],
        [{ contact: { first_name: "Ann", phone: "5125550142", email: "nope" } }, "contact.email"],
        [{ contact: { first_name: "Ann", phone: "5125550142", nickname: "A" } }, "contact.nickname"],
        [{ consent: { agreed: false, text: CONSENT } }, "consent.agreed"],
        [{ consent: { agreed: true, text: "Too short" } }, "consent.text"],
        [{ attribution: { page_url: "http://go.scaylup.com/" } }, "attribution.page_url"],
        [{ attribution: { gclid: "x" } }, "attribution.gclid"],
        [{ extra: true }, "extra"],
    ]
    for (const [override, field] of cases) {
        const parsed = parseCampaignIntake(body(override))
        assert.ok(!parsed.ok, `expected ${field} to fail`)
        assert.equal(parsed.field, field)
    }
})

test("a filled hidden field is answered as accepted and nothing is stored", async () => {
    const { value, stored } = deps()
    const response = await handleCampaignIntake(post(body({ website: "http://spam.example" })), KEY, value)
    assert.equal(response.status, 202)
    assert.equal((await response.json()).accepted, true)
    assert.equal(stored.length, 0)
})

test("an accepted lead is stored with an IP HMAC, never the IP, and the origin is allowed back", async () => {
    const { value, stored } = deps()
    const response = await handleCampaignIntake(post(body()), KEY, value)
    assert.equal(response.status, 202)
    assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(await response.json(), { accepted: true, reference: "a".repeat(64) })
    const input = stored[0] as Record<string, unknown>
    assert.match(String(input.ip_hmac), /^[a-f0-9]{64}$/)
    assert.ok(!JSON.stringify(input).includes("203.0.113.7"))
})

test("intake that is switched off, unknown, archived or from another origin stores nothing", async () => {
    const off = deps({ enabled: false })
    assert.equal((await handleCampaignIntake(post(body()), KEY, off.value)).status, 503)
    const any = deps()
    assert.equal((await handleCampaignIntake(post(body()), "B".repeat(32), any.value)).status, 404)
    assert.equal((await handleCampaignIntake(post(body()), "short", any.value)).status, 404)
    assert.equal((await handleCampaignIntake(post(body(), { origin: "https://evil.example" }), KEY, any.value)).status, 403)
    const archived = deps({ target: async () => ({ status: "archived", allowed_origins: [ORIGIN] }) })
    assert.equal((await handleCampaignIntake(post(body()), KEY, archived.value)).status, 404)
    assert.equal(off.stored.length + any.stored.length + archived.stored.length, 0)
})

test("a paused campaign still accepts leads", async () => {
    const { value, stored } = deps({ target: async () => ({ status: "paused", allowed_origins: [ORIGIN] }) })
    assert.equal((await handleCampaignIntake(post(body()), KEY, value)).status, 202)
    assert.equal(stored.length, 1)
})

test("oversized, malformed and unstorable leads get the matching answer", async () => {
    const { value } = deps()
    const big = JSON.stringify(body({ answers: [{ id: "trade", question: "Q?", answer: "x".repeat(40_000) }] }))
    assert.equal((await handleCampaignIntake(post(big), KEY, value)).status, 413)
    assert.equal((await handleCampaignIntake(post("{not json"), KEY, value)).status, 400)
    const limited = deps({ store: async () => ({ failure: "rate_limited" }) })
    assert.equal((await handleCampaignIntake(post(body()), KEY, limited.value)).status, 429)
    const broken = deps({ store: async () => { throw new Error("database down") } })
    const response = await handleCampaignIntake(post(body()), KEY, broken.value)
    assert.equal(response.status, 503)
    assert.match((await response.json()).error, /Nothing was stored/)
})

test("the CORS preflight answers only the campaign's own origins", async () => {
    const { value } = deps()
    const allowed = await handleCampaignIntakePreflight(new Request("https://app.example/x", { method: "OPTIONS", headers: { origin: ORIGIN } }), KEY, value)
    assert.equal(allowed.status, 204)
    assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN)
    assert.equal(allowed.headers.get("access-control-allow-headers"), "Content-Type")
    const refused = await handleCampaignIntakePreflight(new Request("https://app.example/x", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), KEY, value)
    assert.equal(refused.status, 403)
    assert.equal(refused.headers.get("access-control-allow-origin"), null)
})
