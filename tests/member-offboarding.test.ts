import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { blockedItems, buildOffboardPlan, eligibleForEverything, parseFootprint, validOffboardInput, type MemberFootprint } from "../lib/member-offboarding.ts"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const target = id(1), sam = id(2), mia = id(3), priya = id(4)
const fp = (n: number) => String(n).repeat(32).slice(0, 32)

function footprint(overrides: Partial<MemberFootprint> = {}): MemberFootprint {
    return {
        available: true, targetId: target, targetName: "Target", targetRole: "staff", fingerprint: fp(9), history: { sellerClients: 1 },
        people: { [sam]: "Sam", [mia]: "Mia", [priya]: "Priya" },
        eligibility: { managers: [sam, priya], [`service:${id(20)}`]: [sam, mia], members: [sam, mia, priya] },
        items: [
            { key: `client_manager:${id(30)}`, kind: "client_manager", relationshipId: id(30), recordId: id(30), serviceKey: null, serviceId: null, client: "Acme", title: "Fulfilment manager", fingerprint: fp(1), eligibleGroup: "managers", blockedReason: null },
            { key: `service_assignee:${id(40)}`, kind: "service_assignee", relationshipId: id(30), recordId: id(40), serviceKey: null, serviceId: id(20), client: "Acme", title: "Ads", fingerprint: fp(2), eligibleGroup: `service:${id(20)}`, blockedReason: null },
            { key: `work_owner:${id(50)}`, kind: "work_owner", relationshipId: null, recordId: id(50), serviceKey: null, serviceId: null, client: null, title: "Tidy drive", fingerprint: fp(3), eligibleGroup: "members", blockedReason: null },
        ],
        ...overrides,
    }
}

test("only people eligible for every remaining assignment are offered for everything", () => {
    assert.deepEqual(eligibleForEverything(footprint(), false), [sam])
    // Leaving open tasks does not widen it here: the client still needs a manager and the service an eligible person.
    assert.deepEqual(eligibleForEverything(footprint(), true), [sam])
    const noManager = footprint({ items: footprint().items.slice(1) })
    assert.deepEqual(eligibleForEverything(noManager, false), [mia, sam])
})

test("the plan sends each assignment to its override or the default and refuses ineligible choices", () => {
    const all = buildOffboardPlan(footprint(), sam, {}, false)
    assert.equal(all.missing.length, 0)
    assert.deepEqual(all.plan.map(entry => entry.recipientId), [sam, sam, sam])
    const override = buildOffboardPlan(footprint(), sam, { [`work_owner:${id(50)}`]: priya }, false)
    assert.equal(override.plan.find(entry => entry.key.startsWith("work_owner"))?.recipientId, priya)
    const ineligible = buildOffboardPlan(footprint(), mia, {}, false)
    assert.deepEqual(ineligible.missing.map(item => item.kind), ["client_manager"])
    assert.deepEqual(buildOffboardPlan(footprint(), "", {}, false).missing.length, 3)
})

test("leaving open tasks unassigned drops only tasks without an explicit choice", () => {
    const left = buildOffboardPlan(footprint(), sam, {}, true)
    assert.deepEqual(left.plan.map(entry => entry.key.split(":")[0]), ["client_manager", "service_assignee"])
    const kept = buildOffboardPlan(footprint(), sam, { [`work_owner:${id(50)}`]: mia }, true)
    assert.equal(kept.plan.length, 3)
})

test("assignments nobody can take, or imported ones, block the removal", () => {
    const nobody = footprint({ eligibility: { ...footprint().eligibility, [`service:${id(20)}`]: [] } })
    assert.deepEqual(blockedItems(nobody, false).map(item => item.kind), ["service_assignee"])
    const imported = footprint({ items: footprint().items.map(item => item.kind === "service_assignee" ? { ...item, blockedReason: "Imported" } : item) })
    assert.deepEqual(blockedItems(imported, false).map(item => item.kind), ["service_assignee"])
    assert.equal(buildOffboardPlan(imported, sam, {}, false).missing.length, 1)
})

test("the request shape is validated before it reaches the database", () => {
    const base = { expectedUserId: sam, requestId: id(99), targetId: target, footprintFingerprint: fp(9), leaveOpenWork: false, reason: "Left the agency",
        plan: buildOffboardPlan(footprint(), sam, {}, false).plan }
    assert.equal(validOffboardInput(base), true)
    assert.equal(validOffboardInput({ ...base, reason: "  " }), false)
    assert.equal(validOffboardInput({ ...base, plan: [...base.plan, base.plan[0]] }), false)
    assert.equal(validOffboardInput({ ...base, plan: [{ ...base.plan[0], recipientId: target }] }), false)
    assert.equal(validOffboardInput({ ...base, plan: [{ ...base.plan[0], key: `unknown:${id(1)}` }] }), false)
    assert.equal(validOffboardInput({ ...base, footprintFingerprint: "stale" }), false)
})

test("preview results are parsed defensively", () => {
    const raw = { items: [{ key: `work_owner:${id(50)}`, kind: "work_owner", recordId: id(50), title: "Tidy", fingerprint: fp(3), eligibleGroup: "members" }],
        eligibility: { members: [sam, "not-a-uuid"] }, fingerprint: fp(9), history: { sellerClients: 2 } }
    const parsed = parseFootprint(raw, target, { [sam]: "Sam" }, "Target")
    assert.ok(parsed)
    assert.deepEqual(parsed.eligibility.members, [sam])
    assert.equal(parsed.history.sellerClients, 2)
    assert.equal(parseFootprint({ ...raw, items: [{ ...raw.items[0], kind: "seller" }] }, target, {}, "Target"), null)
    assert.equal(parseFootprint({ ...raw, fingerprint: "x" }, target, {}, "Target"), null)
})

test("the dialog reads through an authenticated GET and saves through one idempotent command", () => {
    const route = source("app/api/workspaces/[workspaceSlug]/members/[userId]/footprint/route.ts")
    assert.match(route, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(route, /x-workspace-user/)
    assert.match(route, /preview_workspace_member_footprint/)
    assert.match(route, /available: false/, "falls back to plain removal until the migration is applied")
    const actions = source("app/[workspaceSlug]/users/actions.ts")
    const start = actions.indexOf("export async function offboardWorkspaceMember")
    const action = actions.slice(start, actions.indexOf("\nexport type AdminMfaResetActionState", start))
    assert.match(action, /offboard_workspace_member/)
    assert.match(action, /validOffboardInput/)
    assert.match(action, /uncertain: !definitive/)
    const dialog = source("components/admin/RemoveWorkspaceUser.tsx")
    assert.match(dialog, /request\.current \?\?=/, "a retry reuses the same request id")
    assert.match(dialog, /runWorkspaceMutation/)
    assert.match(dialog, /data-workspace-mutation="background"/)
    assert.doesNotMatch(dialog, /setSaved\(true\)[^\n]*\n[^\n]*runWorkspaceMutation/, "never shows removed before the command commits")
})
