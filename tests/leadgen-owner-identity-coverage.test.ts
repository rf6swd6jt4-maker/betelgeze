import assert from "node:assert/strict"
import test from "node:test"

import {
    pass1CoreOwnerIdentitySourcesByState,
    pass1OwnerIdentityCoverageGaps,
    selectableOwnerIdentityIndustries,
    selectableOwnerIdentityLocations,
} from "../lib/leadgen/owner-identity-coverage.ts"
import {
    executableLeadgenSources,
    leadgenSourceOptions,
    type LeadgenSourceKey,
} from "../lib/leadgen/sources.ts"

test("pass 1 owner-identity coverage covers every selectable industry/location combo without the crawler", () => {
    assert.equal(selectableOwnerIdentityIndustries.length, 45)
    assert.equal(selectableOwnerIdentityLocations.length, 20)
    assert.equal(selectableOwnerIdentityIndustries.length * selectableOwnerIdentityLocations.length, 900)
    assert.deepEqual(pass1OwnerIdentityCoverageGaps(), [])
})

test("pass 1 core owner-identity sources are listed in Settings and runnable by polls", () => {
    const settingsSourceKeys = new Set(leadgenSourceOptions.map((source) => source.value))
    const sourceKeys = Object.values(pass1CoreOwnerIdentitySourcesByState).flat()

    for (const sourceKey of sourceKeys) {
        assert.notEqual(sourceKey, "website")
        assert.equal(settingsSourceKeys.has(sourceKey as Exclude<LeadgenSourceKey, "state_licensing">), true, `${sourceKey} is missing from Settings source options`)
        assert.equal(executableLeadgenSources.has(sourceKey as LeadgenSourceKey), true, `${sourceKey} is not runnable by the poll source planner`)
    }
})
