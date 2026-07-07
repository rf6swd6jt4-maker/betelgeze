import assert from "node:assert/strict"
import test from "node:test"

import {
    californiaOwnerShardKeyForName,
    californiaOwnerShardKeysForName,
    californiaOwnerShardRecordFromRow,
    californiaOwnerShardRelativePath,
    californiaOwnerShardUrl,
    filterCaliforniaOwnerShardRecords,
    parseCaliforniaOwnerShardJsonl,
    type CaliforniaOwnerShardRecord,
} from "../lib/leadgen/california-owner-shards.ts"

test("builds stable California owner shard keys and URLs", () => {
    assert.equal(californiaOwnerShardKeyForName("Golden State Roofing, LLC"), "gol")
    assert.equal(californiaOwnerShardKeyForName("3 Angels Plumbing Inc"), "3an")
    assert.deepEqual(californiaOwnerShardKeysForName("The Golden State Roofing, LLC"), ["the", "sta"])
    assert.deepEqual(californiaOwnerShardKeysForName("California Coast Fence Co"), ["cal", "coa"])
    assert.equal(californiaOwnerShardRelativePath({
        sourceKey: "registry.ca.los_angeles_fbn",
        shardKey: "gol",
        version: "v1",
    }), "v1/los_angeles_fbn/gol.jsonl.gz")
    assert.equal(californiaOwnerShardUrl({
        baseUrl: "https://assets.example.test/leadgen/ca-owner/",
        sourceKey: "registry.ca.san_francisco_business_locations",
        shardKey: "bay",
        version: "v1",
    }), "https://assets.example.test/leadgen/ca-owner/v1/san_francisco_business_locations/bay.jsonl.gz")
})

test("converts California owner rows to compact shard records", () => {
    const record = californiaOwnerShardRecordFromRow({
        source_key: "registry.ca.los_angeles_fbn",
        record_id: "2024123456",
        business_name: "GOLDEN STATE ROOFING LLC",
        status: "Original",
        record_type: "Individual",
        person_name: "Maria Santos",
        person_role: "registered_fbn_owner",
        person_source_field: "RegisteredOwnerName",
        address: { street: "123 Main St", city: "Los Angeles", state: "CA", postcode: "90012" },
        source_url: "https://public.gis.lacounty.gov/",
    })

    assert.deepEqual(record, {
        v: 1,
        s: "registry.ca.los_angeles_fbn",
        n: "golden state roofing",
        b: "GOLDEN STATE ROOFING LLC",
        r: "2024123456",
        p: "Maria Santos",
        role: "registered_fbn_owner",
        field: "RegisteredOwnerName",
        status: "Original",
        rt: "Individual",
        street: "123 Main St",
        city: "Los Angeles",
        state: "CA",
        zip: "90012",
        url: "https://public.gis.lacounty.gov/",
    })
})

test("parses and filters California owner shard records for candidate search terms", () => {
    const rows: CaliforniaOwnerShardRecord[] = [
        { v: 1, s: "registry.ca.los_angeles_fbn", n: "golden state roofing", b: "GOLDEN STATE ROOFING LLC", r: "1", p: "Maria Santos", role: "registered_fbn_owner", field: "RegisteredOwnerName", status: "Original", rt: "FBN", street: "123 Main", city: "Los Angeles", state: "CA", zip: "90012", url: "https://example.test/la" },
        { v: 1, s: "registry.ca.san_francisco_business_locations", n: "bay area pool service", b: "BAY AREA POOL SERVICE INC", r: "2", p: "Ana Rivera", role: "business_owner", field: "ownership_name", status: "Active", rt: "Registered business", street: "99 Market", city: "San Francisco", state: "CA", zip: "94103", url: "https://example.test/sf" },
    ]
    const parsed = parseCaliforniaOwnerShardJsonl(`${JSON.stringify(rows[0])}\nnot-json\n${JSON.stringify(rows[1])}\n`)

    assert.equal(parsed.length, 2)
    assert.deepEqual(filterCaliforniaOwnerShardRecords(parsed, "Golden State Roofing Los Angeles", 5).map((row) => row.p), ["Maria Santos"])
})
