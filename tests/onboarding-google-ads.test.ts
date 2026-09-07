import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { connectGoogleAdsClient, googleAdsClientError, googleAdsDiagnosticError } from "../lib/google-ads.ts"
import { createConnectionBlock } from "../lib/onboarding/block-definition.ts"
import { formatGoogleAdsCustomerId, googleAdsOnboardingResponse, normalizeGoogleAdsCustomerId } from "../lib/onboarding/google-ads-state.ts"

const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const config = { manager_customer_id: "1234567890", developer_token: "A".repeat(22), client_email: "ads@example.iam.gserviceaccount.com", private_key: key }
const customerId = "0987654321"
const empty = { results: [] }
const hierarchy = { results: [{ customerClient: { id: customerId, level: "2", status: "ENABLED", manager: false } }] }
const detail = { results: [{ customer: { id: customerId, descriptiveName: "Client", currencyCode: "EUR", timeZone: "Europe/Dublin" } }] }
function mock(responses: Array<unknown | Response>) {
    const calls: Array<{ url: string; body: Record<string, unknown>; headers: Headers }> = []
    const fetcher: typeof fetch = async (url, init) => {
        if (String(url).endsWith("/token")) return Response.json({ access_token: "secret-token" })
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) })
        assert.ok(responses.length, "Unexpected Google request")
        const result = responses.shift()
        return result instanceof Response ? result : Response.json(result)
    }
    return { calls, fetcher }
}

test("Google onboarding uses a distinct provider and safely formats customer IDs", () => {
    const block = createConnectionBlock("google_ads")
    assert.equal(block.provider, "google_ads")
    assert.equal(block.label, "Connect Google Ads")
    assert.equal(block.required, true)
    assert.equal(normalizeGoogleAdsCustomerId("098-765-4321"), customerId)
    assert.equal(formatGoogleAdsCustomerId(customerId), "098-765-4321")
    assert.throws(() => normalizeGoogleAdsCustomerId("1234567890 OR 1=1"), /10-digit/)
    assert.equal(googleAdsOnboardingResponse({ customerId }), null)
})

test("new client access sends one pending invitation from the manager and never accepts it", async () => {
    const { calls, fetcher } = mock([empty, empty, { result: { resourceName: "customers/1234567890/customerClientLinks/0987654321~1" } }])
    assert.deepEqual(await connectGoogleAdsClient(config, customerId, true, fetcher), { status: "pending" })
    assert.equal(calls.length, 3)
    assert.equal(calls[2].url, "https://googleads.googleapis.com/v25/customers/1234567890/customerClientLinks:mutate")
    assert.deepEqual(calls[2].body, { operation: { create: { clientCustomer: `customers/${customerId}`, status: "PENDING" } } })
    assert.ok(calls.every((call) => call.headers.get("login-customer-id") === config.manager_customer_id))
    assert.doesNotMatch(JSON.stringify(calls), /customerManagerLinks|"status":"ACTIVE"/)
})

test("owner diagnostics validate invitations without creating them", async () => {
    const { calls, fetcher } = mock([empty, empty, {}])
    assert.deepEqual(await connectGoogleAdsClient(config, customerId, true, fetcher, true), { status: "pending" })
    assert.equal(calls[2].body.validateOnly, true)
    assert.equal(calls.filter((call) => call.url.includes("mutate")).length, 1)
})

test("invitation token restrictions direct the client to an agency-sent request without calling the account test-only", async () => {
    const { fetcher } = mock([empty, empty, Response.json({ error: { details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] }] } }, { status: 403 })])
    await assert.rejects(connectGoogleAdsClient(config, customerId, true, fetcher), (error: Error) => {
        assert.match(googleAdsClientError(error), /agency needs to send this access request from Google Ads/)
        assert.doesNotMatch(googleAdsDiagnosticError(error), /only has test/)
        return true
    })
})

test("diagnostics distinguish the failed operation and retain only safe provider codes", async () => {
    for (const [responses, step] of [
        [[], "account_hierarchy"],
        [[empty], "invitation_lookup"],
        [[empty, empty], "invitation"],
    ] as const) {
        const { fetcher } = mock([...responses, Response.json({ error: { message: key, details: [{ errors: [
            { errorCode: { authorizationError: "USER_PERMISSION_DENIED" }, message: "secret-token" },
            { errorCode: { internalError: key } },
        ] }] } }, { status: 403 })])
        await assert.rejects(connectGoogleAdsClient(config, customerId, true, fetcher, true), (error: Error) => {
            const message = googleAdsDiagnosticError(error)
            assert.ok(message.includes(`[${step}; HTTP 403; USER_PERMISSION_DENIED]`))
            if (step === "invitation") assert.match(message, /Admin access/)
            assert.doesNotMatch(message, /PRIVATE KEY|secret-token/)
            assert.doesNotMatch(googleAdsClientError(error), /USER_PERMISSION_DENIED|HTTP/)
            return true
        })
    }
})

