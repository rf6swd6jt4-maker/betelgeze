import assert from "node:assert/strict"
import test from "node:test"

import {
    cautiousClerkOwnerNameFromMatchedParty,
    cautiousCountyPropertyOwnerName,
    hillsboroughOfficialRecordRowsFromResults,
    splitCountyOwnerNames,
} from "../lib/leadgen/florida-county-records.ts"

test("splits and normalises county property owner people without accepting entities", () => {
    assert.deepEqual(splitCountyOwnerNames("SMITH TOBIAS ATTICUS; SMITH MARISSA RRACHELE"), [
        "SMITH TOBIAS ATTICUS",
        "SMITH MARISSA RRACHELE",
    ])
    assert.equal(
        cautiousCountyPropertyOwnerName(["SMITH TOBIAS ATTICUS; SMITH MARISSA RRACHELE"], { lastNameFirst: true }),
        "Tobias Atticus Smith",
    )
    assert.equal(cautiousCountyPropertyOwnerName(["CLOVER KENNEDY LLC"], { lastNameFirst: true }), null)
    assert.equal(cautiousCountyPropertyOwnerName(["SMITH DAVID A TRUSTEE"], { lastNameFirst: true }), null)
})

test("official-record clerk rows score matched businesses without extracting cross-party owners", () => {
    const rows = hillsboroughOfficialRecordRowsFromResults({
        Success: true,
        ResultList: [{
            Instrument: "2025123456",
            DocType: "(NOC) NOTICE OF COMMENCEMENT",
            RecordDate: 1751846400,
            PartiesOne: ["ROBERT CUSTOMER"],
            PartiesTwo: ["ACME FENCE LLC"],
            Legal: "123 SAMPLE ST TAMPA FL",
        }],
    }, {
        candidateName: "Acme Fence",
        searchTerm: "Acme Fence",
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.business_name, "ACME FENCE LLC")
    assert.equal(rows[0]?.owner_name, null)
    assert.equal(rows[0]?.record_type, "(NOC) NOTICE OF COMMENCEMENT")
})

test("official-record clerk rows only extract owner names from matched DBA parties", () => {
    assert.equal(cautiousClerkOwnerNameFromMatchedParty("SMITH JOHN DBA ACME FENCE", "Acme Fence"), "John Smith")
    assert.equal(cautiousClerkOwnerNameFromMatchedParty("ROBERT CUSTOMER", "Acme Fence"), null)
    assert.equal(cautiousClerkOwnerNameFromMatchedParty("ACME FENCE LLC", "Acme Fence"), null)
})
