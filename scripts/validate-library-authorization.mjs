import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { PGlite, repositoryRoot } from "./pglite-fixture.mjs"

// Synthetic PostgreSQL only. Run with the pinned optional PGlite runtime.
const db = new PGlite()
const q = (sql, values = []) => db.query(sql, values)
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const w = id(1), foreign = id(2), owner = id(10), admin = id(11), staff = id(12), other = id(13), seller = id(14)
const read = name => readFile(`${repositoryRoot}supabase/migrations/${name}`, "utf8")
const migrations = []
for (const name of (await readdir(`${repositoryRoot}supabase/migrations`)).filter(name => name.endsWith(".sql")).sort()) migrations.push(await read(name))
function realFunction(name) {
    const pattern = new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "g")
    const matches = migrations.flatMap(sql => [...sql.matchAll(pattern)].map(match => match[0]))
    assert.ok(matches.length, name)
    return matches.at(-1)
}
let passed = 0
const pass = name => { passed++; console.log(`PASS: ${name}`) }
const actor = async (user, aal = "aal2") => {
    await db.exec("reset role")
    await q("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.aal',$2,false)", [user ?? "", aal])
    await db.exec("set role authenticated")
}
try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create schema auth;
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
        create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true)) $$;
        create table user_profiles(user_id uuid primary key,mfa_reenrollment_required boolean default false);
        create table workspaces(id uuid primary key, slug text unique, name text, status text default 'active');
        create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
        create table workspace_operational_roles(workspace_id uuid,user_id uuid,can_sell boolean default false,can_manage boolean default false,primary key(workspace_id,user_id));
        create table workspace_operational_permissions(workspace_id uuid,position text,capability text,primary key(workspace_id,position,capability));
        create table workspace_member_service_access(workspace_id uuid,user_id uuid,service_id uuid,primary key(workspace_id,user_id,service_id));
        create table workspace_service_capabilities(workspace_id uuid,service_id uuid,capability text,primary key(service_id,capability));
        create table appointment_setting_setup_assignees(workspace_id uuid,user_id uuid,relationship_id uuid,primary key(workspace_id,relationship_id,user_id));
        create table clients(id uuid primary key,workspace_id uuid,relationship_id uuid,name text,email text,phone text,archived_at timestamptz,created_at timestamptz default now());
        create table relationships(id uuid primary key,workspace_id uuid,client_id uuid,primary_person_name text default '',primary_email text,primary_phone text,business_name text,website_url text,industry_value text,location_value text,source_label text,primary_contact_role text,notes_summary text,status text default 'active',lifecycle_phase text default 'lead',seller_user_id uuid,fulfilment_manager_user_id uuid,pos_started_at timestamptz default now(),team_locked_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now());
        create table relationship_services(workspace_id uuid,relationship_id uuid,service_id uuid,assignee_user_id uuid,primary key(relationship_id,service_id));
        create table relationship_service_instances(id uuid primary key,workspace_id uuid,relationship_id uuid,service_id uuid,service_revision_id uuid,assignee_user_id uuid,seller_user_id uuid,manager_user_id uuid,import_id uuid,disposition text default 'active',stage text default 'fulfilment');
        create table relationship_client_chat_members(workspace_id uuid,relationship_id uuid,user_id uuid,primary key(relationship_id,user_id));
        create table work_items(id uuid primary key,workspace_id uuid,title text,description text,lifecycle_phase text default 'fulfilment',kind text default 'standard',status text default 'todo',visibility text default 'workspace',area text default 'workspace',service_id uuid,native_kind text,native_key text,workflow_role text,metadata jsonb default '{}',updated_at timestamptz default now(),created_at timestamptz default now());
        create table work_item_relationships(workspace_id uuid,work_item_id uuid,relationship_id uuid,primary key(work_item_id,relationship_id));
        create table service_instance_work_items(workspace_id uuid,work_item_id uuid,instance_id uuid,cycle_id uuid,primary key(instance_id,work_item_id));
        create table client_sales(id uuid primary key,workspace_id uuid,seller_user_id uuid,service_manager_user_id uuid);
        create table relationship_onboarding_sessions(id uuid primary key,workspace_id uuid,relationship_id uuid,source_sale_id uuid,original_source_sale_id uuid,service_scope text default 'relationship');
        create table relationship_onboarding_session_modules(id uuid primary key,workspace_id uuid,session_id uuid,source_kind text,source_service_revision_id uuid);
        create table relationship_onboarding_session_steps(id uuid primary key,workspace_id uuid,session_id uuid,session_module_id uuid);
        create table service_instance_module_requirements(workspace_id uuid,instance_id uuid,session_id uuid,session_module_id uuid,review_required boolean,primary key(instance_id,session_module_id));
        create table client_communication_channels(id uuid primary key,workspace_id uuid,client_id uuid,relationship_id uuid,external_address text,provider text,is_active boolean default true);
        create table workspace_okrs(id uuid primary key,workspace_id uuid,objective text,objective_type text,description text,status text,period_end date);
        create table workspace_okr_key_results(id uuid primary key,workspace_id uuid,okr_id uuid,name text,description text,unit text,comparator text,sort_order integer default 0,created_at timestamptz default now());
        create table workspace_admin_activity(id uuid primary key,workspace_id uuid,summary text,category text,level text,event_key text,entity_type text,entity_id text,occurred_at timestamptz default now());
        create table onboarding_modules(id uuid primary key,workspace_id uuid,internal_code text,status text default 'active',unique(workspace_id,internal_code),unique(workspace_id,id));
        create table onboarding_module_revisions(id uuid primary key,workspace_id uuid,module_id uuid,status text default 'published',revision_number integer,definition jsonb default '{}',updated_at timestamptz default now());
        create table onboarding_services(id uuid primary key,workspace_id uuid,internal_code text,state text default 'active',unique(workspace_id,internal_code),unique(workspace_id,id));
        create table onboarding_service_revisions(id uuid primary key,workspace_id uuid,service_id uuid,revision_number integer,name text,description text,definition jsonb default '{}',published_at timestamptz default now(),unique(service_id,revision_number));
        create table assets(id uuid primary key,workspace_id uuid,title text,description text,asset_kind text,source_kind text,created_at timestamptz default now());
        create table notes(id uuid primary key,workspace_id uuid,name text,description text,updated_at timestamptz default now());
        create table client_activity(id uuid primary key,workspace_id uuid,client_id uuid,relationship_id uuid,activity_text text,activity_type text,created_at timestamptz default now());

        alter table assets add column metadata jsonb default '{}', add column native_kind text, add column updated_at timestamptz default now();
        create table asset_relationships(workspace_id uuid,asset_id uuid,relationship_id uuid,created_at timestamptz default now(),primary key(asset_id,relationship_id));
        create table asset_work_items(workspace_id uuid,asset_id uuid,work_item_id uuid,created_at timestamptz default now(),primary key(asset_id,work_item_id));
        create table note_work_items(workspace_id uuid,note_id uuid,work_item_id uuid,created_at timestamptz default now());
        create table note_notes(workspace_id uuid,attached_note_id uuid,parent_note_id uuid,created_at timestamptz default now());
        create index asset_work_items_work_item_idx on asset_work_items(work_item_id,created_at desc);
    `)
    for (const name of ["current_session_is_aal2", "is_workspace_member", "workspace_role_for_user", "workspace_user_can_sell", "workspace_user_has_service", "workspace_user_can_access_relationship", "workspace_user_fully_covers_relationship", "workspace_user_can_access_session_module", "workspace_user_can_access_session_step", "workspace_user_can_access_work_item", "workspace_user_can_access_asset"]) await db.exec(realFunction(name))
    const canonical = await read("20260710120000_canonical_work_items_assets.sql")
    const scoped = await read("20260902170000_service_scoped_staff_access.sql")
    const notes = await read("20260918130000_workspace_notes.sql")
    for (const table of ["assets", "asset_relationships", "asset_work_items", "notes", "note_work_items", "note_notes"]) {
        await db.exec(`alter table public.${table} enable row level security;`)
        if (!["note_work_items", "note_notes"].includes(table)) await db.exec(`grant select,update on public.${table} to authenticated`)
    }
    await db.exec("grant usage on schema auth to authenticated")
    for (const source of [canonical, scoped, notes]) {
        for (const match of source.matchAll(/create policy[\s\S]*?;/g)) {
            if (/on public\.(?:assets|asset_relationships|asset_work_items|notes)\s/.test(match[0])) await db.exec(match[0])
        }
    }
    await q("insert into workspaces(id,slug,name) values($1,'alpha','Alpha'),($2,'foreign','Foreign')", [w,foreign])
    for (const [u,role] of [[owner,"owner"],[admin,"admin"],[staff,"staff"],[other,"staff"],[seller,"staff"]]) await q("insert into workspace_memberships values($1,$2,$3)",[w,u,role])
    await q("insert into relationships(id,workspace_id,seller_user_id) values($1,$2,$3)",[id(20),w,seller])
    await q("insert into relationship_services values($1,$2,$3,$4),($1,$2,$5,$6)",[w,id(20),id(30),staff,id(31),other])
    await q("insert into work_items(id,workspace_id,title,service_id) values($1,$2,'Assigned work',$3)",[id(40),w,id(30)])
    await q("insert into work_item_relationships values($1,$2,$3)",[w,id(40),id(20)])
    for (const [a,native,workspace] of [[50,"manual_upload",w],[51,"sop_extracted_image",w],[52,"onboarding_upload",w],[53,"manual_upload",foreign],[54,"manual_upload",w]]) await q("insert into assets(id,workspace_id,title,native_kind) values($1,$2,$3,$4)",[id(a),workspace,`Private ${a}`,native])
    await q("insert into asset_work_items(workspace_id,asset_id,work_item_id) values($1,$2,$5),($1,$3,$5),($1,$4,$5)",[w,id(50),id(51),id(52),id(40)])
    await q("insert into asset_relationships(workspace_id,asset_id,relationship_id) values($1,$2,$3)",[w,id(54),id(20)])
    // Even a link on a readable work item cannot grant a different selected-service module.
    await q("insert into relationship_onboarding_sessions(id,workspace_id,relationship_id,service_scope) values($1,$2,$3,'selected_services')",[id(60),w,id(20)])
    await q("insert into relationship_onboarding_session_modules(id,workspace_id,session_id) values($1,$2,$3)",[id(61),w,id(60)])
    await q("insert into relationship_onboarding_session_steps(id,workspace_id,session_id,session_module_id) values($1,$2,$3,$4)",[id(62),w,id(60),id(61)])
    await q("update assets set metadata=jsonb_build_object('session_id',$1::text,'session_step_id',$2::text) where id=$3",[id(60),id(62),id(52)])
    await q("insert into notes(id,workspace_id,name,description) values($1,$2,'Admin note','Secret')",[id(70),w])
    await q("insert into note_work_items(workspace_id,note_id,work_item_id) values($1,$2,$3)",[w,id(70),id(40)])
    await q("insert into note_notes(workspace_id,attached_note_id,parent_note_id) values($1,$2,$3)",[w,id(70),id(71)])
    const assets = async () => (await q("select id from assets where workspace_id=$1 order by id",[w])).rows.map(row => row.id)
    for (const u of [owner,admin]) {
        await actor(u); assert.deepEqual(await assets(),[50,51,52,54].map(id))
        assert.equal((await q("select * from notes")).rows.length,1)
        assert.equal((await q("update assets set title='Admin update' where workspace_id=$1 and id=$2 returning id",[w,id(50)])).rows.length,1)
    }
    pass("owners and admins retain reads, private notes, and metadata writes")
    await actor(staff)
    assert.deepEqual(await assets(),[50,51].map(id))
    assert.deepEqual((await q("select asset_id from asset_work_items where workspace_id=$1 and work_item_id=$2 order by asset_id",[w,id(40)])).rows.map(row=>row.asset_id),[50,51].map(id))
    assert.equal((await q("select * from asset_relationships")).rows.length,0)
    for (const table of ["notes"]) assert.equal((await q(`select * from ${table}`)).rows.length,0)
    assert.equal((await q("update assets set title='Forbidden' where workspace_id=$1 and id=$2 returning id",[w,id(50)])).rows.length,0)
    pass("staff see assigned work and linked SOP visuals without private notes, unrelated relationship assets, or other selected-service assets")
    await actor(other); assert.deepEqual(await assets(),[])
    await actor(staff,"aal1"); assert.deepEqual(await assets(),[])
    await actor(null); assert.deepEqual(await assets(),[])
    await actor(owner); assert.equal((await q("select id from assets where workspace_id=$1",[foreign])).rows.length,0)
    pass("unassigned, foreign-workspace, missing-actor, and incomplete-MFA requests fail closed")
    await db.exec("reset role")
    await q("delete from workspace_memberships where workspace_id=$1 and user_id=$2",[w,staff])
    await actor(staff); assert.deepEqual(await assets(),[])
    await db.exec("reset role"); await q("update workspace_memberships set role='staff' where workspace_id=$1 and user_id=$2",[w,admin])
    await actor(admin); assert.deepEqual(await assets(),[])
    assert.equal((await q("update assets set title='Revoked admin' where id=$1 returning id",[id(50)])).rows.length,0)
    pass("membership revocation and admin demotion apply to fresh reads and writes")
    await db.exec("reset role")
    await q("insert into workspace_memberships values($1,$2,'staff')", [w,staff])
    await q(`insert into assets(id,workspace_id,title,native_kind,metadata)
        select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'Denied selected-service file','onboarding_upload',jsonb_build_object('session_id',$2::text,'session_step_id',$3::text)
        from generate_series(1,5000) n`, [w,id(60),id(62)])
    await q(`insert into asset_work_items(workspace_id,asset_id,work_item_id,created_at)
        select $1,('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$2,now()+n*interval '1 second' from generate_series(1,5000) n`, [w,id(40)])
    await db.exec("analyze assets; analyze asset_work_items")
    const candidates = (await q("select asset_id from asset_work_items where workspace_id=$1 and work_item_id=$2 order by created_at desc,asset_id desc limit 21", [w,id(40)])).rows
    assert.equal(candidates.length,21)
    const candidateIds = candidates.slice(0,20).map(row=>row.asset_id)
    await actor(staff)
    const sql = "select a.id from asset_work_items l join assets a on a.id=l.asset_id and a.workspace_id=l.workspace_id where l.workspace_id=$1 and l.work_item_id=$2 and l.asset_id=any($3::uuid[])"
    assert.deepEqual((await q(sql,[w,id(40),candidateIds])).rows,[])
    const plan = (await q("explain (analyze,format json) "+sql,[w,id(40),candidateIds])).rows[0]["QUERY PLAN"][0]
    const nodes = []
    const visit = node => { nodes.push(node); for (const child of node.Plans??[]) visit(child) }; visit(plan.Plan)
    const link = nodes.find(node=>node["Relation Name"]==="asset_work_items")
    assert.ok(link)
    assert.ok((link["Actual Rows"]+ (link["Rows Removed by Filter"]??0))*link["Actual Loops"]<=20, "authorization visits at most the fixed20 candidate links, even behind5000 denied records")
    const allowed = [...candidateIds.slice(0,19),id(50)]
    assert.deepEqual((await q(sql,[w,id(40),allowed])).rows.map(row=>row.id),[id(50)])
    pass(`5000 denied-link growth fixture authorizes only20 candidates; ${link["Node Type"]} (${link["Index Name"]??"bitmap"})`)
    console.log(`Library SQL checks: ${passed} groups passed. Existing policy bodies executed; no production access.`)
} finally { await db.close() }
