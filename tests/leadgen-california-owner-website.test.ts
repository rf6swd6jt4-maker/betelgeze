import assert from "node:assert/strict"
import test from "node:test"

import {
    californiaOwnerIdentityWebsiteUrls,
    isCaliforniaOwnerIdentityProfileUrl,
} from "../lib/leadgen/california-owner-website.ts"
import { defaultWebsiteUrls } from "../lib/leadgen/website-owner-discovery.ts"

test("California owner identity crawl checks real company pages before speculative owner paths", () => {
    const urls = californiaOwnerIdentityWebsiteUrls("https://example.com", 3, "owner_identity")

    assert.deepEqual(urls.slice(0, 5), [
        "https://example.com/",
        "https://example.com/about",
        "https://example.com/about-us",
        "https://example.com/our-story",
        "https://example.com/our-company",
    ])
    assert.ok(urls.indexOf("https://example.com/contact") < urls.indexOf("https://example.com/meet-the-owner"))
    assert.ok(urls.includes("https://example.com/meet-the-owner"))
})

test("California owner identity profile URL filter only rejects third-party profile pages", () => {
    assert.equal(isCaliforniaOwnerIdentityProfileUrl("https://www.google.com/maps?cid=123"), true)
    assert.equal(isCaliforniaOwnerIdentityProfileUrl("https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=872683"), true)
    assert.equal(isCaliforniaOwnerIdentityProfileUrl("https://www.yelp.com/biz/example"), true)
    assert.equal(isCaliforniaOwnerIdentityProfileUrl("https://www.examplecontractor.com/about"), false)
})

test("California owner URL helper preserves normal defaults outside owner identity", () => {
    assert.deepEqual(
        californiaOwnerIdentityWebsiteUrls("https://example.com", 2, "business_validation"),
        defaultWebsiteUrls("https://example.com", 2, "business_validation")
    )
})
