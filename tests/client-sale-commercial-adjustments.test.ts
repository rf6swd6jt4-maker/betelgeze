import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const sql = readFileSync(new URL("../supabase/migrations/20260922190000_client_sale_commercial_adjustments.sql", import.meta.url), "utf8")

test("commercial corrections append effective terms without mutating frozen sales or onboarding", () => {
    assert.match(sql, /create table public\.client_sale_commercial_adjustments/)
    assert.match(sql, /Commercial adjustment history is immutable/)
    assert.match(sql, /Only a frozen paid sale can be corrected/)
    assert.match(sql, /superseded_by_external_invoice/)
    assert.match(sql, /The paid sale must retain its onboarding session/)
    assert.doesNotMatch(sql, /update public\.relationship_onboarding_sessions/)
    assert.doesNotMatch(sql, /delete from public\.relationship_onboarding/)
    assert.doesNotMatch(sql, /update public\.client_sale_items/)
    assert.doesNotMatch(sql, /update public\.service_instance_sessions/)
})

test("relationship values and POS sales prefer the latest effective correction", () => {
    assert.match(sql, /order by x\.version desc limit 1/)
    assert.match(sql, /coalesce\(a\.effective_upfront_amount,s\.upfront_total_amount\)/)
    assert.match(sql, /coalesce\(a\.effective_recurring_amount,s\.recurring_total_amount\)/)
    assert.match(sql, /client_sale\.pricing_corrected/)
})

test("correction command is versioned and idempotent", () => {
    assert.match(sql, /unique \(sale_id, version\)/)
    assert.match(sql, /unique \(sale_id, request_id\)/)
    assert.match(sql, /Commercial terms changed; reload before correcting/)
    assert.match(sql, /Request ID reused with different correction/)
    assert.match(sql, /'replayed', true/)
})
