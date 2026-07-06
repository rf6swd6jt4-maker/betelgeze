import assert from "node:assert/strict"
import test from "node:test"

import {
    fragileHtmlPublicRecordSources,
    looksLikeGuardedOrAppShell,
    publicRecordPollUnsafeReason,
} from "../lib/leadgen/public-record-source-safety.ts"

test("fragile source keys require explicit poll-safe metadata before poll-time activation", () => {
    const reason = publicRecordPollUnsafeReason("registry.fl.sunbiz", "Florida Sunbiz officers", {
        adapter: "guarded_html_search",
        search_url: "https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults/EntityName/{query}/Page1",
    })

    assert.match(reason ?? "", /stable API, data-download index, or source-specific endpoint/)
})

test("fragile source keys can opt in to guarded poll attempts explicitly", () => {
    for (const sourceKey of fragileHtmlPublicRecordSources) {
        assert.equal(publicRecordPollUnsafeReason(sourceKey, sourceKey, {
            adapter: "guarded_html_search",
            poll_safe_html: true,
            search_url: "https://example.test/search?q={query}",
        }), null, sourceKey)
    }
})

test("generic guarded html adapters are not poll safe by default", () => {
    const reason = publicRecordPollUnsafeReason("registry.example.local", "Example Registry", {
        adapter: "guarded_html_search",
        search_url: "https://example.test/search?q={query}",
    })

    assert.match(reason ?? "", /generic guarded HTML adapter/)
})

test("stable public-record adapters remain poll safe", () => {
    assert.equal(publicRecordPollUnsafeReason("registry.tx.comptroller", "Texas Comptroller taxable entities", {
        adapter: "texas_comptroller_franchise_tax",
    }), null)
    assert.equal(publicRecordPollUnsafeReason("registry.ca.los_angeles_fbn", "Los Angeles County FBN", {
        adapter: "arcgis_feature_service",
    }), null)
})

test("detects challenge pages and client app shells before parsing rows", () => {
    assert.equal(looksLikeGuardedOrAppShell("<title>Just a moment...</title><span>Enable JavaScript and cookies to continue</span>"), true)
    assert.equal(looksLikeGuardedOrAppShell("<body><app-root></app-root><script src=\"https://www.google.com/recaptcha/api.js\"></script></body>"), true)
    assert.equal(looksLikeGuardedOrAppShell("<div id=\"auraLoadingBox\"><span>Loading</span></div><div id=\"auraErrorMask\"></div>"), true)
    assert.equal(looksLikeGuardedOrAppShell("<table><tr><td>Austin Flooring Pros LLC</td><td>Active</td></tr></table>"), false)
})
