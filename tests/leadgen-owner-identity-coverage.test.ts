import assert from "node:assert/strict"
import test from "node:test"

import {
    pass1CoreOwnerIdentitySourcesByState,
    pass1OwnerIdentityCoverageGaps,
    pass2NationalOwnerIdentitySources,
    pass2OwnerIdentitySourcesForCombo,
    pass2TransportOwnerIdentityIndustries,
    pass3BayAreaOwnerIdentitySources,
    pass3OwnerIdentitySourcesForCombo,
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

test("pass 2 transport owner-identity source is listed, runnable, and mapped across every selectable location", () => {
    const settingsSourceKeys = new Set(leadgenSourceOptions.map((source) => source.value))

    for (const sourceKey of pass2NationalOwnerIdentitySources) {
        assert.equal(settingsSourceKeys.has(sourceKey), true, `${sourceKey} is missing from Settings source options`)
        assert.equal(executableLeadgenSources.has(sourceKey as LeadgenSourceKey), true, `${sourceKey} is not runnable by the poll source planner`)
    }

    for (const industry of pass2TransportOwnerIdentityIndustries) {
        for (const location of selectableOwnerIdentityLocations) {
            const sources = pass2OwnerIdentitySourcesForCombo(industry, location.value)
            assert.equal(sources.includes("transport.fmcsa_census"), true, `${industry}/${location.value} does not include FMCSA Company Census`)
            assert.equal(sources.includes("website"), false, `${industry}/${location.value} fell back to the crawler`)
        }
    }
})

test("pass 3 Bay Area owner-identity source is listed, runnable, and mapped across every selectable industry", () => {
    const settingsSourceKeys = new Set(leadgenSourceOptions.map((source) => source.value))

    for (const sourceKey of pass3BayAreaOwnerIdentitySources) {
        assert.equal(settingsSourceKeys.has(sourceKey), true, `${sourceKey} is missing from Settings source options`)
        assert.equal(executableLeadgenSources.has(sourceKey as LeadgenSourceKey), true, `${sourceKey} is not runnable by the poll source planner`)
    }

    for (const industry of selectableOwnerIdentityIndustries) {
        const sources = pass3OwnerIdentitySourcesForCombo(industry, "bay_area_ca")
        assert.equal(sources.includes("registry.ca.san_francisco_business_locations"), true, `${industry}/bay_area_ca does not include DataSF registered businesses`)
        assert.equal(sources.includes("website"), false, `${industry}/bay_area_ca fell back to the crawler`)
    }
})

test("v5.4.12 recovery does not schedule failed v5.5 California shard sources", () => {
    const settingsSourceKeys = new Set<string>(leadgenSourceOptions.map((source) => source.value))
    const executableSourceKeys = new Set<string>(executableLeadgenSources)

    assert.deepEqual(pass1CoreOwnerIdentitySourcesByState.CA, ["registry.ca.bizfile"])
    assert.equal(pass3OwnerIdentitySourcesForCombo("fencing_contractors", "san_diego_ca").includes("registry.ca.san_diego_business_tax"), false)
    assert.equal(pass3OwnerIdentitySourcesForCombo("fencing_contractors", "california").includes("registry.ca.san_diego_business_tax"), false)
    assert.equal(settingsSourceKeys.has("registry.ca.san_diego_business_tax"), false)
    assert.equal(executableSourceKeys.has("registry.ca.san_diego_business_tax"), false)
})
