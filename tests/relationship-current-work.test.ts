import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

const source = readFileSync(new URL("../lib/relationship-workflow.ts", import.meta.url), "utf8")
const code = ts.transpileModule(source.slice(source.indexOf("export async function currentRelationshipWork")).replace("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const sell = { id: "sell", title: "Sell Client", status: "todo", workflow_role: "lifecycle_stage", workflow_action: "sell_client", sort_order: 0 }
const pay = { ...sell, id: "pay", title: "Confirm and Pay", workflow_action: "await_payment" }

async function current(items: typeof sell[], assignments: Array<{ work_item_id: string; user_id: string }> = [], isManager = true) {
    const responses: Record<string, unknown[]> = {
        work_item_relationships: items.map((work_items) => ({ work_items })),
        work_item_assignees: assignments,
        work_item_dependencies: [{ work_item_id: "pay", depends_on_work_item_id: "sell" }],
    }
    const db = { from(table: string) {
        const chain = { select: () => chain, eq: () => chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: responses[table] }).then(resolve) }
        return chain
    } }
    return new Function("supabaseAdmin", `${code}; return currentRelationshipWork`)(db)({ workspaceId: "workspace", relationshipId: "relationship", userId: "seller", isManager })
}

test("an unassigned new relationship selects Sell Client regardless of database ordering", async () => {
    for (const items of [[pay, sell], [sell, pay]]) {
        const result = await current(items)
        assert.equal(result.action, "sell_client")
        assert.equal(result.blocked, false)
    }
})

test("assignment to a future stage cannot hide the available POS stage from its manager", async () => {
    assert.equal((await current([pay, sell], [{ work_item_id: "pay", user_id: "seller" }])).action, "sell_client")
})

test("completing the sale makes Confirm and Pay the current stage", async () => {
    const result = await current([pay, { ...sell, status: "done" }])
    assert.equal(result.action, "await_payment")
    assert.equal(result.blocked, false)
})

test("staff without assignments do not acquire work through the manager fallback", async () => {
    assert.equal(await current([pay, sell], [], false), null)
})
