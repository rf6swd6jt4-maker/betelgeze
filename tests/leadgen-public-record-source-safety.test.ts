import assert from "node:assert/strict"
import test from "node:test"

import {
    classifyPublicRecordFailure,
    fragileHtmlPublicRecordSources,
    guardedHtmlReplacementRequiredSources,
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
        if (guardedHtmlReplacementRequiredSources.has(sourceKey)) continue
        assert.equal(publicRecordPollUnsafeReason(sourceKey, sourceKey, {
            adapter: "guarded_html_search",
            poll_safe_html: true,
            search_url: "https://example.test/search?q={query}",
        }), null, sourceKey)
    }
})

test("Arizona guarded HTML sources require replacement adapters even with poll-safe metadata", () => {
    for (const sourceKey of guardedHtmlReplacementRequiredSources) {
        assert.match(publicRecordPollUnsafeReason(sourceKey, sourceKey, {
            adapter: "guarded_html_search",
            poll_safe_html: true,
            search_url: "https://example.test/search?q={query}",
        }) ?? "", /external shard lookup|source-specific endpoint/, sourceKey)
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

test("retired Supabase Sunbiz index is not poll safe", () => {
    const reason = publicRecordPollUnsafeReason("registry.fl.sunbiz", "Florida Sunbiz officers", {
        adapter: "sunbiz_owner_index",
    })

    assert.match(reason ?? "", /retired Supabase Sunbiz bulk index/)
})

test("Sunbiz requires the external shard adapter before poll-time activation", () => {
    assert.match(publicRecordPollUnsafeReason("registry.fl.sunbiz", "Florida Sunbiz officers", {
        adapter: "sunbiz_external_lookup_required",
    }) ?? "", /external Sunbiz file\/shard lookup/)

    assert.equal(publicRecordPollUnsafeReason("registry.fl.sunbiz", "Florida Sunbiz officers", {
        adapter: "sunbiz_shard_lookup",
    }), null)
})

test("Arizona owner shards are poll safe while guarded trade-name HTML is not", () => {
    assert.match(publicRecordPollUnsafeReason("registry.az.trade_names", "Arizona Secretary of State trade names", {
        adapter: "guarded_html_search",
        search_url: "https://apps.azsos.gov/apps/tntp/index.html",
    }) ?? "", /stable API, data-download index, external shard lookup, or source-specific endpoint/)

    assert.equal(publicRecordPollUnsafeReason("registry.az.trade_names", "Arizona Secretary of State trade names", {
        adapter: "az_owner_shard_lookup",
    }), null)
})

test("detects challenge pages and client app shells before parsing rows", () => {
    assert.equal(looksLikeGuardedOrAppShell("<title>Just a moment...</title><span>Enable JavaScript and cookies to continue</span>"), true)
    assert.equal(looksLikeGuardedOrAppShell("<body><app-root></app-root><script src=\"https://www.google.com/recaptcha/api.js\"></script></body>"), true)
    assert.equal(looksLikeGuardedOrAppShell("<div id=\"auraLoadingBox\"><span>Loading</span></div><div id=\"auraErrorMask\"></div>"), true)
    assert.equal(looksLikeGuardedOrAppShell("<table><tr><td>Austin Flooring Pros LLC</td><td>Active</td></tr></table>"), false)
})

test("classifies source-scoped public-record failures for circuit breaking", () => {
    assert.deepEqual(classifyPublicRecordFailure(new Error("Florida Sunbiz returned an anti-bot, captcha, app shell, or geo-block challenge instead of public records.")), {
        kind: "challenge",
        healthStatus: "blocked",
        sourceScoped: true,
        skipRemainingTasks: true,
    })
    assert.deepEqual(classifyPublicRecordFailure(new Error("https://example.test timed out after 18 seconds.")), {
        kind: "timeout",
        healthStatus: "degraded",
        sourceScoped: true,
        skipRemainingTasks: true,
    })
})

test("does not circuit-break the whole source for parser misses", () => {
    assert.deepEqual(classifyPublicRecordFailure(new Error("Example Registry responded, but no parseable public-record rows were found.")), {
        kind: "parser",
        healthStatus: "degraded",
        sourceScoped: false,
        skipRemainingTasks: false,
    })
})
