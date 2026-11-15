import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

// API requests run as `authenticator`, whose sessions preload pg-safeupdate: any DELETE or UPDATE without a WHERE clause
// fails with "DELETE requires a WHERE clause" (HTTP 400). The in-memory schema replay cannot load that extension, so a
// bare statement passes every SQL fixture and still breaks in production, as the member footprint preview did.
// Checked from the member-move migrations onward; older functions are covered by their production history.
const FIRST_CHECKED = "20261114180000"

function latestFunctionBodies() {
    const directory = new URL("../supabase/migrations/", import.meta.url)
    const files = readdirSync(directory).filter(name => name.endsWith(".sql")).sort()
    const bodies = new Map<string, { file: string; body: string }>()
    for (const file of files) {
        const source = readFileSync(new URL(file, directory), "utf8")
        for (const match of source.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\([\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$/gi)) {
            bodies.set(match[1], { file, body: match[2] })
        }
    }
    return [...bodies.entries()].filter(([, value]) => value.file >= FIRST_CHECKED)
}

test("functions reachable through the API never DELETE or UPDATE without a WHERE clause", () => {
    const checked = latestFunctionBodies()
    assert.ok(checked.some(([name]) => name === "preview_workspace_member_footprint"), "the preview function is checked")
    for (const [name, { file, body }] of checked) {
        const statements = body.replace(/--.*$/gm, "").split(";").map(statement => statement.trim().replace(/\s+/g, " ").toLowerCase())
        for (const statement of statements) {
            if (/^(delete\s+from|update\s+[\w."]+\s+set)\b/.test(statement)) {
                assert.match(statement, /\bwhere\b/, `${name} in ${file} has a statement pg-safeupdate refuses: ${statement.slice(0, 120)}`)
            }
        }
    }
})

test("the footprint preview rebuilds its scratch table instead of emptying it", () => {
    const fix = readFileSync(new URL("../supabase/migrations/20261115100000_member_footprint_preview_safeupdate.sql", import.meta.url), "utf8")
    assert.match(fix, /drop table if exists member_preview_items;\s*create temp table member_preview_items on commit drop as/)
    assert.doesNotMatch(fix.replace(/--.*$/gm, ""), /delete from member_preview_items/)
})
