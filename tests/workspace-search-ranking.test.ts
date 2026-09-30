import assert from "node:assert/strict"
import test from "node:test"
import { createWorkspaceSearchController, type WorkspaceSearchResult } from "../lib/workspace-search.ts"
import { rankWorkspaceSearchMatch, rankWorkspaceSearchResults, type WorkspaceSearchCandidate } from "../lib/workspace-search-ranking.ts"

function result(id: string, label = id, extra: Partial<WorkspaceSearchResult> = {}): WorkspaceSearchResult {
    return { id, type: "Relationship", label, description: "Readable reference", href: `/alpha/relationships/${id}`, ...extra }
}
const candidate = (item: WorkspaceSearchResult, rank: number): WorkspaceSearchCandidate => ({ result: item, rank })

test("direct identity and primary matches precede related records and contextual mentions", () => {
    const direct = result("36c6", "Bruce Laing")
    const context = result("jason", "Jason McCrae", { matchReason: "Matched in notes" })
    const related = result("work-1", "Prepare onboarding", { type: "Work item", href: "/alpha/work-items/1", matchReason: "Related to Bruce Laing" })
    const ranked = rankWorkspaceSearchResults([
        candidate(context, rankWorkspaceSearchMatch("bruce", { primary: [context.label], secondary: ["Introduction from Bruce Laing"] })),
        candidate(related, 4),
        candidate(direct, rankWorkspaceSearchMatch("bruce", { primary: [direct.label] })),
    ])
    assert.deepEqual(ranked.map(row => row.id), ["36c6", "work-1", "jason"])
    assert.equal(ranked[2].matchReason, "Matched in notes")
    assert.equal(rankWorkspaceSearchMatch(" BRUCE ", { ids: ["Bruce"], primary: ["Bruce"] }), 0)
    assert.equal(rankWorkspaceSearchMatch("bruce", { primary: ["BRUCE"] }), 1)
    assert.equal(rankWorkspaceSearchMatch("36c", { ids: ["36c6"], primary: [] }), 5)
    assert.equal(rankWorkspaceSearchMatch("bruce", { primary: ["Dr Bruce Laing"] }), 3)
    assert.equal(rankWorkspaceSearchMatch("6c", { ids: ["36c6"], primary: [] }), 5)
})

test("matching is case insensitive and treats wildcard characters literally", () => {
    assert.equal(rankWorkspaceSearchMatch("ΟΣ", { primary: ["ΟΣ"] }), 1)
    assert.equal(rankWorkspaceSearchMatch("İ", { primary: ["İstanbul"] }), 2)
    assert.equal(rankWorkspaceSearchMatch("%_", { primary: ["Address %_ literal"] }), 3)
    assert.equal(rankWorkspaceSearchMatch("%_", { primary: ["Address other"] }), Infinity)
    assert.equal(rankWorkspaceSearchMatch("missing", { primary: [null, undefined, ""] }), Infinity)
    assert.equal(rankWorkspaceSearchMatch("  ", { primary: ["Bruce"] }), Infinity)
})

test("distinct same-name identities survive and archived results follow every active match", () => {
    const active = result("36c6", "Bruce Laing", { archived: false })
    const archived = result("e037", "Bruce Laing", { archived: true })
    const context = result("jason", "Jason McCrae")
    assert.deepEqual(rankWorkspaceSearchResults([
        candidate(archived, 0), candidate(context, 5), candidate(active, 2),
    ]).map(row => row.id), ["36c6", "jason", "e037"])
})

test("canonical aliases and related work deduplicate by identity or destination, never name", () => {
    const canonical = result("relationship-36c6", "Bruce Laing")
    const alias = result("client-legacy", "Bruce Laing", { href: canonical.href })
    const other = result("relationship-e037", "Bruce Laing")
    const directWork = result("work-1", "Bruce onboarding", { type: "Work item", href: "/alpha/work-items/1", matchReason: "Matched in title" })
    const relatedWork = { ...directWork, matchReason: "Related to Bruce Laing" }
    const alternateWorkDestination = { ...directWork, href: "/alpha/work-items/1?from=relationship" }
    const ranked = rankWorkspaceSearchResults([
        candidate(alias, 3), candidate(relatedWork, 4), candidate(other, 2),
        candidate(canonical, 1), candidate(directWork, 2), candidate(alternateWorkDestination, 4),
    ])
    assert.equal(ranked.filter(row => row.label === "Bruce Laing").length, 2)
    assert.equal(ranked.some(row => row.id === alias.id), false)
    assert.equal(ranked.filter(row => row.id === directWork.id).length, 1)
    assert.equal(ranked.find(row => row.id === directWork.id)?.matchReason, "Matched in title")
})

