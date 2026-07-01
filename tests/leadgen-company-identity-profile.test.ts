import assert from "node:assert/strict"
import test from "node:test"

import {
    extractCompanyIdentityProfile,
    mergeCompanyIdentity,
} from "../lib/leadgen/company-identity-profile.ts"

test("extracts legal entity identity from a Texas franchise-tax style row", () => {
    const profile = extractCompanyIdentityProfile({
        name: "JJS Home Services LLC",
        dba_name: "Joe's Flooring",
        taxpayer_id: "32012345678",
        sos_file_number: "0801234567",
        mailing_address_street: "901 Market St",
        mailing_address_city: "Austin",
        mailing_address_state: "TX",
        mailing_address_zip: "78701",
        sos_registration_status: "Active",
        record_type: "Texas franchise tax Public Information Report officer",
    }, {
        sourceKey: "registry.tx.comptroller",
        sourceLabel: "Texas Comptroller franchise tax officers",
        confidence: 91,
        seedDisplayName: "Joe's Flooring",
    })

    assert.ok(profile)
    assert.equal(profile.legalName, "JJS Home Services LLC")
    assert.equal(profile.dbaName, "Joe's Flooring")
    assert.equal(profile.entityNumber, "32012345678")
    assert.equal(profile.filingId, "0801234567")
    assert.deepEqual(profile.registeredAddress, {
        street: "901 Market St",
        city: "Austin",
        state: "TX",
        postcode: "78701",
        country: "US",
        source: "mailing_address",
    })
    assert.deepEqual(profile.knownAliases, ["Joe's Flooring", "JJS Home Services LLC"])
})

test("merges resolved identity without losing existing aliases", () => {
    const profile = extractCompanyIdentityProfile({
        legal_name: "JJS Home Services LLC",
        business_name: "Joe's Flooring",
        entity_number: "32012345678",
    }, {
        sourceKey: "registry.tx.comptroller",
        confidence: 88,
        seedDisplayName: "Joe Flooring Pros",
    })

    const merged = mergeCompanyIdentity({
        legal_name: null,
        dba_name: null,
        entity_number: null,
        filing_id: null,
        registered_address: {},
        known_aliases: ["Joe Flooring"],
        identity_resolution: {},
        identity_confidence: null,
    }, profile ? [profile] : [])

    assert.ok(merged)
    assert.equal(merged.legal_name, "JJS Home Services LLC")
    assert.equal(merged.dba_name, "Joe's Flooring")
    assert.equal(merged.entity_number, "32012345678")
    assert.deepEqual(merged.known_aliases, [
        "Joe Flooring",
        "JJS Home Services LLC",
        "Joe's Flooring",
        "Joe Flooring Pros",
    ])
})
