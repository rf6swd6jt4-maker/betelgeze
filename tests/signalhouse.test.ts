import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { verifySignalHouseSignature } from "../lib/signalhouse/signature.ts"
import { e164ToSignalHouse, formatSmsNumber, signalHouseKeyExpiry, signalHousePhoneToE164, smsNumberCanSend, smsNumberName } from "../lib/signalhouse/model.ts"

const secret = "a".repeat(64)
const previous = "b".repeat(64)
const body = JSON.stringify({ timestamp: "2026-11-22T15:00:00.000Z", event: "MESSAGE_DELIVERED", identifier: "m1", metaData: {} })
const now = 1_795_400_000_000
const sign = (key: string, ts: number, raw = body) => createHmac("sha256", key).update(`${ts}.${raw}`).digest("hex")
const headers = (over: Partial<{ timestamp: string | null; signature: string | null; signatureV1: string | null }>) => ({ timestamp: null, signature: null, signatureV1: null, ...over })

test("a SignalHouse delivery is accepted only with a fresh signature over timestamp and raw body", () => {
    const v1 = `t=${now},v1=${sign(secret, now)}`
    assert.equal(verifySignalHouseSignature({ rawBody: body, headers: headers({ signatureV1: v1 }), secrets: [secret], now }).valid, true)
    assert.equal(verifySignalHouseSignature({ rawBody: body, headers: headers({ timestamp: String(now), signature: sign(secret, now) }), secrets: [secret], now }).valid, true)
    // During a rotation the V1 header carries both secrets' signatures; either current secret matches.
    assert.equal(verifySignalHouseSignature({ rawBody: body, headers: headers({ signatureV1: `t=${now},v1=${sign(secret, now)},v1=${sign(previous, now)}` }), secrets: [previous], now }).valid, true)
    assert.equal(verifySignalHouseSignature({ rawBody: body + " ", headers: headers({ signatureV1: v1 }), secrets: [secret], now }).reason, "mismatch")
    assert.equal(verifySignalHouseSignature({ rawBody: body, headers: headers({ signatureV1: v1 }), secrets: [previous], now }).reason, "mismatch")
    assert.equal(verifySignalHouseSignature({ rawBody: body, headers: headers({ signatureV1: v1 }), secrets: [secret], now: now + 6 * 60_000 }).reason, "stale")
    assert.equal(verifySignalHouseSignature({ rawBody: body, headers: headers({}), secrets: [secret], now }).reason, "unsigned")
    assert.equal(verifySignalHouseSignature({ rawBody: body, headers: headers({ signatureV1: v1 }), secrets: [], now }).reason, "no_secret")
    assert.equal(verifySignalHouseSignature({ rawBody: body, headers: headers({ signatureV1: `t=${now},v1=zz` }), secrets: [secret], now }).valid, false)
})

test("SignalHouse numbers convert between its digits and +E.164, and only READY numbers on an ACTIVE registration send", () => {
    assert.equal(signalHousePhoneToE164("15125550199"), "+15125550199")
    assert.equal(signalHousePhoneToE164("5125550199"), "+15125550199")
    assert.equal(signalHousePhoneToE164("+1 (512) 555-0199"), "+15125550199")
    assert.equal(signalHousePhoneToE164("1512555019"), null)
    assert.equal(signalHousePhoneToE164("15125550199123"), null)
    assert.equal(e164ToSignalHouse("+15125550199"), "15125550199")
    assert.equal(formatSmsNumber("+15125550199"), "+1 (512) 555-0199")
    assert.equal(smsNumberName({ phone_e164: "+12145550142", label: "Dallas local" }), "+1 (214) 555-0142 · Dallas local")
    assert.equal(smsNumberCanSend({ status: "READY", registration_external_id: "C1" }, "ACTIVE"), true)
    assert.equal(smsNumberCanSend({ status: "READY", registration_external_id: "C1" }, "PENDING_REVIEW"), false)
    assert.equal(smsNumberCanSend({ status: "IN_PROGRESS", registration_external_id: "C1" }, "ACTIVE"), false)
    assert.equal(smsNumberCanSend({ status: "READY", registration_external_id: null }, "ACTIVE"), false)
})

test("the API key's expiry is read from its JWT for display, and anything else gives none", () => {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
    assert.equal(signalHouseKeyExpiry(`${part({ alg: "HS256" })}.${part({ exp: 1_826_000_000 })}.sig`), new Date(1_826_000_000_000).toISOString())
    assert.equal(signalHouseKeyExpiry("not-a-jwt"), null)
    assert.equal(signalHouseKeyExpiry(`${part({})}.${part({ exp: "soon" })}.sig`), null)
})

test("the webhook verifies before storing, stores each delivery once, and answers before re-reading", () => {
    const route = readFileSync("app/api/signalhouse/webhook/[accountId]/route.ts", "utf8")
    assert.ok(route.indexOf("verifySignalHouseSignature") < route.indexOf('from("signalhouse_webhook_events").insert'))
    assert.match(route, /if \(!verified\.valid\) return json\(401/)
    assert.match(route, /insertError\?\.code === "23505"/)
    assert.match(route, /after\(async \(\) => \{/)
    // A transient failure answers 5xx so SignalHouse retries; only a request it should never resend gets a 4xx.
    assert.match(route, /if \(insertError && !duplicate\) return json\(503/)
})
