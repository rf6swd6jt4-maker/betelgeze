import assert from "node:assert/strict"
import test from "node:test"

import {
    assessOfficialRecordMatch,
    buildOfficialRecordSearchTerms,
    officialRecordMatchAllowedByPolicy,
} from "../lib/leadgen/official-record-matching.ts"

const candidate = {
    display_name: "Austin Flooring Pros",
    canonical_name: "Austin Flooring Pros",
    phone: "(512) 555-1212",
    website_domain: "austinflooringpros.com",
    website_url: "https://www.austinflooringpros.com",
    profile_url: null,
    source_record_id: "overture:abc123",
    address: {
        street: "123 S Lamar Blvd Ste 200",
        city: "Austin",
        state: "TX",
        postcode: "78704",
    },
    latitude: 30.246,
    longitude: -97.765,
}

test("builds official-record search terms from names plus broad business signals", () => {
    const terms = buildOfficialRecordSearchTerms(candidate, { includeNonNameSignals: true, maxTerms: 10 })

    assert.ok(terms.includes("Austin Flooring Pros"))
    assert.ok(terms.some((term) => term.includes("austin floor")))
    assert.ok(terms.includes("5125551212"))
    assert.ok(terms.includes("austinflooringpros.com"))
    assert.ok(terms.includes("123 S Lamar Blvd Ste 200"))
})

test("matches a DBA row even when the legal name is different", () => {
    const assessment = assessOfficialRecordMatch({
        legal_name: "AFP Home Services LLC",
        dba_name: "Austin Flooring Pros",
        phone: "512-555-1212",
        street: "123 South Lamar Boulevard",
        city: "Austin",
        state: "TX",
        zip: "78704",
    }, candidate)

    assert.equal(assessment.matched, true)
    assert.ok(assessment.confidence >= 90)
    assert.ok(assessment.reasons.includes("exact business phone"))
})

test("rescues a legal-name mismatch with address and phone evidence", () => {
    const assessment = assessOfficialRecordMatch({
        legal_name: "AFP Home Services LLC",
        business_phone: "512.555.1212",
        street: "123 S Lamar Blvd",
        city: "Austin",
        state: "TX",
        postcode: "78704-1200",
    }, candidate)

    assert.equal(assessment.matched, true)
    assert.ok(assessment.confidence >= 90)
    assert.ok(assessment.reasons.includes("same street address"))
})

test("matches contractor near-name variants with compatible city and state", () => {
    const assessment = assessOfficialRecordMatch({
        business_name: "Austin Floor Contractors LLC",
        city: "Austin",
        state: "TX",
    }, candidate)

    assert.equal(assessment.matched, true)
    assert.ok(assessment.confidence >= 72)
})

test("matches rows by business domain when record names differ", () => {
    const assessment = assessOfficialRecordMatch({
        legal_name: "AFP Holdings LLC",
        website: "https://austinflooringpros.com/contact",
        city: "Austin",
        state: "TX",
    }, candidate)

    assert.equal(assessment.matched, true)
    assert.ok(assessment.confidence >= 90)
    assert.ok(assessment.reasons.includes("shared website domain"))
})

test("rejects same-city records without a real identity signal", () => {
    const assessment = assessOfficialRecordMatch({
        business_name: "Capitol Roof Repair LLC",
        city: "Austin",
        state: "TX",
    }, candidate)

    assert.equal(assessment.matched, false)
    assert.ok(assessment.confidence < 72)
})

test("uses resolved legal entity fields to match later owner-source rows", () => {
    const resolvedCandidate = {
        ...candidate,
        display_name: "Joe's Flooring",
        legal_name: "JJS Home Services LLC",
        dba_name: "Joe's Flooring",
        entity_number: "32012345678",
        filing_id: "0801234567",
        known_aliases: ["Joe Flooring Pros", "JJS Home Services"],
        registered_address: {
            street: "901 Market St",
            city: "Austin",
            state: "TX",
            postcode: "78701",
        },
    }

    const assessment = assessOfficialRecordMatch({
        business_name: "JJS Home Services LLC",
        taxpayer_id: "32012345678",
        street: "901 Market Street",
        city: "Austin",
        state: "TX",
        postcode: "78701",
    }, resolvedCandidate)

    const terms = buildOfficialRecordSearchTerms(resolvedCandidate, { includeNonNameSignals: true, maxTerms: 10 })

    assert.equal(assessment.matched, true)
    assert.ok(assessment.confidence >= 96)
    assert.ok(terms.includes("JJS Home Services LLC"))
    assert.ok(terms.includes("32012345678"))
})

test("allows exact California owner-shard matches without extra address evidence", () => {
    const californiaCandidate = {
        ...candidate,
        display_name: "Golden State Roofing LLC",
        canonical_name: "Golden State Roofing LLC",
        phone: null,
        website_domain: null,
        website_url: null,
        address: { state: "CA" },
        latitude: null,
        longitude: null,
    }
    const assessment = assessOfficialRecordMatch({
        business_name: "GOLDEN STATE ROOFING LLC",
        owner_name: "Maria Santos",
        record_id: "2024123456",
        city: "Los Angeles",
        state: "CA",
    }, californiaCandidate)

    assert.equal(assessment.matched, true)
    assert.equal(officialRecordMatchAllowedByPolicy(assessment, {
        adapter: "california_owner_shard_lookup",
        require_address_or_locality_match: true,
    }), true)
})

test("keeps exact name-only matches strict for non-California shard sources", () => {
    const assessment = assessOfficialRecordMatch({
        business_name: "Austin Flooring Pros",
        owner_name: "Maria Santos",
        city: "Austin",
        state: "TX",
    }, {
        ...candidate,
        phone: null,
        website_domain: null,
        website_url: null,
        address: { state: "TX" },
        latitude: null,
        longitude: null,
    })

    assert.equal(assessment.matched, true)
    assert.equal(officialRecordMatchAllowedByPolicy(assessment, {
        adapter: "socrata_public_records",
        require_address_or_locality_match: true,
    }), false)
})
