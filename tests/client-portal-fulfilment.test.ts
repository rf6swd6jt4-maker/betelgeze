import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { clientPortalOverview } from "../lib/client-portal/overview.ts"

const migration = readFileSync("supabase/migrations/20260922100000_client_portal_fulfilment.sql", "utf8")
const session = readFileSync("lib/client-portal/session.ts", "utf8")
const shell = readFileSync("components/client-portal/ClientPortalShell.tsx", "utf8")
const leads = readFileSync("components/client-portal/ClientPortalLeads.tsx", "utf8")
const actions = readFileSync("components/communications/ClientPortalActions.tsx", "utf8")
const route = readFileSync("app/api/workspaces/[workspaceSlug]/relationships/[relationshipId]/portal/route.ts", "utf8")

test("onboarding completion atomically provisions the portal, action, progress, and durable link", () => {
    const trigger = migration.slice(migration.indexOf("create or replace function public.provision_client_portal_after_onboarding"))
    const portal = trigger.indexOf("insert into public.client_portal_sessions")
    const seed = trigger.indexOf("perform public.seed_client_portal_fulfilment")
    const alreadySent = trigger.indexOf("if already_sent then return new")
    const outbox = trigger.indexOf("insert into public.onboarding_delivery_outbox")
    assert.ok(portal >= 0 && seed > portal && alreadySent > seed && outbox > alreadySent)
    assert.match(migration, /Message your team to confirm you received access to your portal/u)
    assert.match(migration, /'client-portal-link:' \|\| new\.id::text/u)
    assert.match(migration, /on conflict \(workspace_id, idempotency_key\) do nothing/u)
    assert.match(migration, /relationship\.source_metadata->>'is_test' = 'true'/u)
})

test("the portal overview is token scoped, bounded, and staff-only", () => {
    assert.match(migration, /current_user <> 'service_role'/u)
    assert.match(migration, /session_token = lower\(p_token\)/u)
    assert.match(migration, /status = 'active' and token_revoked_at is null/u)
    assert.match(migration, /limit 50/u)
    assert.match(session, /rpc\("client_portal_overview"/u)
    assert.match(route, /requireWorkspacePanel\(workspaceSlug, "communications"\)/u)
    assert.match(route, /clientConversationCanAccess/u)
    assert.match(route, /\.eq\("workspace_id", workspaceId\)\.eq\("relationship_id", relationshipId\)/u)
})

test("portal landing and lead visibility follow onboarding state", () => {
    assert.match(shell, /overview\.hasFulfilment \? "fulfilment" : "leads"/u)
    assert.match(migration, /when portal\.onboarding_session_id is null then 'ghl'/u)
    assert.match(migration, /appointment_medium_count > 0 and appointment_fields_count > 0 then 'appointments'/u)
    assert.match(migration, /else 'empty'/u)
    assert.match(leads, /mode === "appointments"/u)
    assert.match(leads, /mode === "empty"/u)
    assert.match(leads, /Nothing here yet/u)
    assert.match(leads, /<ClientPortalGhl/u)
    assert.doesNotMatch(shell, /ClientPortalGoogleAds/u)
})

test("required actions are staff-managed and have no client completion control", () => {
    assert.match(actions, /action\.status === "open" \? "completed" : "open"/u)
    assert.match(actions, /Add required action/u)
    assert.match(actions, /Fulfilment progress/u)
    assert.doesNotMatch(readFileSync("components/client-portal/ClientPortalFulfilment.tsx", "utf8"), /method:\s*"PATCH"|onClick/u)
})

test("overview parsing rejects malformed rows and defaults to the empty lead view", () => {
    assert.deepEqual(clientPortalOverview(null), { hasFulfilment: false, leadMode: "empty", actions: [], progress: [] })
    const parsed = clientPortalOverview({
        hasFulfilment: true,
        leadMode: "appointments",
        actions: [{ id: "a", title: "Confirm access", status: "open", completedAt: null, updatedAt: "2026-09-22T10:00:00Z" }, { id: 2 }],
        progress: [{ id: "p", serviceName: "Meta Ads Setup", status: "preparing", updatedAt: "2026-09-22T10:00:00Z" }, { id: "bad", serviceName: "Bad", status: "internal", updatedAt: "2026-09-22T10:00:00Z" }],
    })
    assert.equal(parsed.actions.length, 1)
    assert.equal(parsed.progress.length, 1)
    assert.equal(parsed.leadMode, "appointments")
})
