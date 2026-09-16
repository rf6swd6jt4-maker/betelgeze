import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("completed imports require explicit seller and manager choices", async () => {
    const [form, action] = await Promise.all([
        readFile("components/relationships/RelationshipServicesWorkspace.tsx", "utf8"),
        readFile("app/[workspaceSlug]/relationships/service-actions.ts", "utf8"),
    ])

    assert.match(form, /origin === "already_onboarded" && stage === "completed"/)
    assert.match(form, /ariaLabel="Relationship seller"/)
    assert.match(form, /ariaLabel="Relationship manager"/)
    assert.match(form, /kind=responsibility/)
    assert.match(action, /completedImport[\s\S]*add_completed_relationship_service/)
    assert.match(action, /!uuid\.test\(input\.sellerId\) \|\| !uuid\.test\(input\.managerId\)/)
})

test("completed imports atomically preserve attribution and grant relationship chat responsibility", async () => {
    const migration = await readFile("supabase/migrations/20260916130000_completed_service_responsibility.sql", "utf8")

    assert.match(migration, /pg_advisory_xact_lock/)
    assert.match(migration, /can_manage_relationship_service\(p_workspace_id,p_relationship_id,p_actor_user_id,'already_onboarded'\)/)
    assert.match(migration, /relationship\.seller_user_id is not null[\s\S]*different seller/)
    assert.match(migration, /relationship\.fulfilment_manager_user_id is not null[\s\S]*different manager/)
    assert.match(migration, /operational\.can_sell/)
    assert.match(migration, /operational\.can_manage/)
    assert.match(migration, /seller_user_id=coalesce\(seller_user_id,p_seller_user_id\)/)
    assert.match(migration, /fulfilment_manager_user_id=coalesce\(fulfilment_manager_user_id,p_manager_user_id\)/)
    assert.match(migration, /insert into public\.relationship_service_instances\([\s\S]*seller_user_id,manager_user_id/)
    assert.match(migration, /instance\.source_snapshot is distinct from snapshot/)
})
