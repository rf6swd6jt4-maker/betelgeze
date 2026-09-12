// Actual migration SQL in isolated PostgreSQL/WASM; no credentials or provider calls.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot, loadPGliteExtension } from './pglite-fixture.mjs'

const db = new PGlite({extensions:{pgcrypto:loadPGliteExtension('pgcrypto')}})
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
        create function workspace_user_can_access_session_module(p_workspace_id uuid,p_session_module_id uuid,p_user_id uuid default auth.uid()) returns boolean language sql stable security definer as $$
            select exists(select 1 from relationship_onboarding_session_modules x join relationship_onboarding_sessions s on s.workspace_id=x.workspace_id and s.id=x.session_id where x.workspace_id=p_workspace_id and x.id=p_session_module_id and workspace_user_can_access_relationship(p_workspace_id,s.relationship_id,p_user_id)) $$;
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
        insert into user_profiles values('${staff}','staff','Assigned staff'),('${seller}','seller','Seller');
        create function workspace_user_can_sell(p_workspace_id uuid,p_user_id uuid) returns boolean language sql stable security definer as $$
            select exists(select 1 from workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id and (role in ('owner','admin') or user_id='${seller}')) $$;
        create function workspace_role_for_user(p_workspace_id uuid,p_user_id uuid) returns text language sql stable security definer as $$ select role from workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id $$;
    `)
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260910220000_relationship_background_command_receipts.sql`, 'utf8'))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912130000_relationship_services_ui.sql`, 'utf8'))
    pass('SS-02 applies against the existing background command and SS-01 tables')
    await db.exec(`
        create schema extensions; create extension pgcrypto with schema extensions;
        alter index legacy_one_active_session rename to relationship_onboarding_sessions_one_active;
        alter table relationships add column project_timeframe_days integer;
        create table workspace_operational_roles(workspace_id uuid,user_id uuid,can_manage boolean,can_sell boolean);
        insert into workspace_operational_roles values('${w}','${owner}',true,true),('${w}','${seller}',false,true);
        alter table onboarding_service_revisions add column fulfilment_definition_revision_id uuid;
        alter table client_sales alter column id set default gen_random_uuid();
        alter table client_sale_items alter column id set default gen_random_uuid();
        alter table relationship_onboarding_sessions alter column id set default gen_random_uuid();
        alter table relationship_onboarding_session_modules alter column id set default gen_random_uuid();
        alter table work_items alter column id set default gen_random_uuid();
    `)
    // Load the actual foundational column definitions into this minimal isolated fixture.
    // References to unrelated product areas are omitted; the SS01/03 scope FKs remain real.
    async function columns(file,table) {
        const source=await readFile(`${repositoryRoot}/supabase/migrations/${file}`,'utf8')
        const match=source.match(new RegExp('create table if not exists public\\.'+table+' \\(([\\s\\S]*?)\\n\\);'))
        if(!match)throw new Error(`Missing fixture table ${table}`)
        await db.exec(`create table if not exists ${table}(id uuid primary key default gen_random_uuid())`)
        const existing=new Set((await q(`select column_name from information_schema.columns where table_schema='public' and table_name=$1`,[table])).map(x=>x.column_name))
        for(const line of match[1].split('\n')) {
            const m=line.trim().match(/^([a-z_]+) (uuid|text|integer|boolean|jsonb|timestamptz|date)(.*?)(,?)$/)
            if(!m||existing.has(m[1]))continue
            let rest=m[3].replace(/ references .+?(?= on delete|$)/,'').replace(/ on delete (cascade|restrict|set null)/,'').replace(/not null/g,'').replace(/ unique/,'').replace(/ primary key/,'')
            if(rest.includes('check')&&!rest.includes(')'))rest=rest.slice(0,rest.indexOf('check'))
            // Lifecycle values have since been extended by installed migrations.
            if(m[1]==='lifecycle_phase')rest=" default 'lead'"
            await db.exec(`alter table ${table} add column ${m[1]} ${m[2]} ${rest}`)
        }
    }
    const foundation='20260810100000_custom_onboarding_foundation.sql'
    for(const table of ['onboarding_modules','onboarding_module_revisions','onboarding_configuration_revisions','onboarding_configuration_revision_modules','client_sale_items','client_sale_composition_items','relationship_onboarding_session_modules','relationship_onboarding_session_steps','relationship_onboarding_session_fields'])await columns(foundation,table)
    await columns('20260618000000_stripe_sales_automation.sql','client_sales')
    await columns('20260710143000_canonical_onboarding_sessions.sql','relationship_onboarding_sessions')
    await columns('20260710120000_canonical_work_items_assets.sql','work_items')
    await db.exec(`
        alter table onboarding_modules add constraint modules_workspace_unique unique(workspace_id,id);
        alter table onboarding_module_revisions add constraint module_revision_workspace_unique unique(workspace_id,id);
        alter table relationship_onboarding_session_steps add constraint steps_workspace_unique unique(workspace_id,id);
        alter table client_sales add column created_by uuid,add column configuration_revision_id uuid,add column composition_hash text,add column onboarding_session_id uuid,add column correlation_id uuid,
          add column stripe_checkout_session_id text,add column stripe_checkout_status text,add column stripe_checkout_url text,add column stripe_checkout_expires_at timestamptz,add column sms_recipient_e164 text,add column billing_model text default 'one_off',add column checkout_flow text;
        alter table relationship_onboarding_sessions add column configuration_revision_id uuid,add column welcome_revision_id uuid,add column completion_revision_id uuid,
          add column snapshot_schema_version integer default 1,add column composition_hash text,add column composition_snapshot jsonb default '{}',add column token_version integer default 1,add column token_revoked_at timestamptz;
        create unique index source_sale_unique on relationship_onboarding_sessions(source_sale_id);
        alter table relationship_onboarding_session_steps add column navigation jsonb,add column is_actionable boolean default true;
        alter table work_items add column actual_start_has_time boolean default false,add column actual_completed_has_time boolean default false,
          add column parent_work_item_id uuid,add column workflow_role text default 'task',add column workflow_action text,add column completion_mode text;
        alter table work_item_dependencies add column source text,add constraint fixture_deps_unique unique(work_item_id,depends_on_work_item_id);
        create table work_item_assignees(workspace_id uuid,work_item_id uuid,user_id uuid,primary key(work_item_id,user_id));
        create function record_workspace_admin_activity(p_workspace_id uuid,p_area text,p_event text,p_title text,p_entity_type text default null,p_entity_id text default null,p_actor_kind text default null,p_correlation_id uuid default null,p_idempotency_key text default null,p_metadata jsonb default '{}') returns void language plpgsql as $$ begin end $$;
        create function complete_relationship_onboarding_session(p_workspace_id uuid,p_session_id uuid,p_session_token text,p_correlation_id uuid,p_idempotency_key text) returns jsonb language plpgsql as $$
        declare v_session relationship_onboarding_sessions%rowtype; v_relationship relationships%rowtype;
        begin select * into v_session from relationship_onboarding_sessions where id=p_session_id;
    select * into v_relationship from relationships where id=v_session.relationship_id;
        return jsonb_build_object('legacy',true);end $$;
        create function validate_relationship_delivery_team(uuid,uuid) returns void language sql as $$ select $$;
        create function create_relationship_delivery_team(uuid,uuid) returns void language sql as $$ select $$;
        create function stamp_client_sale_seller() returns trigger language plpgsql as $$ begin return new;end $$;
        create trigger stamp_client_sale_seller before insert or update on client_sales for each row execute function stamp_client_sale_seller();
    `)
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912160000_selected_service_sales.sql`,'utf8'))
    await db.exec('create trigger infer_work_item_service_scope before insert or update of workspace_id,service_id,metadata,native_kind on work_items for each row execute function infer_work_item_service_scope()')
    pass('SS03 full migration applies with PostgreSQL function validation')
    const relationship=(await one('select create_empty_relationship($1,$2,$3,$4) id',[w,seller,uuid(700),{name:'Client',company:'Client Co',email:'client@example.test',phone:'+353850000001',isTest:true}])).id
    const serviceC=uuid(24),revisionC=uuid(25)
    await db.exec(`insert into onboarding_services values('${serviceC}','${w}','appointments','active');
      insert into onboarding_service_revisions(id,workspace_id,service_id,name,definition) values('${revisionC}','${w}','${serviceC}','Appointment setting','{"serviceType":"retainer"}');
      update onboarding_service_revisions set name='Meta Ads',definition='{"serviceType":"retainer"}' where id='${revision}';
      update onboarding_service_revisions set name='Landing page',default_recurring_price_cents=0 where id='${revisionB}';
      insert into workspace_member_service_access values('${w}','${serviceB}','${staff}'),('${w}','${serviceC}','${staff}');`)
    const add=async(s,rev,req)=>(await one('select add_relationship_service($1,$2,$3,$4,$5,$6,$7,$8,$9) id',[w,relationship,seller,req,s,rev,'negotiation','negotiating',staff])).id
    const a=await add(service,revision,uuid(701)),b=await add(serviceB,revisionB,uuid(702)),c=await add(serviceC,revisionC,uuid(703))
    const moduleIds=[uuid(401),uuid(402),uuid(403),uuid(404)]
    for(const [index,id] of moduleIds.entries()) {
      const ids=index===0?[]:index===1?[service,serviceB]:index===2?[service]:[serviceC]
      await q('insert into onboarding_modules(id,workspace_id,internal_code,status) values($1,$2,$3,$4)',[id,w,'module-'+index,'active'])
      await q('insert into onboarding_module_revisions(id,workspace_id,module_id,revision_number,status,definition) values($1,$2,$3,1,$4,$5)',[uuid(410+index),w,id,'published',{name:'Module '+index,mandatory:index===0,serviceIds:ids,sortOrder:index,steps:[{id:uuid(420+index),kind:'form',title:'Step '+index,fields:[]}]}])
    }
    const input={relationshipVersion:(await one('select updated_at::text version from relationships where id=$1',[relationship])).version,managerId:owner,billingInterval:'month',billingIntervalCount:1,lines:[{id:a,version:1,assigneeId:staff,upfrontCents:50000,recurringCents:10000},{id:b,version:1,assigneeId:staff,upfrontCents:30000,recurringCents:0}]}
    const preview=async(i=input,actor=seller)=>(await one('select preview_relationship_service_sale($1,$2,$3,$4) quote',[w,relationship,actor,i])).quote
    const quoted=await preview()
    assert.equal(quoted.lines.length,2);assert.equal(quoted.modules.length,3);assert.equal(quoted.upfrontTotal,80000);assert.equal(quoted.recurringTotal,10000)
    assert.deepEqual(quoted.modules.find(m=>m.module_id===moduleIds[1]).instance_ids.sort(),[a,b].sort())
    assert(!quoted.modules.some(m=>m.module_id===moduleIds[3]));pass('selected prices, exact module composition and shared module deduplication')
    await assert.rejects(preview({...input,lines:[input.lines[0],input.lines[0]]}),/only once/)
    await assert.rejects(preview({...input,lines:[{...input.lines[0],assigneeId:owner}]}),/eligible assignee/)
    await assert.rejects(preview({...input,managerId:staff}),/eligible manager/)
    await assert.rejects(preview(input,staff),/Seller access/)
    await q('update onboarding_service_revisions set currency=$1 where id=$2',['USD',revisionB])
    await assert.rejects(preview(),/one currency/);await q('update onboarding_service_revisions set currency=$1 where id=$2',['EUR',revisionB])
    await assert.rejects(preview({...input,billingIntervalCount:37}),/supported recurring/)
    pass('duplicate selection, permissions, team eligibility, mixed currency and cadence rejection')
    const commit=async(req=uuid(800),i=input,hash=quoted.hash)=>(await one('select commit_relationship_service_sale($1,$2,$3,$4,$5,$6,$7,$8) result',[w,relationship,seller,req,i,hash,'whatsapp:+353850000001',null])).result
    await assert.rejects(commit(uuid(800),input,'bad hash'),/preview changed/)
    assert.equal((await one('select count(*) n from client_sales where relationship_id=$1',[relationship])).n,0)
    const sold=await commit()
    assert.equal((await commit()).saleId,sold.saleId)
    await assert.rejects(commit(uuid(801)),/Relationship details changed|no longer Negotiating/)
    await assert.rejects(commit(uuid(800),{...input,billingIntervalCount:2}),/different/)
    assert.equal((await one('select count(*) n from client_sales where relationship_id=$1',[relationship])).n,1)
    assert.equal((await one('select count(*) n from relationship_onboarding_sessions where relationship_id=$1',[relationship])).n,1)
    assert.equal((await one('select stage from relationship_service_instances where id=$1',[c])).stage,'negotiating')
    assert.equal((await one('select count(*) n from client_sale_items where client_sale_id=$1',[sold.saleId])).n,2)
    assert.equal((await one('select count(*) n from service_instance_module_requirements where session_id=$1',[sold.sessionId])).n,5)
    assert.equal((await one('select stage from relationship_service_instances where id=$1',[a])).stage,'awaiting_payment')
    assert.equal((await one("select count(*) n from service_instance_work_items l join work_items w on w.id=l.work_item_id where w.native_kind='onboarding_step' and w.metadata->>'session_id'=$1",[sold.sessionId])).n,4)
    assert.equal((await one("select completion_mode from work_items where native_key=$1",[sold.sessionId+':service-onboarding'])).completion_mode,'manual')
    pass('atomic subset sale, unsold preservation, shared step work links and concurrent-tab recovery')
    await rejects('update client_sale_items set amount_cents=1 where client_sale_id=$1',[sold.saleId],/immutable/)
    await rejects('update client_sales set service_manager_user_id=$1 where id=$2',[staff,sold.saleId],/immutable/)
    await rejects('delete from client_sale_composition_items where client_sale_id=$1',[sold.saleId],/immutable/)
    await rejects("select complete_selected_service_session($1,$2,(select session_token from relationship_onboarding_sessions where id=$2))",[w,sold.sessionId],/Confirm and pay/)
    const input2={...input,relationshipVersion:(await one('select updated_at::text version from relationships where id=$1',[relationship])).version,lines:[{id:c,version:1,assigneeId:staff,upfrontCents:20000,recurringCents:1000}]}
    const quote2=await preview(input2),sold2=await commit(uuid(802),input2,quote2.hash)
    assert.notEqual(sold.sessionId,sold2.sessionId)
    assert.equal((await one('select count(*) n from relationship_onboarding_sessions where relationship_id=$1 and status=$2',[relationship,'active'])).n,2)
    pass('frozen sale immutability and independent active onboarding sessions for later sales')
    const nativeModule=(await one('select id from relationship_onboarding_session_modules where session_id=$1 order by sort_order limit 1',[sold.sessionId])).id
    for(const [actor,expected] of [[owner,true],[seller,true],[staff,true],[unrelated,false]])assert.equal((await one('select workspace_user_can_access_session_module($1,$2,$3) allowed',[w,nativeModule,actor])).allowed,expected)
    await q('delete from workspace_memberships where workspace_id=$1 and user_id=$2',[w,staff]);assert.equal((await one('select workspace_user_can_access_session_module($1,$2,$3) allowed',[w,nativeModule,staff])).allowed,false);await q('insert into workspace_memberships values($1,$2,$3)',[w,staff,'staff'])
    pass('module access follows purchased assignments and current membership, not service eligibility alone')
    const token=(await one('select session_token from relationship_onboarding_sessions where id=$1',[sold.sessionId])).session_token
    const request={saleId:sold.saleId,workspaceId:w,lineItems:[{amount:80000}],idempotencyKey:'checkout-attempt-1',expiresAt:1789219999}
    const claim=async(payload=request,previous=null)=>(await one('select claim_selected_service_checkout($1,$2,$3,$4,$5) result',[w,sold.saleId,token,previous,payload])).result
    await assert.rejects(claim(),/not available/)
    await q('update client_sales set consent_confirmed_at=now() where id=$1',[sold.saleId])
    assert.deepEqual((await claim()).request,request)
    assert.deepEqual((await claim({...request,idempotencyKey:'different',expiresAt:1789229999})).request,request)
    await q("update client_sales set stripe_checkout_session_id='cs_fixture',stripe_checkout_status='open' where id=$1",[sold.saleId])
    assert.deepEqual((await claim({...request,idempotencyKey:'different'},'cs_fixture')).request,request)
    await q("update client_sales set stripe_checkout_status='expired' where id=$1",[sold.saleId])
    assert.equal((await claim({...request,idempotencyKey:'checkout-attempt-2'},'cs_fixture')).request.idempotencyKey,'checkout-attempt-2')
    await q("update client_sales set service_checkout_requested_at=now()-interval '24 hours' where id=$1",[sold.saleId])
    await assert.rejects(claim(),/needs reconciliation/)
    pass('checkout retry freezes exact provider parameters and requires verified expiration before replacement')
    const legacyPhase=(await one('select lifecycle_phase from relationships where id=$1',[relationship])).lifecycle_phase
    await q("update client_sales set status='paid',consent_confirmed_at=now() where id=$1",[sold.saleId])
    assert.equal((await one('select stage from relationship_service_instances where id=$1',[a])).stage,'onboarding')
    assert.equal((await one('select stage from relationship_service_instances where id=$1',[c])).stage,'awaiting_payment')
    const version=(await one('select version from relationship_service_instances where id=$1',[a])).version
    await q("update client_sales set status='paid' where id=$1",[sold.saleId]);assert.equal((await one('select version from relationship_service_instances where id=$1',[a])).version,version)
    assert.equal((await one('select lifecycle_phase from relationships where id=$1',[relationship])).lifecycle_phase,legacyPhase)
    await rejects("select complete_selected_service_session($1,$2,(select session_token from relationship_onboarding_sessions where id=$2))",[w,sold.sessionId],/Submit every/)
    // Materialize the last step as the canonical runtime does on navigation.
    await q(`insert into work_items(workspace_id,title,status,native_kind,metadata) select $1,title,'done','onboarding_step',jsonb_build_object('session_id',session_id,'session_step_id',id) from relationship_onboarding_session_steps where session_id=$2 and not exists(select 1 from work_items w where w.metadata->>'session_step_id'=relationship_onboarding_session_steps.id::text)`,[w,sold.sessionId])
    await q("update work_items set status='done' where metadata->>'session_id'=$1",[sold.sessionId])
    const finish=async()=>(await one("select complete_relationship_onboarding_session($1,$2,(select session_token from relationship_onboarding_sessions where id=$2),null,null) result",[w,sold.sessionId])).result
    await finish();assert.equal((await finish()).idempotent,true)
    assert.equal((await one('select lifecycle_phase from relationships where id=$1',[relationship])).lifecycle_phase,legacyPhase)
    assert.equal((await one("select count(*) n from work_items where workflow_role='review' and metadata->>'session_id'=$1",[sold.sessionId])).n,3)
    assert.equal((await one("select status from relationship_onboarding_sessions where id=$1",[sold2.sessionId])).status,'active')
    pass('payment advances only its services; completion/review is session-specific and replay-safe')
    const pos=(await one('select read_relationship_service_pos($1,$2,$3,0) result',[w,relationship,seller])).result
    assert.equal(pos.items.length,0);assert.equal(pos.sales.length,2)
    for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'commit_relationship_service_sale(uuid,uuid,uuid,uuid,jsonb,text,text,text)','EXECUTE') allowed",[role])).allowed,false)
    pass('bounded POS read and trusted-server-only sale commands')
    const d=await add(service,revision,uuid(810)),e=await add(service,revision,uuid(811))
    const repeatInput={...input,relationshipVersion:(await one('select updated_at::text version from relationships where id=$1',[relationship])).version,lines:[d,e].map(id=>({id,version:1,assigneeId:staff,upfrontCents:1000,recurringCents:0}))}
    await db.exec(`create function fixture_reject_sale_line() returns trigger language plpgsql as $$ begin if new.upfront_amount_cents=13 then raise exception 'fixture materialization failed';end if;return new;end $$; create trigger fixture_reject_sale_line before insert on client_sale_items for each row execute function fixture_reject_sale_line()`)
    const failingInput={...repeatInput,lines:[repeatInput.lines[0],{...repeatInput.lines[1],upfrontCents:13}]},failingQuote=await preview(failingInput)
    const salesBefore=(await one('select count(*) n from client_sales')).n
    await assert.rejects(commit(uuid(813),failingInput,failingQuote.hash),/fixture materialization failed/)
    assert.equal((await one('select count(*) n from client_sales')).n,salesBefore)
    assert.equal((await one('select stage from relationship_service_instances where id=$1',[d])).stage,'negotiating')
    assert.equal((await one('select count(*) n from service_sale_receipts where request_id=$1',[uuid(813)])).n,0)
    await db.exec('drop trigger fixture_reject_sale_line on client_sale_items;drop function fixture_reject_sale_line()')
    pass('mid-transaction failure rolls back the sale, receipt, lines and instance reservations')
    const repeatQuote=await preview(repeatInput),repeatSale=await commit(uuid(812),repeatInput,repeatQuote.hash)
    assert.equal((await one('select count(*) n from client_sale_items where client_sale_id=$1 and service_id=$2',[repeatSale.saleId,service])).n,2)
    assert.equal((await one('select count(*) n from relationship_onboarding_session_modules where session_id=$1 and module_id=$2',[repeatSale.sessionId,moduleIds[1]])).n,1)
    pass('repeat purchases of one catalogue service retain distinct sale lines and one shared module')
} catch(error) {console.error({message:error.message,code:error.code,where:error.where,position:error.position});process.exitCode=1} finally {await db.close()}
