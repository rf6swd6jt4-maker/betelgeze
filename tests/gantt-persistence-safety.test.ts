import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const ganttActions = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/gantt-actions.ts", "utf8")
const ganttClient = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/RelationshipGantt.tsx", "utf8")
const workItemActions = readFileSync("app/[workspaceSlug]/work-items/[id]/actions.ts", "utf8")

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
