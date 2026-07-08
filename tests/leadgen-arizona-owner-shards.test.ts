import assert from "node:assert/strict"
import test from "node:test"

import {
    arizonaOwnerIndexRowsFromRecord,
    arizonaOwnerShardKeyForName,
    arizonaOwnerShardKeysForName,
    arizonaOwnerShardRecordFromOwnerRow,
    arizonaOwnerShardRelativePath,
    arizonaOwnerShardUrl,
    filterArizonaOwnerShardRecords,
    parseArizonaOwnerShardJsonl,
    type ArizonaOwnerShardRecord,
} from "../lib/leadgen/arizona-owner-shards.ts"

test("builds stable Arizona owner shard keys and URLs", () => {
    assert.equal(arizonaOwnerShardKeyForName("Desert Sun Roofing, LLC"), "des")
    assert.deepEqual(arizonaOwnerShardKeysForName("The Desert Sun Roofing LLC"), ["the", "sun"])
    assert.equal(arizonaOwnerShardRelativePath({
        sourceKey: "registry.az.corp_commission",
        shardKey: "des",
        version: "v1",
    }), "v1/corp_commission/des.jsonl.gz")
    assert.equal(arizonaOwnerShardUrl({
        baseUrl: "https://assets.example.test/arizona/owner/",
        sourceKey: "registry.az.trade_names",
        shardKey: "sag",
        version: "v1",
    }), "https://assets.example.test/arizona/owner/v1/trade_names/sag.jsonl.gz")
})

test("normalizes ACC entity rows into owner index rows", () => {
    const rows = arizonaOwnerIndexRowsFromRecord("registry.az.corp_commission", {
        entity_name: "DESERT SUN ROOFING LLC",
        entity_number: "L12345678",
        status: "Active",
        manager_name: "GARCIA, MARIA",
        city: "Phoenix",
        state: "AZ",
        zip: "85001",
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.source_key, "registry.az.corp_commission")
    assert.equal(rows[0]?.business_name, "DESERT SUN ROOFING LLC")
    assert.equal(rows[0]?.person_name, "Maria Garcia")
    assert.equal(rows[0]?.person_role, "member_or_manager")
    assert.equal(rows[0]?.person_source_field, "manager_name")
    assert.deepEqual(rows[0]?.address, {
        street: null,
        city: "Phoenix",
        state: "AZ",
        postcode: "85001",
        country: "US",
    })
})

test("normalizes Arizona trade-name registrants into owner index rows", () => {
    const rows = arizonaOwnerIndexRowsFromRecord("registry.az.trade_names", {
        trade_name: "Saguaro Pool Care",
        trade_name_id: "TN-88",
        registration_status: "Registered",
        registrant_name: "Ana Rivera",
        city: "Tucson",
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.source_key, "registry.az.trade_names")
    assert.equal(rows[0]?.business_name, "Saguaro Pool Care")
    assert.equal(rows[0]?.person_name, "Ana Rivera")
    assert.equal(rows[0]?.person_role, "trade_name_registrant")
    assert.equal(rows[0]?.status, "Registered")
})

test("converts owner index rows to compact Arizona shard records", () => {
    const record = arizonaOwnerShardRecordFromOwnerRow({
        source_key: "registry.az.corp_commission",
        record_id: "L12345678:managername:mariagarcia",
        business_name: "DESERT SUN ROOFING LLC",
        status: "Active",
        record_type: "Domestic LLC",
        person_name: "Maria Garcia",
        person_role: "member_or_manager",
        person_source_field: "manager_name",
        person_type: "Person",
        address: { city: "Phoenix", state: "AZ", postcode: "85001" },
        search_text: "desert sun roofing l12345678 maria garcia",
        raw_payload: { entity_number: "L12345678" },
    })

    assert.deepEqual(record, {
        v: 1,
        s: "registry.az.corp_commission",
        n: "desert sun roofing",
        b: "DESERT SUN ROOFING LLC",
        r: "L12345678:managername:mariagarcia",
        p: "Maria Garcia",
        role: "member_or_manager",
        field: "manager_name",
        status: "Active",
        rt: "Domestic LLC",
        city: "Phoenix",
        state: "AZ",
        zip: "85001",
        raw: { entity_number: "L12345678" },
    })
})

test("parses and filters Arizona shard records for candidate search terms", () => {
    const rows: ArizonaOwnerShardRecord[] = [
        { v: 1, s: "registry.az.corp_commission", n: "desert sun roofing", b: "DESERT SUN ROOFING LLC", r: "1", p: "Maria Garcia", role: "member_or_manager", field: "manager_name", status: "Active", rt: "Domestic LLC", city: "Phoenix", state: "AZ", zip: "85001", raw: { entity_number: "1" } },
        { v: 1, s: "registry.az.trade_names", n: "saguaro pool care", b: "Saguaro Pool Care", r: "2", p: "Ana Rivera", role: "trade_name_registrant", field: "registrant_name", status: "Registered", rt: "Arizona trade name registration", city: "Tucson", state: "AZ", zip: null, raw: { trade_name_id: "2" } },
    ]
    const parsed = parseArizonaOwnerShardJsonl(`${JSON.stringify(rows[0])}\nnot-json\n${JSON.stringify(rows[1])}\n`)

    assert.equal(parsed.length, 2)
    assert.deepEqual(filterArizonaOwnerShardRecords(parsed, "Desert Sun Roofing Phoenix", 5).map((row) => row.p), ["Maria Garcia"])
})
