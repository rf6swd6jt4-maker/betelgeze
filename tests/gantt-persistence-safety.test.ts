import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const ganttActions = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts", "utf8")
const ganttClient = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/RelationshipGantt.tsx", "utf8")
const workItemActions = readFileSync("app/[workspaceSlug]/work-items/[id]/actions.ts", "utf8")
const repairMigration = readFileSync("supabase/migrations/20260713090000_gantt_schedule_persistence_and_repair.sql", "utf8")

test("Gantt saves are database-verified before the optimistic plan is accepted", () => {
    assert.match(ganttActions, /persistedScheduleMatchesChange/)
    assert.match(ganttActions, /getRelationshipGanttPlan/)
    assert.match(ganttActions, /return \{ status: "saved", plan \}/)
    assert.match(ganttClient, /if \(next\.plan\) setPlan\(next\.plan\)/)
})

test("restored charts and work-item schedule edits refresh linked relationships", () => {
    assert.match(ganttClient, /addEventListener\("pageshow", reconcileRestoredPage\)/)
    assert.match(workItemActions, /refreshScheduleSurfaces/)
    assert.match(workItemActions, /revalidatePath\(`\/\$\{slug\}\/relationships\/\$\{relationshipId\}`\)/)
})

test("the Gantt RPC qualifies updated_at and legacy schedules are repaired before constraints", () => {
    assert.match(repairMigration, /and item\.updated_at = \(change->>'expected_updated_at'\)::timestamptz/)
    assert.doesNotMatch(repairMigration, /and updated_at = \(change->>'expected_updated_at'\)::timestamptz/)
    assert.match(repairMigration, /Legacy Gantt schedule repair did not converge/)
    assert.match(repairMigration, /create constraint trigger validate_work_item_schedule_legality/)
    assert.match(repairMigration, /create constraint trigger validate_work_item_dependency_schedule_legality/)
})