test("global ranking and deduplication happen before the hard twenty-result cap", () => {
    const secondary = Array.from({ length: 25 }, (_, index) => candidate(result(`person-${index}`, `Person ${index}`), 5))
    const lateDirect = candidate(result("work-direct", "Exact match", { type: "Work item", href: "/alpha/work-items/direct" }), 1)
    const archived = candidate(result("archived", "Archived exact match", { archived: true }), 0)
    const candidates = [secondary[0], secondary[0], ...secondary, archived, lateDirect]
    const original = [...candidates]
    const ranked = rankWorkspaceSearchResults(candidates, 99)
    assert.equal(ranked.length, 20)
    assert.equal(ranked[0].id, "work-direct")
    assert.equal(new Set(ranked.map(row => row.id)).size, 20)
    assert.equal(ranked.some(row => row.archived), false)
    assert.deepEqual(candidates, original)
    assert.deepEqual(rankWorkspaceSearchResults(candidates, 0), [])
    assert.deepEqual(rankWorkspaceSearchResults([candidate(result("no-match"), Infinity)]), [])
})

test("repeated related destinations do not consume slots or merge distinct records with the same title", () => {
    const shared = result("work-shared", "Review onboarding", { type: "Work item", href: "/alpha/work-items/shared" })
    const repeated = Array.from({ length: 24 }, (_, index) => candidate({ ...shared, id: `related-${index}` }, 4))
    const distinct = Array.from({ length: 20 }, (_, index) => candidate(result(`work-${index}`, "Review onboarding", { type: "Work item", href: `/alpha/work-items/${index}` }), 4))
    const rows = rankWorkspaceSearchResults([...repeated, ...distinct])
    assert.equal(rows.length, 20)
    assert.equal(new Set(rows.map(row => row.href)).size, 20)
    assert.equal(rows.filter(row => row.href === shared.href).length, 1)
    assert.equal(rows.filter(row => row.label === "Review onboarding").length, 20)
})

test("equal relevance has a deterministic tie break independent of category insertion order", () => {
    const rows = [candidate(result("relationship", "Zulu"), 2), candidate(result("work", "Alpha", { type: "Work item", href: "/alpha/work-items/a" }), 2)]
    assert.deepEqual(rankWorkspaceSearchResults(rows), rankWorkspaceSearchResults([...rows].reverse()))
    assert.equal(rankWorkspaceSearchResults(rows)[0].id, "work")
})

const input = { scope: "user-a:workspace-a", userId: "user-a", workspaceId: "workspace-a", workspaceSlug: "alpha", query: "bruce", open: true }
async function receive(row: unknown) {
    const controller = createWorkspaceSearchController({ debounceMs: 0, fetch: async () => new Response(JSON.stringify({
        scope: { userId: input.userId, workspaceId: input.workspaceId }, results: Array.isArray(row) ? row : [row],
    })) })
    const settled = new Promise<void>(resolve => controller.subscribe(() => {
        if (["results", "error"].includes(controller.getSnapshot().status)) resolve()
    }))
    controller.update(input)
    try { await settled; return controller.getSnapshot() } finally { controller.dispose() }
}

test("browser accepts optional archive and match evidence without losing result identity", async () => {
    for (const extra of [{}, { archived: false }, { archived: true, matchReason: "Matched in notes" }]) {
        const row = result("bruce", "Bruce Laing", extra)
        const state = await receive(row)
        assert.equal(state.status, "results")
        assert.deepEqual(state.results, [row])
    }
})

test("malformed archive or match-reason payload fails closed without a partial result", async () => {
    for (const extra of [
        ...[null, "true", 1, {}].map(archived => ({ archived })),
        ...[null, 1, {}, "", "   ", "x".repeat(201)].map(matchReason => ({ matchReason })),
    ]) {
        const state = await receive({ ...result("bruce"), ...extra })
        assert.equal(state.status, "error", JSON.stringify(extra))
        assert.deepEqual(state.results, [])
    }
})


test("one malformed result rejects the entire mixed payload and the twenty-result boundary remains strict", async () => {
    const valid = result("bruce", "Bruce Laing", { archived: false, matchReason: "Matches name" })
    for (const invalid of [{ ...result("bad-archive"), archived: "false" }, { ...result("bad-reason"), matchReason: 123 }]) {
        const state = await receive([valid, invalid])
        assert.equal(state.status, "error")
        assert.deepEqual(state.results, [])
    }
    const rows = Array.from({ length: 20 }, (_, index) => result(`match-${index}`))
    assert.equal((await receive(rows)).results.length, 20)
    const overflow = await receive([...rows, result("twenty-first")])
    assert.equal(overflow.status, "error")
    assert.deepEqual(overflow.results, [])
})


test("partial record IDs remain findable without outranking primary name matches", () => {
    assert.equal(rankWorkspaceSearchMatch("abc123", { ids: ["abc123ef-4567-4000-8000-000000000001"], primary: ["Unrelated title"] }), 5)
    assert.equal(rankWorkspaceSearchMatch("4000", { ids: ["abc123ef-4567-4000-8000-000000000001"], primary: ["Unrelated title"] }), 5)
    assert.equal(rankWorkspaceSearchMatch("abc123", { ids: ["abc123ef-4567-4000-8000-000000000001"], primary: ["abc123 exact label"] }), 2)
})
