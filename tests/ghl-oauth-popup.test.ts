import assert from "node:assert/strict"
import test from "node:test"
import { ghlPopupResponse } from "../lib/ghl-oauth/popup-response.ts"

test("callback returns a private, nonce-protected handoff without exposing authorization state", async () => {
    const state = "s".repeat(43)
    for (const ok of [true, false]) {
        const response = ghlPopupResponse(state, ok), html = await response.text()
        assert.equal(response.status, ok ? 200 : 400)
        assert.equal(response.headers.get("cache-control"), "private, no-store")
        assert.equal(response.headers.get("referrer-policy"), "no-referrer")
        assert.equal(response.headers.get("location"), null)
        assert.equal(html.includes(state), false)
        const nonce = html.match(/<script nonce="([^"]+)"/)![1]
        assert.ok(response.headers.get("content-security-policy")!.includes(`script-src 'nonce-${nonce}'`))
        assert.match(html, /history.replaceState/)
        assert.match(html, /typeof BroadcastChannel/)
        assert.match(html, /Return to your original Betelgeze window/)
    }
})
