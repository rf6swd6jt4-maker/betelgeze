import assert from "node:assert/strict"
import test from "node:test"

import {
    filterSunbizShardRecords,
    parseSunbizShardJsonl,
    sunbizShardKeyForName,
    sunbizShardKeysForName,
    sunbizShardRecordFromOwnerRow,
    sunbizShardRelativePath,
    sunbizShardUrl,
    type SunbizShardRecord,
} from "../lib/leadgen/sunbiz-shards.ts"

test("builds stable Sunbiz shard keys and URLs", () => {
    assert.equal(sunbizShardKeyForName("Gulf Coast Roofing, LLC"), "gul")
    assert.equal(sunbizShardKeyForName("3 Angels Plumbing Inc"), "3an")
    assert.deepEqual(sunbizShardKeysForName("The Gulf Coast Roofing, LLC"), ["the", "gul"])
    assert.deepEqual(sunbizShardKeysForName("Best Gulf Coast Roofing, LLC"), ["bes", "gul"])
    assert.equal(sunbizShardRelativePath({
        sourceKey: "registry.fl.sunbiz",
        shardKey: "gul",
        version: "v1",
    }), "v1/sunbiz/gul.jsonl.gz")
    assert.equal(sunbizShardUrl({
        baseUrl: "https://assets.example.test/sunbiz/fl/",
        sourceKey: "registry.fl.fictitious_names",
        shardKey: "pal",
        version: "v1",
    }), "https://assets.example.test/sunbiz/fl/v1/fictitious_names/pal.jsonl.gz")
})

test("converts owner index rows to compact shard records", () => {
    const record = sunbizShardRecordFromOwnerRow({
        source_key: "registry.fl.sunbiz",
        record_id: "P24000012345:officer:1",
        business_name: "GULF COAST ROOFING LLC",
        status: "Active",
        record_type: "FLAL",
        person_name: "Maria Santos",
        person_role: "officer_mgr",
        person_source_field: "officer_1_name",
        person_type: "Person",
        address: { city: "TAMPA", state: "FL", postcode: "33603" },
        search_text: "gulf coast roofing p24000012345 maria santos",
        raw_payload: { document_number: "P24000012345" },
    })

    assert.deepEqual(record, {
        v: 1,
        s: "registry.fl.sunbiz",
        n: "gulf coast roofing",
        b: "GULF COAST ROOFING LLC",
        r: "P24000012345:officer:1",
        p: "Maria Santos",
        role: "officer_mgr",
        field: "officer_1_name",
        status: "Active",
        rt: "FLAL",
        city: "TAMPA",
        state: "FL",
        zip: "33603",
    })
})

test("parses and filters Sunbiz shard records for candidate search terms", () => {
    const rows: SunbizShardRecord[] = [
        { v: 1, s: "registry.fl.sunbiz", n: "gulf coast roofing", b: "GULF COAST ROOFING LLC", r: "1", p: "Maria Santos", role: "officer_mgr", field: "officer_1_name", status: "Active", rt: "FLAL", city: "TAMPA", state: "FL", zip: "33603" },
        { v: 1, s: "registry.fl.sunbiz", n: "atlantic pool service", b: "ATLANTIC POOL SERVICE INC", r: "2", p: "Ana Rivera", role: "officer_p", field: "officer_1_name", status: "Active", rt: "DOMP", city: "MIAMI", state: "FL", zip: "33101" },
    ]
    const parsed = parseSunbizShardJsonl(`${JSON.stringify(rows[0])}\nnot-json\n${JSON.stringify(rows[1])}\n`)

    assert.equal(parsed.length, 2)
    assert.deepEqual(filterSunbizShardRecords(parsed, "Gulf Coast Roofing Tampa", 5).map((row) => row.p), ["Maria Santos"])
})
