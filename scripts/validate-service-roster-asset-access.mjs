// Isolated PostgreSQL/PGlite fixture for the one new migration, using the
// actual real source of the functions it patches and depends on (not
// reimplemented logic), plus minimal stand-in schema for everything else
// those real functions reference but this test does not exercise.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'

const db = new PGlite()
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const w = uuid(1), owner = uuid(2), staffA = uuid(3), staffB = uuid(4), staffC = uuid(5)
const r = uuid(10), instance = uuid(20), service = uuid(30), asset = uuid(40)
const q = async (sql, args = []) => (await db.query(sql, args)).rows
const one = async (sql, args = []) => (await q(sql, args))[0]
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        create table workspaces(id uuid primary key,status text default 'active');
        create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
        create table relationships(id uuid primary key,workspace_id uuid,status text default 'active',seller_user_id uuid,fulfilment_manager_user_id uuid,pos_started_at timestamptz,team_locked_at timestamptz,unique(workspace_id,id));
        create table relationship_services(workspace_id uuid,relationship_id uuid,service_key text,assignee_user_id uuid,primary key(relationship_id,service_key));
        create table relationship_service_instances(id uuid primary key,workspace_id uuid,relationship_id uuid,service_id uuid,assignee_user_id uuid,import_id uuid,disposition text default 'active',stage text,unique(workspace_id,id));
        create table workspace_member_service_access(workspace_id uuid,service_id uuid,user_id uuid,primary key(workspace_id,service_id,user_id));
        create table service_queue_rosters(workspace_id uuid,instance_id uuid primary key);
        create table service_queue_members(workspace_id uuid,instance_id uuid,user_id uuid,primary key(instance_id,user_id));
        create table assets(id uuid primary key,workspace_id uuid,metadata jsonb not null default '{}',native_kind text,source_kind text);
        create table asset_relationships(workspace_id uuid,asset_id uuid,relationship_id uuid,primary key(asset_id,relationship_id));
        create table asset_work_items(workspace_id uuid,asset_id uuid,work_item_id uuid,primary key(asset_id,work_item_id));
        create table work_items(id uuid primary key,workspace_id uuid);
        create table relationship_onboarding_sessions(id uuid primary key,workspace_id uuid,relationship_id uuid,service_scope text);
        create table relationship_onboarding_session_steps(id uuid primary key,workspace_id uuid,session_id uuid,session_module_id uuid);
        create table workspace_teams(id uuid primary key,workspace_id uuid,relationship_id uuid,kind text,archived_at timestamptz);
        create table workspace_team_members(workspace_id uuid,team_id uuid,user_id uuid,primary key(team_id,user_id));
        create function workspace_role_for_user(p_workspace_id uuid,p_user_id uuid) returns text language sql stable security definer as $$ select role from workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id $$;
        create function workspace_user_can_access_work_item(uuid,uuid,uuid) returns boolean language sql stable as $$ select false $$;
        create function workspace_user_can_access_session_module(uuid,uuid,uuid) returns boolean language sql stable as $$ select false $$;
        insert into workspaces values('${w}');
        insert into auth.users values('${owner}'),('${staffA}'),('${staffB}'),('${staffC}');
        insert into workspace_memberships values('${w}','${owner}','owner'),('${w}','${staffA}','staff'),('${w}','${staffB}','staff'),('${w}','${staffC}','staff');
        insert into relationships values('${r}','${w}','active',null,null,null,null);
        insert into relationship_service_instances values('${instance}','${w}','${r}','${service}','${staffA}',null,'active','setup');
        insert into assets values('${asset}','${w}','{}','manual_upload','upload');
        insert into asset_relationships values('${w}','${asset}','${r}');
    `)
    // Real workspace_user_fully_covers_relationship and service_queue_is_member,
    // copied verbatim from their source migrations (not reimplemented).
    await db.exec(`
        create or replace function public.workspace_user_fully_covers_relationship(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean
        language sql stable security definer set search_path=public as $$
         select exists(select 1 from public.relationships r join public.workspace_memberships m on m.workspace_id=r.workspace_id and m.user_id=p_user_id
         where r.workspace_id=p_workspace_id and r.id=p_relationship_id and (m.role in ('owner','admin') or r.seller_user_id=p_user_id or r.fulfilment_manager_user_id=p_user_id
         or ((exists(select 1 from public.relationship_services s where s.workspace_id=r.workspace_id and s.relationship_id=r.id)
              or exists(select 1 from public.relationship_service_instances i where i.workspace_id=r.workspace_id and i.relationship_id=r.id and i.import_id is null))
         and not exists(select 1 from public.relationship_services s where s.workspace_id=r.workspace_id and s.relationship_id=r.id and s.assignee_user_id is distinct from p_user_id)
         and not exists(select 1 from public.relationship_service_instances i where i.workspace_id=r.workspace_id and i.relationship_id=r.id and i.import_id is null and i.assignee_user_id is distinct from p_user_id))))
        $$;
        create function public.service_queue_is_member(p_workspace uuid,p_instance uuid,p_user uuid) returns boolean
        language sql stable security definer set search_path=public as $$
         select exists(select 1 from service_queue_rosters q
         join relationship_service_instances i on i.workspace_id=q.workspace_id and i.id=q.instance_id
         join relationships r on r.workspace_id=i.workspace_id and r.id=i.relationship_id and r.status<>'archived'
         join workspace_memberships m on m.workspace_id=i.workspace_id and m.user_id=p_user
         join workspace_member_service_access e on e.workspace_id=i.workspace_id and e.service_id=i.service_id and e.user_id=m.user_id
         where q.workspace_id=p_workspace and q.instance_id=p_instance and i.import_id is null
         and i.disposition<>'cancelled' and i.stage in ('onboarding','setup','maintenance')
         and (i.assignee_user_id=p_user or exists(select 1 from service_queue_members a where a.instance_id=i.id and a.user_id=p_user)))
        $$;
    `)
    // Real workspace_user_can_access_asset, extracted verbatim from its source migration.
    const assetAccessSource = await readFile(`${repositoryRoot}supabase/migrations/20261021180000_portal_upload_delivery_team_access.sql`, 'utf8')
    const assetAccessFn = assetAccessSource.slice(assetAccessSource.indexOf('create or replace function public.workspace_user_can_access_asset'), assetAccessSource.indexOf('$asset_access$;') + '$asset_access$;'.length)
    assert.ok(assetAccessFn.includes('workspace_user_fully_covers_relationship'))
    await db.exec(assetAccessFn)
    pass('real workspace_user_fully_covers_relationship, service_queue_is_member and pre-migration workspace_user_can_access_asset load against the minimal fixture')

    const access = (user, assetId = asset) => one('select workspace_user_can_access_asset($1,$2,$3) ok', [w, assetId, user]).then(r => r.ok)
    assert.equal(await access(owner), true)
    assert.equal(await access(staffA), true)
    assert.equal(await access(staffB), false)
    assert.equal(await access(staffC), false)
    pass('pre-migration: owner and the sole primary assignee can read the relationship-linked asset; an uninvolved staff member and a roster-eligible-but-not-yet-added staff member cannot')

    await q('insert into service_queue_rosters values($1,$2)', [w, instance])
    await q('insert into service_queue_members values($1,$2,$3)', [w, instance, staffB])
    await q('insert into workspace_member_service_access values($1,$2,$3)', [w, service, staffB])
    assert.equal(await access(staffB), false)
    pass('a service_queue_members roster row alone does not grant asset access before the migration applies')

    await db.exec(await readFile(`${repositoryRoot}supabase/migrations/20261106120000_service_roster_asset_access.sql`, 'utf8'))
    assert.equal(await access(staffB), true, 'roster member gains access after the migration')
    assert.equal(await access(staffA), true, 'sole primary assignee is unaffected')
    assert.equal(await access(owner), true, 'owner short-circuit is unaffected')
    assert.equal(await access(staffC), false, 'an uninvolved staff member still cannot see it')
    pass('migration grants relationship-linked asset access to the service_queue roster member, without widening access for anyone else')

    await q("update relationship_service_instances set disposition='cancelled' where id=$1", [instance])
    assert.equal(await access(staffB), false, 'cancelled instance revokes roster-derived access')
    await q("update relationship_service_instances set disposition='active' where id=$1", [instance])
    assert.equal(await access(staffB), true, 'restored')

    await q("update relationship_service_instances set stage='completed' where id=$1", [instance])
    assert.equal(await access(staffB), false, 'completed stage revokes roster-derived access')
    await q("update relationship_service_instances set stage='setup' where id=$1", [instance])
    assert.equal(await access(staffB), true, 'restored')

    await q('delete from workspace_member_service_access where workspace_id=$1 and service_id=$2 and user_id=$3', [w, service, staffB])
    assert.equal(await access(staffB), false, 'losing service eligibility revokes roster-derived access')
    await q('insert into workspace_member_service_access values($1,$2,$3)', [w, service, staffB])
    assert.equal(await access(staffB), true, 'restored')

    await q('delete from service_queue_members where instance_id=$1 and user_id=$2', [instance, staffB])
    assert.equal(await access(staffB), false, 'removal from the roster revokes access')
    pass('roster-derived asset access correctly inherits every existing service_queue_is_member eligibility guard (active disposition, in-delivery stage, current service access, current roster membership)')

    await assert.rejects(db.exec(await readFile(`${repositoryRoot}supabase/migrations/20261106120000_service_roster_asset_access.sql`, 'utf8')), /Unexpected asset access definition/)
    pass('guarded installer rejects re-applying the migration once the anchor text is already patched')

    console.log(`Service roster asset access: ${checks} groups passed`)
} finally { await db.close() }
