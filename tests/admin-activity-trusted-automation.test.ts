import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260914190000_trust_nested_admin_activity_automation.sql",
  "utf8",
)

test("database-owner automation is narrowly trusted inside security-definer workflows", () => {
  assert.match(migration, /current_user = 'postgres'/)
  assert.match(migration, /p_actor_kind = 'automation'/)
  assert.match(migration, /p_actor_user_id is null/)
  assert.match(
    migration,
    /current_user <> 'service_role'[\s\S]*and not v_is_trusted_owner_automation[\s\S]*and not public\.is_workspace_member/,
  )
})

test("the recorder remains unavailable to ordinary authenticated callers", () => {
  assert.match(
    migration,
    /revoke all on function public\.record_workspace_admin_activity\([\s\S]*\) from public, anon, authenticated;/,
  )
  assert.match(
    migration,
    /grant execute on function public\.record_workspace_admin_activity\([\s\S]*\) to service_role;/,
  )
  assert.match(migration, /errcode = '42501'/)
})
