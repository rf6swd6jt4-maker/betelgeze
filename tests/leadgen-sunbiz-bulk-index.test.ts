import assert from "node:assert/strict"
import test from "node:test"

import {
    normaliseSunbizIndexSearchText,
    parseSunbizCorporateOwnerRows,
    parseSunbizFictitiousNameOwnerRows,
} from "../lib/leadgen/sunbiz-bulk-index.ts"

function fixedLine(length: number, fields: Array<{ start: number; length: number; value: string }>) {
    const chars = Array.from({ length }, () => " ")
    for (const field of fields) {
        const value = field.value.slice(0, field.length).padEnd(field.length, " ")
        for (let index = 0; index < value.length; index += 1) chars[field.start - 1 + index] = value[index]
    }
    return chars.join("")
}

test("parses Sunbiz corporate officer person rows from fixed-width downloads", () => {
    const rows = parseSunbizCorporateOwnerRows(fixedLine(1440, [
        { start: 1, length: 12, value: "P24000012345" },
        { start: 13, length: 192, value: "GULF COAST ROOFING LLC" },
        { start: 205, length: 1, value: "A" },
        { start: 206, length: 15, value: "FLAL" },
        { start: 221, length: 42, value: "100 MAIN ST" },
        { start: 305, length: 28, value: "TAMPA" },
        { start: 333, length: 2, value: "FL" },
        { start: 335, length: 10, value: "33602" },
        { start: 669, length: 4, value: "MGR" },
        { start: 673, length: 1, value: "P" },
        { start: 674, length: 42, value: "Maria Santos" },
        { start: 716, length: 42, value: "200 OAK AVE" },
        { start: 758, length: 28, value: "TAMPA" },
        { start: 786, length: 2, value: "FL" },
        { start: 788, length: 9, value: "33603" },
        { start: 797, length: 4, value: "MGR" },
        { start: 801, length: 1, value: "C" },
        { start: 802, length: 42, value: "GULF COAST HOLDINGS LLC" },
    ]))

    assert.equal(rows.length, 1)
    assert.equal(rows[0].source_key, "registry.fl.sunbiz")
    assert.equal(rows[0].business_name, "GULF COAST ROOFING LLC")
    assert.equal(rows[0].person_name, "Maria Santos")
    assert.equal(rows[0].status, "Active")
    assert.equal(rows[0].record_id, "P24000012345:officer:1")
    assert.match(rows[0].search_text, /gulf coast roofing/)
})

test("parses Sunbiz fictitious-name owner person rows from fixed-width downloads", () => {
    const rows = parseSunbizFictitiousNameOwnerRows(fixedLine(2098, [
        { start: 1, length: 12, value: "G24000054321" },
        { start: 13, length: 192, value: "PALM TREE CLEANING" },
        { start: 217, length: 40, value: "55 BEACH RD" },
        { start: 297, length: 28, value: "MIAMI" },
        { start: 325, length: 2, value: "FL" },
        { start: 327, length: 10, value: "33101" },
        { start: 337, length: 2, value: "US" },
        { start: 352, length: 1, value: "A" },
        { start: 389, length: 12, value: "G24000054321" },
        { start: 401, length: 55, value: "Ana Rivera" },
        { start: 456, length: 1, value: "P" },
        { start: 457, length: 40, value: "55 BEACH RD" },
        { start: 497, length: 28, value: "MIAMI" },
        { start: 525, length: 2, value: "FL" },
        { start: 527, length: 10, value: "33101" },
        { start: 537, length: 2, value: "US" },
    ]))

    assert.equal(rows.length, 1)
    assert.equal(rows[0].source_key, "registry.fl.fictitious_names")
    assert.equal(rows[0].business_name, "PALM TREE CLEANING")
    assert.equal(rows[0].person_name, "Ana Rivera")
    assert.equal(rows[0].person_role, "fictitious_name_owner")
    assert.equal(rows[0].address.city, "MIAMI")
})

test("normalises Sunbiz index search text for business-name matching", () => {
    assert.equal(normaliseSunbizIndexSearchText("Gulf Coast Roofing, LLC"), "gulf coast roofing")
})
