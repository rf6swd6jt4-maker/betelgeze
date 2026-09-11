import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("compact selectors share the anchored drawer and canonical identity elements", async () => {
    const [selector, assignment, communication, standards, agentRules] = await Promise.all([
        readFile("components/ui/Selector.tsx", "utf8"),
        readFile("components/ui/AssignmentSelector.tsx", "utf8"),
        readFile("components/ui/CommunicationMethodSelector.tsx", "utf8"),
        readFile("docs/ui-standards.md", "utf8"),
        readFile("AGENTS.md", "utf8"),
    ])

    assert.match(selector, /<AnchoredPopup/)
    assert.match(selector, /aria-haspopup="listbox"/)
    assert.match(selector, /role="option"/)
    assert.match(selector, /max-h-\[min\(16rem,45dvh\)\]/)
    assert.match(assignment, /<Assignee/)
    assert.match(communication, /<CommunicationMethodLabel/)
    assert.match(standards, /## Selectors and compact choice drawers/)
    assert.match(standards, /### AssignmentSelector/)
    assert.match(standards, /### CommunicationMethodSelector/)
    assert.match(agentRules, /chevron selectors/)
})

test("relationship and operational assignment paths use the shared selectors", async () => {
    const [relationship, retention, create, settings, officers, okrs, workItem, mention] = await Promise.all([
        readFile("app/[workspaceSlug]/relationships/[relationshipId]/RelationshipDealWorkspace.tsx", "utf8"),
        readFile("components/workspace/RetentionRelationshipFields.tsx", "utf8"),
        readFile("components/workspace/WorkspaceCreateModal.tsx", "utf8"),
        readFile("components/settings/WorkspaceTeamSettings.tsx", "utf8"),
        readFile("components/admin/WorkspaceOfficerSettings.tsx", "utf8"),
        readFile("components/admin/OkrWorkspace.tsx", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8"),
        readFile("components/communications/ComposerMentionPicker.tsx", "utf8"),
    ])

    assert.match(relationship, /<CommunicationMethodSelector/)
    assert.match(relationship, /<AssignmentSelector/)
    assert.match(retention, /<AssignmentSelector/)
    assert.match(create, /<CommunicationMethodSelector/)
    assert.match(create, /relationshipStartPhase === "potential_client"[\s\S]*?<CommunicationMethodSelector/)
    assert.match(settings, /<AssignmentSelector/)
    assert.match(officers, /<AssignmentSelector/)
    assert.match(okrs, /<AssignmentSelector/)
    assert.doesNotMatch(okrs, /<select name="(?:owner_user_id|execution_owner_id)"/)
    assert.match(workItem, /<SelectorDrawer/)
    assert.match(workItem, /<SelectorOption/)
    assert.match(mention, /<SelectorDrawer/)
    assert.match(mention, /<SelectorOption/)
})