test("retries reuse pending invitations and verification never sends a new request", async () => {
    for (const send of [true, false]) {
        const { calls, fetcher } = mock([empty, { results: [{ customerClientLink: { status: "PENDING" } }] }])
        assert.equal((await connectGoogleAdsClient(config, customerId, send, fetcher)).status, "pending")
        assert.equal(calls.length, 2)
        assert.ok(calls.every((call) => !call.url.includes("mutate")))
    }
    const absent = mock([empty, empty])
    await assert.rejects(connectGoogleAdsClient(config, customerId, false, absent.fetcher), /no active or pending invitation/)
    assert.equal(absent.calls.length, 2)
})

test("existing inherited access must also pass a read against the exact client before connection", async () => {
    const { calls, fetcher } = mock([hierarchy, detail])
    assert.deepEqual(await connectGoogleAdsClient(config, customerId, false, fetcher), { status: "connected", accountName: "Client", currency: "EUR", timeZone: "Europe/Dublin" })
    assert.match(calls[1].url, /customers\/0987654321\/googleAds:search$/)
    assert.equal(calls[1].headers.get("login-customer-id"), config.manager_customer_id)
    const wrong = mock([hierarchy, { results: [{ customer: { id: "9999999999" } }] }])
    await assert.rejects(connectGoogleAdsClient(config, customerId, true, wrong.fetcher), /could not confirm/)
})

test("inactive accounts, manager accounts, Google test accounts and malformed IDs cannot complete", async () => {
    for (const [field, value, message] of [["manager", true, /individual account/], ["status", "SUSPENDED", /not active/]] as const) {
        const fixture = { results: [{ customerClient: { ...hierarchy.results[0].customerClient, [field]: value } }] }
        await assert.rejects(connectGoogleAdsClient(config, customerId, false, mock([fixture]).fetcher), message)
    }
    await assert.rejects(connectGoogleAdsClient(config, customerId, false, mock([hierarchy, { results: [{ customer: { ...detail.results[0].customer, testAccount: true } }] }]).fetcher), /real Google Ads account/)
    await assert.rejects(connectGoogleAdsClient(config, config.manager_customer_id, true, mock([]).fetcher), /account that runs/)
    await assert.rejects(connectGoogleAdsClient(config, "invalid", true, mock([]).fetcher), /10-digit/)
})

test("an active link without readable hierarchy stays pending and provider failures do not expose secrets", async () => {
    const active = mock([empty, { results: [{ customerClientLink: { status: "ACTIVE" } }] }])
    assert.equal((await connectGoogleAdsClient(config, customerId, false, active.fetcher)).status, "pending")
    const denied = mock([empty, empty, Response.json({ error: { message: key, details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] }] } }, { status: 403 })])
    await assert.rejects(connectGoogleAdsClient(config, customerId, true, denied.fetcher), (error: Error) => {
        assert.match(googleAdsClientError(error), /agency.*needs attention/)
        assert.doesNotMatch(googleAdsClientError(error), /PRIVATE KEY|secret-token/)
        return true
    })
})

test("database completion is service-only, token-bound, race-checked, and preserves existing block types", () => {
    const sql = readFileSync("supabase/migrations/20260907010000_onboarding_google_ads_connections.sql", "utf8")
    assert.match(sql, /session\.token_revoked_at is null/)
    assert.match(sql, /step\.superseded_at is null/)
    assert.match(sql, /sale\.consent_confirmed_at is not null/)
    assert.match(sql, /item\.status = 'done'/)
    assert.match(sql, /unique \(workspace_id, customer_id\)/)
    assert.match(sql, /attempt_id = p_attempt_id for update/)
    assert.match(sql, /config_encrypted is distinct from p_expected_config/)
    assert.match(sql, /if p_status = 'connected' then\s+insert into public.onboarding_block_requirements/)
    assert.match(sql, /revoke all on function public.finish_google_ads_onboarding[^;]+from public, anon, authenticated/)
    assert.match(sql, /'calendar_scheduled', 'meta_ads_connected', 'google_ads_connected', 'appointment_medium_configured', 'appointment_fields_configured'/)
    assert.match(sql, /v_block->>'kind' = 'calendar'/)
    const guard = readdirSync("supabase/migrations").sort().map((file) => readFileSync(`supabase/migrations/${file}`, "utf8")).findLast((source) => source.includes("create or replace function public.enforce_onboarding_block_requirements()"))!
    assert.match(guard, /and not session\.is_test/)
})
