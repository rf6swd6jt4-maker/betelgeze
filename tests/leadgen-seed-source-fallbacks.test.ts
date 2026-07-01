import assert from "node:assert/strict"
import test from "node:test"

import {
    fallbackSeedNativeValues,
    seedIndustryMappingsWithFallbacks,
    seedLocationMappingsWithFallbacks,
} from "../lib/leadgen/seed-source-fallbacks.ts"

test("unmapped deck builders get runnable Overture fallback categories", () => {
    const mappings = seedIndustryMappingsWithFallbacks("overture", ["deck_builders"], [])

    assert.equal(mappings.length, 1)
    assert.equal(mappings[0].icp_industry_value, "deck_builders")
    assert.deepEqual(
        mappings[0].native_values?.filter((value) => ["contractor", "building_contractor", "construction_services"].includes(value)),
        ["contractor", "building_contractor", "construction_services"],
    )
    assert.equal(mappings[0].metadata?.generated_fallback_mapping, true)
})

test("existing OSM mappings keep specific tags while gaining broader fallbacks", () => {
    const mappings = seedIndustryMappingsWithFallbacks("osm", ["garage_door_companies"], [{
        icp_industry_value: "garage_door_companies",
        native_values: ["shop=doors"],
        metadata: { osm_tags: ["shop=doors"] },
    }])

    assert.deepEqual(mappings[0].native_values, ["shop=doors", "craft=garage_door", "craft=builder", "office=construction_company"])
    assert.deepEqual(mappings[0].metadata?.osm_tags, ["shop=doors", "craft=garage_door", "craft=builder", "office=construction_company"])
})

test("generic text seed sources fall back from the industry slug when no mapping exists", () => {
    const values = fallbackSeedNativeValues("alltheplaces", "garage_door_companies")

    assert.ok(values.includes("garage"))
    assert.ok(values.includes("door"))
    assert.ok(values.includes("contractor"))
    assert.ok(values.includes("construction"))
})

test("seed location fallback creates a mapped task target from the selected ICP location", () => {
    const mappings = seedLocationMappingsWithFallbacks("austin_tx greater_houston_tx".split(" "), [], [{
        value: "austin_tx",
        label: "Austin, TX",
        location_kind: "city",
        country: "US",
        region: "TX",
        locality: "Austin",
        latitude: 30.2672,
        longitude: -97.7431,
        radius_meters: 24000,
    }])

    assert.equal(mappings.length, 2)
    assert.deepEqual(mappings.find((mapping) => mapping.icp_location_value === "austin_tx")?.native_values, ["austin_tx"])
    assert.equal(mappings.find((mapping) => mapping.icp_location_value === "austin_tx")?.metadata?.latitude, 30.2672)
    assert.equal(mappings.find((mapping) => mapping.icp_location_value === "greater_houston_tx")?.metadata?.generated_fallback_mapping, true)
})
