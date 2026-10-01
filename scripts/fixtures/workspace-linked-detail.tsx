import { createRoot } from "react-dom/client"
import { WorkspaceTopBarClient } from "@/components/workspace/WorkspaceTopBarClient"
import { WorkspaceTabBridge } from "@/components/workspace/WorkspaceTabBridge"
import { WorkspaceTabFrameGuard } from "@/components/workspace/WorkspaceTabFrameGuard"
import { RelationshipContextBridge } from "@/components/workspace/RelationshipContextBridge"
import type { WorkspaceTabRelationshipContext } from "@/lib/workspace-tabs"

const relationshipId = "10000000-0000-4000-8000-000000000020"
const context: WorkspaceTabRelationshipContext = {
    id: relationshipId, primary_person_name: "Jason Fixture", primary_email: "jason@example.test", primary_phone: null,
    business_name: "Synthetic Company", website_url: null, industry_value: null, location_value: "Dublin", source_label: null,
    primary_contact_role: null, notes_summary: "Synthetic saved notes", lifecycle_phase: "onboarding", metrics: [{ label: "Open work", value: 1 }],
    allowedDestinations: ["relationships", "onboarding", "fulfilment", "client-connections"],
}
const workspace = { id: "10000000-0000-4000-8000-000000000010", slug: "fixture", name: "Fixture" }
const capabilities = ["relationships.view", "onboarding.manage", "fulfilment.manage", "client_connections.manage"] as const
const tabId = new URLSearchParams(location.search).get("__betelgeze_tab")
const initialUrl = `${location.pathname}${location.search}`
const initialTab = { id: "fixture-tab", title: "Relationship", url: initialUrl, history: [initialUrl], historyIndex: 0, seenRevision: 0 }
const action = async () => ({ ok: false, error: "Fixture actions are disabled." })
createRoot(document.getElementById("root")!).render(tabId && document.documentElement.dataset.proxyShell !== "true" ? <>
    <WorkspaceTabFrameGuard />
    <WorkspaceTabBridge tabId={tabId} workspaceSlug={workspace.slug} />
    <main data-fixture-detail className="p-6 text-white">
        <h1 data-workspace-record-title="Jason Fixture">{location.pathname.includes("/onboarding/") ? "Onboarding session ready" : "Relationship ready"}</h1>
        <a href={`/fixture/relationships/${relationshipId}`}>Open relationship in another tab</a>
        <input aria-label="Retained local draft" defaultValue="Unsaved local text" />
        <button onClick={event => { event.currentTarget.textContent = "Detail action used" }}>Use detail action</button>
        <RelationshipContextBridge workspaceSlug="fixture" contextPayload={context} workspaceCapabilities={[...capabilities]} />
    </main>
</> : <WorkspaceTopBarClient workspace={workspace} initialWorkspaceUrl={initialUrl} initialTab={initialTab} currentUserId="fixture-user" username="Fixture User" workspaceRole="owner" workspaceCapabilities={[...capabilities]} leaveAction={() => {}} createRelationshipAction={action} createWorkItemAction={action} createAssetAction={action} createNoteAction={action} createOkrAction={action} />)
