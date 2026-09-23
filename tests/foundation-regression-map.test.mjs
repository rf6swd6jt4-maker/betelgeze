import assert from "node:assert/strict"
import test from "node:test"
import { foundationPacks, selectFoundationTests } from "../scripts/run-foundation-regressions.mjs"

test("mobile changes include workspace and reading invariants", () => {
    assert.deepEqual(foundationPacks(["lib/workspace-visual-origin.ts", "app/globals.css"]), ["alerts", "mobile", "workspace"])
    assert.deepEqual(selectFoundationTests(["mobile", "alerts"], ["composer-touch.test.ts", "chat-read-queue.test.ts", "workspace-tabs.test.ts", "readme.md"]), ["chat-read-queue.test.ts", "composer-touch.test.ts"])
})
test("unknown application and migration changes fail broad to the full suite", () => {
    for (const path of ["lib/new-owner.ts", "app/new/page.tsx", "supabase/migrations/new.sql", "package-lock.json"]) assert.deepEqual(foundationPacks([path]), ["full"])
    assert.deepEqual(selectFoundationTests(["full"], ["a.test.mjs", "b.test.ts", "fixture.sql"]), ["a.test.mjs", "b.test.ts"])
})
test("documentation-only edits need no runtime pack and retired deletions select retirement", () => {
    assert.deepEqual(foundationPacks(["docs/platform-foundation.md", "components/workspace/AGENTS.md"]), [])
    assert.deepEqual(foundationPacks(["lib/leadgen/poll-runner.ts"]), ["retirement"])
})
