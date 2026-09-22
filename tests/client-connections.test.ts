import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("Client Connections preserves active credentials and exposes no disconnect command", () => {
    const migration = source("supabase/migrations/20260922120000_client_connections.sql")
    const manager = source("lib/client-connections.ts")

    assert.match(migration, /alter table client_portal_secure\.ghl_connections/)
    assert.match(migration, /Existing relationship credentials remain in place/)
    assert.match(migration, /p_action not in \('begin_connect','begin_refresh','finish','fail'\)/)
    assert.doesNotMatch(manager, /disconnect/i)
    assert.match(manager, /await fetchGhlMetrics\(credentials\)[\s\S]*await call\(input\.workspaceId, input\.userId, "finish"/)
})

test("Client Connections list query avoids PL/pgSQL record and SQL alias collisions", () => {
    const repair = source("supabase/migrations/20260922191500_fix_client_connections_list.sql")

    assert.match(repair, /v_connection client_portal_secure\.ghl_connections%rowtype/)
    assert.match(repair, /left join client_portal_secure\.ghl_connections ghl_connection/)
    assert.doesNotMatch(repair, /\bconnection\.workspace_id\b/)
})

test("the client portal is read-only and shows setup progress until staff link HighLevel", () => {
    const portal = source("components/client-portal/ClientPortalGhl.tsx")
    const route = source("app/api/client-portal/session/[token]/connections/ghl/route.ts")

    assert.match(portal, /We’re getting your appointments calendar ready\./)
    assert.doesNotMatch(portal, /privateToken|Location ID|Connect HighLevel|Disconnect/)
    assert.match(route, /status: 405/)
    assert.match(route, /Allow: "GET"/)
})

test("Appointment Setting owners receive Client Connections while active onboarding snapshots stay frozen", () => {
    const migration = source("supabase/migrations/20260922120000_client_connections.sql")
    const access = source("lib/workspace-access.ts")

    assert.match(migration, /membership\.role = 'owner'/)
    assert.match(migration, /appointment_setting_setup_assignees/)
    assert.match(migration, /Existing session snapshots are never rewritten/)
    assert.doesNotMatch(migration, /update public\.relationship_onboarding_session_blocks/)
    assert.match(access, /appointment_setting_setup_assignees/)
    assert.match(access, /clientConnectionAssignments\.data\?\.length \? \[CLIENT_CONNECTIONS_CAPABILITY\]/)
})

test("future Appointment Setting onboarding uses one CRM setup block", () => {
    const templates = source("lib/onboarding/service-templates.ts")
    const block = source("components/onboarding/CrmSetupBlock.tsx")

    assert.match(templates, /onboardingBlocks: \[\{ kind: "crm_setup", label: "CRM setup" \}\]/)
    assert.match(block, /Yes, we use HighLevel/)
    assert.match(block, /No, we use another CRM/)
    assert.match(block, /block\.video/)
})
