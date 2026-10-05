// Actual migration SQL in isolated PostgreSQL/WASM; no credentials or provider calls.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'

const db = new PGlite()
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const w = uuid(1), other = uuid(2), owner = uuid(3), staff = uuid(4), unrelated = uuid(5), seller = uuid(6)
const r = uuid(10), rOther = uuid(11), service = uuid(20), revision = uuid(21), serviceB = uuid(22), revisionB = uuid(23)
const sale = uuid(30), line = uuid(31), session = uuid(32), sharedModule = uuid(33), work = uuid(34)
const q = async (sql, args = []) => (await db.query(sql, args)).rows
const one = async (sql, args = []) => (await q(sql, args))[0]
const rejects = async (sql, args, re) => assert.rejects(q(sql, args), re)
let checks = 0
const pass = label => { checks++; console.log(`PASS ${checks}: ${label}`) }
try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        create function current_session_is_aal2() returns boolean language sql stable as $$ select coalesce(current_setting('fixture.aal2',true),'true') <> 'false' $$;
        create table workspaces(id uuid primary key);
        create table workspace_memberships(workspace_id uuid, user_id uuid, role text, primary key(workspace_id,user_id));
        create table relationships(id uuid primary key,workspace_id uuid,status text default 'active',lifecycle_phase text default 'fulfilment',seller_user_id uuid,fulfilment_manager_user_id uuid,unique(workspace_id,id));
        create table onboarding_services(id uuid primary key,workspace_id uuid,internal_code text,state text default 'active',unique(workspace_id,id));
        create table onboarding_service_revisions(id uuid primary key,workspace_id uuid,service_id uuid,revision_number integer not null default 1,unique(workspace_id,id),unique(service_id,revision_number));
        create table onboarding_service_revision_modules(workspace_id uuid,service_revision_id uuid,module_id uuid,primary key(service_revision_id,module_id));
        create table workspace_member_service_access(workspace_id uuid,service_id uuid,user_id uuid,primary key(workspace_id,user_id,service_id));
        create table relationship_services(workspace_id uuid,relationship_id uuid,service_key text,service_id uuid,service_revision_id uuid,assignee_user_id uuid,upfront_price_cents integer,recurring_price_cents integer,currency text,primary key(relationship_id,service_key));
        create table client_sales(id uuid primary key,workspace_id uuid,relationship_id uuid,seller_user_id uuid,status text,snapshot_frozen_at timestamptz,stripe_invoice_status text,currency text,upfront_total_amount integer,recurring_total_amount integer,billing_interval text,billing_interval_count integer,unique(workspace_id,id));
        create table client_sale_items(id uuid primary key,workspace_id uuid,client_sale_id uuid,service_id uuid,service_revision_id uuid,service_code text,service_name text,upfront_amount_cents integer,recurring_amount_cents integer,currency text,unique(workspace_id,id),unique(client_sale_id,service_id));
        create table relationship_onboarding_sessions(id uuid primary key,workspace_id uuid,relationship_id uuid,source_sale_id uuid,status text,session_token text unique,unique(workspace_id,id));
        create unique index legacy_one_active_session on relationship_onboarding_sessions(workspace_id,relationship_id) where status='active';
        create table relationship_onboarding_session_modules(id uuid primary key,workspace_id uuid,session_id uuid,module_id uuid,module_revision_id uuid,source_kind text,source_service_revision_id uuid,unique(workspace_id,id));
        create table work_items(id uuid primary key,workspace_id uuid,service_id uuid,native_key text,status text,actual_completed_at timestamptz);
        create table work_item_relationships(workspace_id uuid,relationship_id uuid,work_item_id uuid,primary key(work_item_id,relationship_id));
        create index fixture_work_relationship_idx on work_item_relationships(workspace_id,relationship_id,work_item_id);
        create table work_item_dependencies(workspace_id uuid,work_item_id uuid,depends_on_work_item_id uuid);
        create table assets(id uuid primary key,workspace_id uuid,relationship_id uuid);
        create table fixture_client_chat_members(workspace_id uuid,relationship_id uuid,user_id uuid);
        create function workspace_user_can_access_relationship(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean language sql stable security definer as $$
            select exists(select 1 from relationships x join workspace_memberships m on m.workspace_id=x.workspace_id and m.user_id=p_user_id
                where x.workspace_id=p_workspace_id and x.id=p_relationship_id and (m.role in ('owner','admin') or p_user_id in(x.seller_user_id,x.fulfilment_manager_user_id)
                    or exists(select 1 from relationship_services s where s.workspace_id=p_workspace_id and s.relationship_id=p_relationship_id and s.assignee_user_id=p_user_id))) $$;
        create function workspace_user_fully_covers_relationship(p_workspace_id uuid,p_relationship_id uuid,p_user_id uuid default auth.uid()) returns boolean language sql stable security definer as $$
            select exists(select 1 from relationships x join workspace_memberships m on m.workspace_id=x.workspace_id and m.user_id=p_user_id
                where x.workspace_id=p_workspace_id and x.id=p_relationship_id and (m.role in ('owner','admin') or p_user_id in(x.seller_user_id,x.fulfilment_manager_user_id))) $$;
        create function workspace_user_can_access_work_item(w uuid,i uuid,u uuid default auth.uid()) returns boolean language sql stable security definer as $$
            select exists(select 1 from work_items x join work_item_relationships l on l.workspace_id=x.workspace_id and l.work_item_id=x.id where x.workspace_id=w and x.id=i and workspace_user_can_access_relationship(w,l.relationship_id,u)) $$;
        create function workspace_user_can_access_session_module(w uuid,i uuid,u uuid default auth.uid()) returns boolean language sql stable security definer as $$
            select exists(select 1 from relationship_onboarding_session_modules x join relationship_onboarding_sessions s on s.workspace_id=x.workspace_id and s.id=x.session_id where x.workspace_id=w and x.id=i and workspace_user_can_access_relationship(w,s.relationship_id,u)) $$;
        grant usage on schema public,auth to authenticated,service_role;
        grant execute on function auth.uid(),current_session_is_aal2() to authenticated,service_role;
        insert into workspaces values('${w}'),('${other}');
        insert into auth.users values('${owner}'),('${staff}'),('${unrelated}'),('${seller}');
        insert into workspace_memberships values('${w}','${owner}','owner'),('${w}','${staff}','staff'),('${w}','${unrelated}','staff'),('${w}','${seller}','staff');
        insert into relationships values('${r}','${w}','active','fulfilment','${seller}','${owner}'),('${rOther}','${other}','active','retention',null,null);
        insert into onboarding_services values('${service}','${w}','ads','active'),('${serviceB}','${w}','website','active');
        insert into onboarding_service_revisions(id,workspace_id,service_id) values('${revision}','${w}','${service}'),('${revisionB}','${w}','${serviceB}');
        insert into workspace_member_service_access values('${w}','${service}','${staff}'),('${w}','${service}','${unrelated}');
        insert into relationship_services values('${w}','${r}','ads','${service}','${revision}','${staff}',110000,25000,'EUR');
        insert into client_sales values('${sale}','${w}','${r}','${seller}','paid',now(),'paid','eur',110000,25000,'month',1);
        insert into client_sale_items values('${line}','${w}','${sale}','${service}','${revision}','ads','Ads',110000,25000,'EUR');
        insert into relationship_onboarding_sessions values('${session}','${w}','${r}','${sale}','completed','private-token-never-in-report');
        insert into relationship_onboarding_session_modules values('${sharedModule}','${w}','${session}','${uuid(91)}','${uuid(90)}','mandatory',null);
        insert into work_items values('${work}','${w}','${service}','legacy-setup','done',now()),('${uuid(35)}','${w}',null,'relationship-stage','todo',null);
        insert into work_item_relationships values('${w}','${r}','${work}'),('${w}','${r}','${uuid(35)}');
        insert into work_item_dependencies values('${w}','${uuid(35)}','${work}');
        insert into assets values('${uuid(36)}','${w}','${r}');
        insert into fixture_client_chat_members values('${w}','${r}','${seller}');
    `)
    for (const migration of ['20260912120000_service_instance_foundation.sql','20260912121000_service_instance_import_rehearsal.sql','20260912122000_service_instance_foundation_commands.sql']) {
        await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/${migration}`, 'utf8'))
    }
    pass('three full migrations apply with function body checking enabled')
    await db.exec(`
        alter table relationships alter column id set default gen_random_uuid();
        alter table relationships add column primary_person_name text,add column business_name text,add column primary_email text,add column primary_phone text,
            add column source_type text,add column source_label text,add column source_metadata jsonb default '{}',add column pos_started_at timestamptz,add column team_locked_at timestamptz,
            add column updated_at timestamptz default now(),add column primary_contact_role text,add column whatsapp_phone text,add column communication_primary_provider text default 'meta_whatsapp',
            add column communication_delivery_mode text default 'primary_only',add column notes_summary text;
        alter table workspaces add column status text default 'active';
        alter table onboarding_service_revisions add column name text default 'Ads',add column description text default '',add column default_upfront_price_cents integer default 10000,
            add column default_recurring_price_cents integer default 5000,add column currency text default 'EUR',add column definition jsonb default '{}';
        alter table relationship_services add column created_at timestamptz default now();
        alter table client_sales add column created_at timestamptz default now();
        alter table relationship_onboarding_sessions add column created_at timestamptz default now();
        alter table work_items add column title text default 'Existing work',add column updated_at timestamptz default now();
        create table user_profiles(user_id uuid primary key,username text,display_name text);
        insert into user_profiles values('${staff}','staff','Assigned staff'),('${seller}','seller','Seller'),('${unrelated}','recipient','Recipient staff');
        create function workspace_user_can_sell(p_workspace_id uuid,p_user_id uuid) returns boolean language sql stable security definer as $$
            select exists(select 1 from workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id and (role in ('owner','admin') or user_id='${seller}')) $$;
        create function workspace_role_for_user(p_workspace_id uuid,p_user_id uuid) returns text language sql stable security definer as $$ select role from workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id $$;
    `)
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260910220000_relationship_background_command_receipts.sql`, 'utf8'))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912130000_relationship_services_ui.sql`, 'utf8'))
    pass('SS-02 applies against the existing background command and SS-01 tables')

    await db.exec(`
      alter table work_items add column execution_owner_id uuid, add column visibility text default 'workspace', add column area text default 'client_work', add column workflow_role text default 'task', add column metadata jsonb default '{}', add column native_kind text, add column created_by uuid;
      create table work_item_assignees(workspace_id uuid,work_item_id uuid,user_id uuid,assigned_by uuid,primary key(work_item_id,user_id));
      create table workspace_okr_work_items(workspace_id uuid,work_item_id uuid);
      create table workspace_service_capabilities(workspace_id uuid,service_id uuid,capability text);
      create table appointment_setting_setup_assignees(workspace_id uuid,relationship_id uuid,user_id uuid,primary key(workspace_id,relationship_id,user_id));
      create table relationship_onboarding_session_steps(id uuid,workspace_id uuid,session_id uuid,session_module_id uuid);
      create function workspace_user_can_access_session_step(uuid,uuid,uuid) returns boolean language sql as $$select false$$;
      create schema client_portal_secure;
      create table client_portal_secure.ghl_connections(workspace_id uuid,relationship_id uuid,account_type text,vault_secret_id uuid,location_id text,location_name text,refreshed_at timestamptz,ready_at timestamptz,last_error text,lease_until timestamptz);
      create function auth.role() returns text language sql as $$select 'service_role'::text$$;
      create function workspace_shell_bootstrap(p_workspace_slug text,p_user_id uuid) returns jsonb language sql as $$
      select to_jsonb(exists(select 1 from public.appointment_setting_setup_assignees assignment where assignment.workspace_id=context.workspace_id and assignment.user_id=p_user_id)) from workspace_memberships context where context.user_id=p_user_id limit 1 $$;
    `)
    const migration = async name => readFile(`${repositoryRoot}/supabase/migrations/${name}`, 'utf8')
    const ownership = await migration('20260809150000_multi_owner_admin_queue.sql')
    await db.exec(ownership.slice(ownership.indexOf('create or replace function public.validate_work_item_execution_owner()'), ownership.indexOf('create or replace function public.validate_okr_work_execution_owner()')))
    const accessSql = await migration('20260927120000_onboarding_review_queue_access.sql')
    await db.exec('drop function workspace_user_can_access_work_item(uuid,uuid,uuid) cascade')
    await db.exec(accessSql.slice(accessSql.indexOf('create or replace function public.workspace_user_can_access_work_item('),accessSql.indexOf("notify pgrst")))
    const queueSql = await migration('20260915120000_personal_work_queue.sql')
    await db.exec(queueSql.slice(queueSql.indexOf('create function public.personal_queue_owns('),queueSql.indexOf('create function public.queue_work_open(')))
    await db.exec(await migration('20260922191500_fix_client_connections_list.sql'))
    const commandDefinition=async()=>one("select pg_get_functiondef(oid) definition,proacl::text privileges,prosecdef security_definer from pg_proc where oid='public.change_service_instance(uuid,uuid,uuid,uuid,integer,text,text,uuid,text)'::regprocedure")
    const beforeTransferMigration=await commandDefinition()
    const shellDefinition=async()=>one("select pg_get_functiondef(oid) definition,proacl::text privileges,prosecdef security_definer from pg_proc where oid='public.workspace_shell_bootstrap(text,uuid)'::regprocedure")
    const beforeShell=await shellDefinition()
    // Supabase may grant service_role function execution by default. The
    // internal assignment reader must explicitly remove that inherited grant.
    await db.exec('alter default privileges in schema public grant execute on functions to service_role')
    await db.exec(await migration('20261005220000_service_assignee_transfer.sql'))
    assert.deepEqual(await commandDefinition(),beforeTransferMigration)
    assert.deepEqual(await shellDefinition(),beforeShell)
    const transferDefinition=(await one("select pg_get_functiondef('public.transfer_service_assignee(uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure) definition")).definition
    assert.ok(transferDefinition.includes('receipt_checked boolean:=false'))
    assert.ok(transferDefinition.indexOf('pg_advisory_xact_lock')<transferDefinition.indexOf('return receipt.result;'))
    assert.ok(transferDefinition.indexOf('return receipt.result;')<transferDefinition.indexOf('receipt_checked:=true;'))
    assert.ok(transferDefinition.indexOf('receipt_checked:=true;')<transferDefinition.indexOf('perform 1 from relationships'))
    pass('complete transfer migration applies with real service command, work ACL, queue ownership, owner triggers and GHL connection function')
    const instance=(await one("select create_service_instance($1,$2,$3,$4,$5,'already_onboarded','setup',$6) id",[w,r,owner,uuid(800),service,staff])).id
    const sharedInstance=(await one("select create_service_instance($1,$2,$3,$4,$5,'already_onboarded','setup',$6) id",[w,r,owner,uuid(801),service,staff])).id
    await db.exec('begin')
    try {
      const changeArgs=[w,instance,owner,uuid(802),1,'maintenance','active',staff,'Original command behavior']
      assert.equal((await one('select change_service_instance($1,$2,$3,$4,$5,$6,$7,$8,$9) version',changeArgs)).version,2)
      assert.equal((await one('select change_service_instance($1,$2,$3,$4,$5,$6,$7,$8,$9) version',changeArgs)).version,2)
      await rejects('select change_service_instance($1,$2,$3,$4,$5,$6,$7,$8,$9)',[...changeArgs.slice(0,8),'Different replay'],/different input/)
    } finally { await db.exec('rollback') }
    await rejects('select change_service_instance($1,$2,$3,$4,$5,$6,$7,$8,$9)',[w,instance,staff,uuid(803),1,'maintenance','active',staff,'No admin authority'],/Service editing access required/)
    await rejects('select change_service_instance($1,$2,$3,$4,$5,$6,$7,$8,$9)',[w,instance,owner,uuid(804),2,'maintenance','active',staff,'Stale version'],/changed; reload/)
    pass('existing service command definition, privileges, update, replay, authorization and version checks remain unchanged')
    for (const n of [810,811,812,813,814]) {
      await q("insert into work_items(id,workspace_id,service_id,title,status,execution_owner_id) values($1,$2,$3,$4,$5,$6)",[uuid(n),w,service,`Task ${n}`,n===812?'done':'todo',n===813?seller:staff])
      await q('insert into work_item_relationships values($1,$2,$3)',[w,r,uuid(n)])
      await q("insert into service_instance_work_items(workspace_id,instance_id,work_item_id) values($1,$2,$3)",[w,instance,uuid(n)])
    }
    await q("insert into service_instance_work_items(workspace_id,instance_id,work_item_id) values($1,$2,$3)",[w,sharedInstance,uuid(811)])
    await q("update work_items set visibility='admins_only',execution_owner_id=$1 where id=$2",[owner,uuid(814)])
    const preview=async(actor=owner,recipient=unrelated)=>(await one('select preview_service_assignee_transfer($1,$2,$3,$4,$5) p',[w,r,instance,actor,recipient])).p
    const save=async(p,workIds=[uuid(810)],request=uuid(820),actor=owner)=>(await one('select transfer_service_assignee($1,$2,$3,$4,$5,$6) result',[w,r,instance,actor,request,{recipientId:p.recipientId,fingerprint:p.fingerprint,workIds,reason:'Fixture handover'}])).result
    await assert.rejects(preview(staff),/Owner or admin/)
    await assert.rejects(preview(owner,seller),/eligible/)
    let p=await preview()
    assert.equal(p.formerName,'Assigned staff')
    assert.equal(p.recipientName,'Recipient staff')
    assert.deepEqual(p.items.filter(x=>x.movable).map(x=>x.id),[uuid(810),uuid(813)])
    await assert.rejects(save(p,[uuid(811)]),/transferable/)
    await assert.rejects(save(p,[uuid(812)]),/transferable/)
    await assert.rejects(save(p,[uuid(814)]),/transferable/)
    await q('update work_items set title=$1 where id=$2',['Changed during preview',uuid(810)])
    await assert.rejects(save(p),/fresh preview/)
    p=await preview()
    const beforeHistory=await q('select * from client_sales');const beforeOnboarding=await q('select * from relationship_onboarding_sessions')
    const transferState=async()=>({
      instance:await one('select * from relationship_service_instances where id=$1',[instance]),
      events:await q('select * from service_instance_stage_events where instance_id=$1 order by version',[instance]),
      work:await q('select * from work_items order by id'),
      assignees:await q('select * from work_item_assignees order by work_item_id,user_id'),
      receipts:await q('select * from service_assignee_transfer_receipts order by request_id'),
    })
    const beforeLateConflict=await transferState()
    // Fault injection validates recovery classification; it does not establish
    // an actual advisory-lock or multi-session PostgreSQL interleaving.
    const requestLock="perform pg_advisory_xact_lock(hashtextextended('service-transfer:'||p_workspace::text||':'||p_request::text,0));"
    assert.ok(transferDefinition.includes(requestLock))
    for (const sqlstate of ['40P01','55P03']) {
      await db.exec(transferDefinition.replace(requestLock,`raise exception 'Injected request serialization conflict' using errcode='${sqlstate}';`))
      try {
        await assert.rejects(save(p),error=>error.code==='BT001' && error.message==='Another attempt may still be finishing. Retry this same transfer.')
        assert.deepEqual(await transferState(),beforeLateConflict)
      } finally { await db.exec(transferDefinition) }
    }
    pass('injected pre-receipt serialization conflicts preserve uncertain same-request recovery')
    await db.exec(`
      create function fixture_late_transfer_conflict() returns trigger language plpgsql as $$
      begin raise exception 'Injected late receipt conflict' using errcode=current_setting('fixture.transfer_conflict'); end$$;
      create trigger fixture_late_transfer_conflict before insert on service_assignee_transfer_receipts for each row execute function fixture_late_transfer_conflict();
    `)
    for (const sqlstate of ['40P01','55P03']) {
      await q("select set_config('fixture.transfer_conflict',$1,false)",[sqlstate])
      await assert.rejects(save(p),error=>error.code==='P0001' && error.message==='Service busy. No transfer was saved. Reload preview.')
      assert.deepEqual(await transferState(),beforeLateConflict)
    }
    await db.exec('drop trigger fixture_late_transfer_conflict on service_assignee_transfer_receipts; drop function fixture_late_transfer_conflict()')
    pass('injected late deadlock and lock-unavailable failures roll back instance, audit, work, collaborators and receipt as a known conflict')
    const result=await save(p)
    assert.deepEqual(await save(p),result)
    await assert.rejects(save(p,[],uuid(820)),/different input/)
    assert.equal((await one('select count(*)::int n from service_assignee_transfer_receipts')).n,1)
    assert.equal((await one('select execution_owner_id from work_items where id=$1',[uuid(810)])).execution_owner_id,unrelated)
    assert.equal((await one('select execution_owner_id from work_items where id=$1',[uuid(811)])).execution_owner_id,staff)
    assert.equal((await one('select execution_owner_id from work_items where id=$1',[uuid(812)])).execution_owner_id,staff)
    assert.equal((await one('select execution_owner_id from work_items where id=$1',[uuid(813)])).execution_owner_id,seller)
    assert.deepEqual(await q('select * from client_sales'),beforeHistory);assert.deepEqual(await q('select * from relationship_onboarding_sessions'),beforeOnboarding)
    assert.equal((await one('select personal_queue_owns($1,$2,$3) ok',[w,uuid(810),unrelated])).ok,true)
    assert.equal((await one('select personal_queue_owns($1,$2,$3) ok',[w,uuid(810),staff])).ok,false)
    pass('admin-only, eligible recipient, exact preview, shared/private/completed preservation, queue handover, audit and response-loss replay')
    for (const [stage,disposition] of [['completed','active'],['setup','cancelled'],['setup','paused']]) {
      await db.exec('begin')
      try {
        await q('select change_service_instance($1,$2,$3,$4,$5,$6,$7,$8,$9)',[w,instance,owner,uuid(825),2,stage,disposition,unrelated,'Later lifecycle change'])
        assert.deepEqual(await save(p),result)
        assert.equal((await one('select count(*)::int n from service_assignee_transfer_receipts')).n,1)
        await assert.rejects(save(p,[uuid(810)],uuid(826)),/active delivery service/)
      } finally { await db.exec('rollback') }
    }
    pass('saved receipt remains recoverable after completion, cancellation or pause without permitting a new transfer')
    await q("insert into work_items(id,workspace_id,service_id,title,status,execution_owner_id) values($1,$2,$3,'Retained explicit work','todo',$4)",[uuid(815),w,service,unrelated])
    await q('insert into work_item_relationships values($1,$2,$3)',[w,r,uuid(815)])
    await q('insert into service_instance_work_items(workspace_id,instance_id,work_item_id) values($1,$2,$3)',[w,instance,uuid(815)])
    const retainedAssignees=await q('select * from work_item_assignees where work_item_id=$1',[uuid(815)])
    await q("update onboarding_service_revisions set definition='{"+'"templateId":"appointment-setting"'+"}' where id=$1",[revision])
    await q("insert into workspace_service_capabilities values($1,$2,'appointment_setting.manage')",[w,service])
    await q('update relationship_service_instances set disposition=$1,version=version+1,change_request_id=$2,change_reason=$3 where id=$4',['cancelled',uuid(830),'Close fixture',sharedInstance])
    assert.equal((await one('select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) ok',[w,r,service,unrelated])).ok,true)
    assert.equal((await one('select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) ok',[w,r,service,staff])).ok,false)
    assert.equal((await one('select service_assignee_can_setup_client($1,$2,$3) ok',[w,unrelated,r])).ok,true)
    assert.equal((await one('select service_assignee_can_setup_client($1,$2,$3) ok',[w,staff,r])).ok,false)
    assert.equal((await one("select manage_client_ghl_connection($1,$2,'list') p",[w,unrelated])).p.length,1)
    assert.equal((await one("select manage_client_ghl_connection($1,$2,'list') p",[w,staff])).p.length,0)
    // Panel eligibility is intentionally broader than client access. Former and
    // otherwise eligible unassigned staff cannot obtain credentials or write.
    for (const deniedActor of [staff,seller]) {
      assert.deepEqual((await one("select manage_client_ghl_connection($1,$2,'list') p",[w,deniedActor])).p,[])
      for (const action of ['begin_connect','begin_refresh','finish','fail']) {
        assert.deepEqual((await one('select manage_client_ghl_connection($1,$2,$3,$4) p',[w,deniedActor,action,r])).p,{failure:'access'})
      }
    }
    pass('broader panel eligibility exposes no client list, credentials or commands to unassigned staff')
    await q('insert into appointment_setting_setup_assignees values($1,$2,$3)',[w,r,unrelated])
    p=await preview(owner,staff);assert.equal(p.formerSetupRetained,true)
    await save(p,[uuid(810)],uuid(831))
    assert.equal((await one('select service_assignee_can_setup_client($1,$2,$3) ok',[w,unrelated,r])).ok,true)
    assert.equal((await one('select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) ok',[w,r,service,staff])).ok,true)
    assert.equal((await one('select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) ok',[w,r,service,unrelated])).ok,false)
    assert.equal((await one('select execution_owner_id from work_items where id=$1',[uuid(815)])).execution_owner_id,unrelated)
    assert.deepEqual(await q('select * from work_item_assignees where work_item_id=$1',[uuid(815)]),retainedAssignees)
    assert.equal((await one('select workspace_user_can_access_work_item($1,$2,$3) ok',[w,uuid(815),unrelated])).ok,false)
    assert.equal((await one('select personal_queue_owns($1,$2,$3) ok',[w,uuid(815),unrelated])).ok,false)
    pass('current service overrides legacy booking owner; setup derives from assignment; independent setup grant survives transfer')
    pass('unselected explicit ownership and collaborators survive without falsely granting former service access')

    // Compare the preview's promised retained access with the real post-transfer
    // grants, rolling each variant back to the same fixture baseline.
    let retentionRequest=850
    const checkRetention=async(setup,expected)=>{
      await db.exec('begin')
      try {
        await setup()
        const candidate=await preview()
        assert.deepEqual([candidate.formerSetupRetained,candidate.formerBookingRetained],expected)
        await save(candidate,[],uuid(retentionRequest++))
        assert.deepEqual([
          (await one('select service_assignee_can_setup_client($1,$2,$3) ok',[w,candidate.formerId,r])).ok,
          (await one('select workspace_user_can_manage_appointment_setting($1,$2,$3,$4) ok',[w,r,service,candidate.formerId])).ok,
        ],expected)
      } finally { await db.exec('rollback') }
    }
    const reviveShared=(stage='setup',disposition='active')=>q('select change_service_instance($1,$2,$3,$4,2,$5,$6,$7,$8)',[w,sharedInstance,owner,uuid(840),stage,disposition,staff,'Independent same-service assignment'])
    await checkRetention(async()=>{},[false,false])
    await checkRetention(reviveShared,[true,true])
    await checkRetention(()=>reviveShared('maintenance'),[true,true])
    await checkRetention(()=>reviveShared('completed'),[false,false])
    await checkRetention(()=>reviveShared('setup','paused'),[false,false])
    await checkRetention(async()=>{
      await reviveShared()
      await q('delete from workspace_member_service_access where workspace_id=$1 and service_id=$2 and user_id=$3',[w,service,staff])
    },[false,false])
    await checkRetention(async()=>{
      await q('delete from workspace_memberships where workspace_id=$1 and user_id=$2',[w,staff])
    },[false,false])
    await checkRetention(async()=>{
      await q("insert into onboarding_service_revisions(id,workspace_id,service_id,revision_number,definition) values($1,$2,$3,2,'{}')",[uuid(841),w,service])
      await q("select create_service_instance($1,$2,$3,$4,$5,'already_onboarded','setup',$6)",[w,r,owner,uuid(842),service,staff])
    },[false,false])
    const otherAppointment=async()=>{
      await q('update onboarding_service_revisions set definition=$1 where id=$2',[{templateId:'appointment-setting'},revisionB])
      await q('insert into workspace_member_service_access values($1,$2,$3)',[w,serviceB,staff])
      await q("select create_service_instance($1,$2,$3,$4,$5,'already_onboarded','setup',$6)",[w,r,owner,uuid(843),serviceB,staff])
    }
    await checkRetention(otherAppointment,[true,false])
    await checkRetention(async()=>{
      await otherAppointment()
      await q('delete from workspace_member_service_access where workspace_id=$1 and service_id=$2 and user_id=$3',[w,serviceB,staff])
    },[false,false])
    await checkRetention(async()=>{
      await q('insert into appointment_setting_setup_assignees values($1,$2,$3)',[w,r,staff])
    },[true,false])
    await checkRetention(async()=>{
      await q('insert into workspace_member_service_access values($1,$2,$3)',[w,service,owner])
      await q('select change_service_instance($1,$2,$3,$4,3,$5,$6,$7,$8)',[w,instance,owner,uuid(844),'setup','active',owner,'Owner role remains independent'])
    },[true,true])
    pass('retained setup and booking preview matches post-transfer grants across roles, eligibility, revision templates and independent assignments')
    assert.equal((await one("select has_function_privilege('service_role','public.current_appointment_service_assignments(uuid,uuid)','execute') allowed")).allowed,false)
    assert.equal((await one("select has_function_privilege('service_role','public.read_assigned_appointment_services(uuid,uuid,uuid)','execute') allowed")).allowed,true)
    await db.exec('set role authenticated')
    await assert.rejects(preview(),/permission denied/)
    await db.exec('reset role')
    await assert.rejects(q("update service_assignee_transfer_receipts set input='{}'"),/immutable/)
    pass('RPC and immutable receipt permission boundaries')
} finally { await db.close() }
