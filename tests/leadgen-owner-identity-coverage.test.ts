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
    pass5CaliforniaLocalOwnerIdentitySourcesByLocation,
    pass5CaliforniaWasteOwnerIdentitySources,
    pass5OwnerIdentitySourcesForCombo,
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

test("v5.5 California owner discovery uses stable executable sources instead of Bizfile", () => {
    const settingsSourceKeys = new Set(leadgenSourceOptions.map((source) => source.value))
    const californiaCoreSources = pass1CoreOwnerIdentitySourcesByState.CA

    assert.deepEqual(californiaCoreSources, ["state_license.ca.cslb"])
    assert.equal(californiaCoreSources.includes("registry.ca.bizfile"), false)
    assert.equal(executableLeadgenSources.has("registry.ca.bizfile"), false)

    for (const sourceKey of [
        ...Object.values(pass5CaliforniaLocalOwnerIdentitySourcesByLocation).flat(),
        ...pass5CaliforniaWasteOwnerIdentitySources,
    ]) {
        assert.equal(settingsSourceKeys.has(sourceKey as Exclude<LeadgenSourceKey, "state_licensing">), true, `${sourceKey} is missing from Settings source options`)
        assert.equal(executableLeadgenSources.has(sourceKey as LeadgenSourceKey), true, `${sourceKey} is not runnable by the poll source planner`)
    }

    for (const industry of selectableOwnerIdentityIndustries) {
        for (const location of selectableOwnerIdentityLocations.filter((item) => item.state === "CA")) {
            const sources = pass5OwnerIdentitySourcesForCombo(industry, location.value)
            assert.equal(sources.includes("state_license.ca.cslb"), true, `${industry}/${location.value} does not include California CSLB`)
            assert.equal(sources.includes("registry.ca.bizfile"), false, `${industry}/${location.value} still depends on Bizfile`)
            assert.equal(sources.includes("website"), false, `${industry}/${location.value} fell back to the crawler`)
        }
    }

    assert.equal(pass5OwnerIdentitySourcesForCombo("fencing_contractors", "los_angeles_ca").includes("registry.ca.los_angeles_fbn"), true)
    assert.equal(pass5OwnerIdentitySourcesForCombo("fencing_contractors", "bay_area_ca").includes("registry.ca.san_francisco_business_locations"), true)
    assert.equal(pass5OwnerIdentitySourcesForCombo("waste_disposal", "san_diego_ca").includes("regulated.ca.calrecycle_waste"), true)
})
