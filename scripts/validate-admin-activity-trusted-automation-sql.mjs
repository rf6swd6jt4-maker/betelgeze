// Actual repair migration in isolated PostgreSQL/WASM; no credentials or provider calls.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { PGlite, loadPGliteExtension, repositoryRoot } from "./pglite-fixture.mjs"

const db = new PGlite({ extensions: { pgcrypto: loadPGliteExtension("pgcrypto") } })
const workspaceId = "00000000-0000-4000-8000-000000000001"
const userId = "00000000-0000-4000-8000-000000000002"
const signature = "uuid,text,text,text,text,text,text,text,uuid,text,jsonb,jsonb,timestamptz,uuid,uuid,text,text,text,text,uuid,boolean"

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.work_items(id uuid primary key, workspace_id uuid not null);
    create table public.workspace_admin_activity(
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null,
      category text,
      level text,
      event_key text,
      summary text,
      entity_type text,
      entity_id text,
      source_href text,
      actor_user_id uuid,
      actor_kind text,
      metadata jsonb default '{}'::jsonb,
      diagnostics jsonb default '{}'::jsonb,
      occurred_at timestamptz,
      correlation_id uuid,
      causation_event_id uuid,
      idempotency_key text,
      outcome text,
      metric_classification text,
      failure_fingerprint text,
      maintenance_work_item_id uuid
    );
    create unique index workspace_admin_activity_idempotency
      on public.workspace_admin_activity(workspace_id, idempotency_key)
      where idempotency_key is not null;
    create function public.sanitize_admin_activity_json(value jsonb)
      returns jsonb language sql immutable as $$ select value $$;
    create function public.is_workspace_member(workspace_id uuid, allowed_roles text[])
      returns boolean language sql stable as $$ select false $$;
  `)

  const migration = await readFile(
    `${repositoryRoot}/supabase/migrations/20260914190000_trust_nested_admin_activity_automation.sql`,
    "utf8",
  )
  await db.exec(migration)

  await db.exec(`
    create function public.fixture_selected_service_sale_activity(p_workspace_id uuid)
      returns uuid
      language sql
      security definer
      set search_path = public
      as $$
        select public.record_workspace_admin_activity(
          p_workspace_id,
          'onboarding',
          'onboarding.session.created',
          'Created selected-service onboarding session',
          p_actor_kind => 'automation'
        )
      $$;
    revoke all on function public.fixture_selected_service_sale_activity(uuid) from public;
    grant execute on function public.fixture_selected_service_sale_activity(uuid) to service_role;
    set role service_role;
  `)
  const trusted = await db.query(
    "select public.fixture_selected_service_sale_activity($1) as id",
    [workspaceId],
  )
  assert.match(trusted.rows[0].id, /^[0-9a-f-]{36}$/)
  await db.exec("reset role")
  assert.equal(
    (await db.query("select count(*)::int as count from public.workspace_admin_activity")).rows[0].count,
    1,
  )

  const acl = await db.query(
    `select
       has_function_privilege('service_role', 'public.record_workspace_admin_activity(${signature})', 'EXECUTE') as service_role,
       has_function_privilege('authenticated', 'public.record_workspace_admin_activity(${signature})', 'EXECUTE') as authenticated`,
  )
  assert.equal(acl.rows[0].service_role, true)
  assert.equal(acl.rows[0].authenticated, false)

  await assert.rejects(
    db.query(
      `select public.record_workspace_admin_activity(
         $1, 'security', 'untrusted.owner.call', 'Must be rejected',
         p_actor_user_id => $2,
         p_actor_kind => 'user'
       )`,
      [workspaceId, userId],
    ),
    /Admin Activity may only be recorded/,
  )

  console.log(JSON.stringify({
    migration: "applied in isolated PGlite",
    trustedNestedAutomationRows: 1,
    authenticatedExecute: false,
    userAttributedOwnerCall: "rejected",
  }))
} finally {
  await db.close()
}
