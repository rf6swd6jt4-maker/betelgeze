import assert from "node:assert/strict"
import test from "node:test"
import { activeTeamServiceAssignments } from "../lib/teams/service-assignments.ts"

test("saving a team excludes hidden retired assignments while preserving a newly assigned service", () => {
    assert.deepEqual(activeTeamServiceAssignments(
        [{ id: "website" }, { id: "google-ads" }],
        { website: "member-a", retired: "member-a", "google-ads": "member-b" },
        ["member-a", "member-b"],
    ), [
        { serviceId: "website", userId: "member-a" },
        { serviceId: "google-ads", userId: "member-b" },
    ])
})

test("unassigned services and removed members do not produce assignments", () => {
    assert.deepEqual(activeTeamServiceAssignments(
        [{ id: "unassigned" }, { id: "removed-member" }],
        { "removed-member": "former-member" },
        ["current-member"],
    ), [])
})
