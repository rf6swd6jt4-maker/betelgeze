import assert from "node:assert/strict"
import test from "node:test"

import { selectBalancedValidatedCompanies } from "../lib/leadgen/stage-selection.ts"

test("validated business selection balances the target set across poll locations", () => {
    const valid = [
        ...Array.from({ length: 12 }, (_, index) => ({ company: { id: `la-${index}`, location_value: "los_angeles_ca" } })),
        ...Array.from({ length: 8 }, (_, index) => ({ company: { id: `sd-${index}`, location_value: "san_diego_ca" } })),
    ]

    const selected = selectBalancedValidatedCompanies(valid, 10)
    const selectedLocations = selected.map((item) => item.company.location_value)

    assert.equal(selected.length, 10)
    assert.equal(selectedLocations.filter((location) => location === "los_angeles_ca").length, 5)
    assert.equal(selectedLocations.filter((location) => location === "san_diego_ca").length, 5)
})

test("validated business selection preserves original order for single-location polls", () => {
    const valid = Array.from({ length: 12 }, (_, index) => ({ company: { id: `la-${index}`, location_value: "los_angeles_ca" } }))

    const selected = selectBalancedValidatedCompanies(valid, 10)

    assert.deepEqual(selected.map((item) => item.company.id), valid.slice(0, 10).map((item) => item.company.id))
})
