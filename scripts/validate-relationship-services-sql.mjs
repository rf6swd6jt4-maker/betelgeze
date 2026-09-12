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
        insert into user_profiles values('${staff}','staff','Assigned staff'),('${seller}','seller','Seller');
        create function workspace_user_can_sell(p_workspace_id uuid,p_user_id uuid) returns boolean language sql stable security definer as $$
            select exists(select 1 from workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id and (role in ('owner','admin') or user_id='${seller}')) $$;
        create function workspace_role_for_user(p_workspace_id uuid,p_user_id uuid) returns text language sql stable security definer as $$ select role from workspace_memberships where workspace_id=p_workspace_id and user_id=p_user_id $$;
    `)
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260910220000_relationship_background_command_receipts.sql`, 'utf8'))
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912130000_relationship_services_ui.sql`, 'utf8'))
    pass('SS-02 applies against the existing background command and SS-01 tables')
    const details = { name: 'Andy', company: 'Andy Co', email: '', phone: '', isTest: true }
    const empty = async (actor=seller, req=uuid(700), input=details) => (await one('select create_empty_relationship($1,$2,$3,$4) id',[w,actor,req,input])).id
    const relationship = await empty()
    assert.equal(await empty(), relationship)
    await rejects('select create_empty_relationship($1,$2,$3,$4)',[w,seller,uuid(700),{...details,name:'Changed'}],/different details/)
    await rejects('select create_empty_relationship($1,$2,$3,$4)',[w,staff,uuid(701),details],/Seller access/)
    await rejects('select create_empty_relationship($1,$2,$3,$4)',[other,seller,uuid(701),details],/Seller access/)
    assert.equal((await one('select count(*) n from client_sales where relationship_id=$1',[relationship])).n,0)
    assert.equal((await one('select count(*) n from relationship_onboarding_sessions where relationship_id=$1',[relationship])).n,0)
    assert.equal((await one('select count(*) n from work_item_relationships where relationship_id=$1',[relationship])).n,0)
    pass('empty creation, duplicate receipt recovery, changed intent, seller authorization and no sale/onboarding/work side effects')
    const add = async (req, stage, origin, actor=owner, serviceId=service, assignee=staff) => (await one('select create_service_instance($1,$2,$3,$4,$5,$6,$7,$8) id',[w,relationship,actor,req,serviceId,origin,stage,assignee])).id
    const negotiating = await add(uuid(702),'negotiating','negotiation',seller)
    assert.equal(await add(uuid(702),'negotiating','negotiation',seller),negotiating)
    const pinnedArgs=[w,relationship,seller,uuid(711),service,revision,'negotiation','negotiating',staff]
    const pinned=(await one('select add_relationship_service($1,$2,$3,$4,$5,$6,$7,$8,$9) id',pinnedArgs)).id
    await q('insert into onboarding_service_revisions(id,workspace_id,service_id,revision_number) values($1,$2,$3,2)',[uuid(712),w,service])
    assert.equal((await one('select add_relationship_service($1,$2,$3,$4,$5,$6,$7,$8,$9) id',pinnedArgs)).id,pinned)
    await rejects('select add_relationship_service($1,$2,$3,$4,$5,$6,$7,$8,$9)',[w,relationship,seller,uuid(713),service,revision,'negotiation','negotiating',staff],/updated/)
    await q('select change_service_instance($1,$2,$3,$4,1,$5,$6,$7,$8)',[w,pinned,seller,uuid(714),'declined','cancelled',staff,'Fixture completed'])
    pass('reviewed revision pinned and lost acknowledgement recovered after catalogue publication')
    const setup = await add(uuid(703),'setup','already_onboarded')
    await add(uuid(704),'completed','already_onboarded',owner,serviceB,null)
    const read = async (actor=owner, offset=0) => (await one('select read_relationship_services($1,$2,$3,$4) result',[w,relationship,actor,offset])).result
    assert.deepEqual((await read()).items.map(x=>x.stage).sort(),['completed','negotiating','setup'])
    assert.deepEqual((await read(staff)).items.map(x=>x.id).sort(),[negotiating,setup].sort())
    assert.equal((await read(seller)).items.length,3)
    await rejects('select create_service_instance($1,$2,$3,$4,$5,$6,$7,$8)',[w,relationship,seller,uuid(705),service,'already_onboarded','setup',staff],/access required/)
    await rejects('select create_service_instance($1,$2,$3,$4,$5,$6,$7,$8)',[w,relationship,owner,uuid(706),service,'already_onboarded','onboarding',staff],/starts after onboarding/)
    await rejects('select read_relationship_services($1,$2,$3,0)',[w,relationship,unrelated],/access required/)
    await rejects('select read_relationship_services($1,$2,$3,0)',[other,relationship,owner],/access required/)
    const summary=(await one('select summarize_relationship_services($1,$2,$3) result',[w,owner,[relationship]])).result[0]
    assert.equal(summary.count,3);assert.deepEqual(summary.stages.sort(),['completed','negotiating','setup'])
    assert.equal((await read()).values.find(x=>x.kind==='catalogue_estimate').upfront_cents,10000)
    pass('three persistent independent instances, existing-client entry, eligible assignment and scoped service summaries')
    await q('select change_service_instance($1,$2,$3,$4,1,$5,$6,$7,$8)',[w,negotiating,seller,uuid(707),'for_later','active',staff,'Discuss later'])
    assert.equal((await read()).values.filter(x=>x.kind==='catalogue_estimate').length,0)
    assert.equal((await read()).items.find(x=>x.id===setup).stage,'setup')
    await rejects('select change_service_instance($1,$2,$3,$4,1,$5,$6,$7,$8)',[w,negotiating,seller,uuid(708),'declined','active',staff,'Stale change'],/changed; reload/)
    const choices = (await one('select relationship_service_assignees($1,$2,$3,$4) result',[w,relationship,service,owner])).result
    assert.deepEqual(choices.map(x=>x.id),[staff])
    const catalogue = (await one('select relationship_service_catalogue($1,$2,$3,0) result',[w,seller,'Ads'])).result
    assert.equal(catalogue.length,2)
    await q('update onboarding_services set state=$1 where id=$2',['retired',serviceB])
    assert.equal((await one('select relationship_service_catalogue($1,$2,$3,0) result',[w,seller,'Ads'])).result.length,1)
    pass('deferred value excluded, stale updates rejected, other instance untouched, eligible people and published catalogue')
    const history=(await one('select relationship_service_activity($1,$2,$3,$4,0) result',[w,r,owner,'history'])).result
    assert.equal(history.items.length,2)
    const workList=(await one('select relationship_service_activity($1,$2,$3,$4,0) result',[w,r,owner,'work'])).result
    assert.equal(workList.items.length,2)
    await rejects('select relationship_service_activity($1,$2,$3,$4,0)',[w,relationship,staff,'history'],/Commercial history/)
    await db.exec(`grant select,update on relationships to service_role; grant select on workspaces to service_role; set role service_role;`)
    await rejects('select save_relationship_background_command($1,$2,$3,now(),$4,$5,$6)',[w,relationship,staff,uuid(709),'a'.repeat(64),{}],/seller, manager/)
    await db.exec('reset role')
    await db.exec('set role authenticated')
    await rejects('select create_empty_relationship($1,$2,$3,$4)',[w,owner,uuid(710),details],/permission denied/)
    await rejects('select read_relationship_services($1,$2,$3,0)',[w,relationship,owner],/permission denied/)
    await db.exec('reset role')
    pass('work/history filtered, service-only data commands and assigned staff cannot edit unstarted relationship background')
    for(let index=0;index<35;index++) await add(uuid(800+index),'negotiating','negotiation',seller)
    assert.equal((await read()).items.length,31);assert.equal((await read()).hasMore,true)
    assert.equal((await read(owner,30)).items.length,8)
    assert.equal((await one('select summarize_relationship_services($1,$2,$3) result',[w,owner,[relationship]])).result[0].services.length,4)
    pass('bounded service pages and first-four summary labels with repeated purchases preserved')
    await db.exec(`
        alter table work_items add column lifecycle_phase text default 'fulfilment',add column workflow_role text default 'task',add column workflow_action text,
            add column parent_work_item_id uuid,add column planned_start_date date,add column planned_start_time time,add column due_date date,add column due_time time,
            add column actual_start_at timestamptz,add column actual_start_has_time boolean default false,add column actual_completed_has_time boolean default false,
            add column sort_order integer default 0,add column created_at timestamptz default now(),add column priority integer default 3;
        alter table work_item_dependencies add column source text default 'manual';
        create table work_item_assignees(workspace_id uuid,work_item_id uuid,user_id uuid);
        create index fixture_work_dependencies_idx on work_item_dependencies(workspace_id,work_item_id);
        create index fixture_work_assignees_idx on work_item_assignees(workspace_id,work_item_id);
    `)
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260912150000_relationship_service_timeline.sql`,'utf8'))
    const timeline=async(actor=owner,offset=0)=>(await one('select read_relationship_service_plan($1,$2,$3,$4) result',[w,relationship,actor,offset])).result
    const chart=await timeline()
    assert.equal(chart.services.length,31)
    assert.equal(new Set(chart.services.map(s=>s.id)).size,31)
    assert.equal(chart.events.filter(e=>e.instance_id===setup).length,1)
    assert.equal(chart.work.length,0)
    assert.equal((await timeline(owner,30)).services.length,8)
    await rejects('select read_relationship_service_plan($1,$2,$3,0)',[other,relationship,owner],/access required/)
    pass('timeline reads distinct service instances and actual audit visits in bounded pages; cross-workspace read denied')
    await q('insert into work_item_relationships values($1,$2,$3)',[w,relationship,work])
    await q('insert into work_item_relationships values($1,$2,$3)',[w,relationship,uuid(35)])
    await q('update work_items set title=$2,status=$3 where id=$1',[work,'Ready task','todo'])
    await q('update work_items set title=$2,status=$3 where id=$1',[uuid(35),'Dependent task','todo'])
    const queue=async()=>(await one('select read_relationship_work_queue($1,$2,$3,0) result',[w,relationship,owner])).result
    assert.equal((await queue()).items[0].queue_state,'Ready')
    assert.equal((await queue()).items[1].queue_state,'Blocked')
    await q("update work_items set workflow_action='await_payment' where id=$1",[work])
    assert.equal((await queue()).items[0].queue_state,'Waiting')
    await q("update work_items set status='done' where id=$1",[work])
    assert.equal((await queue()).items.length,1)
    assert.equal((await queue()).items[0].queue_state,'Ready')
    await q("update work_items set planned_start_date=current_date+2 where id=$1",[uuid(35)])
    assert.equal((await queue()).items[0].queue_state,'Scheduled')
    assert.equal((await timeline()).work.length,2)
    assert.equal((await timeline()).work.every(w=>w.shared),true)
    await db.exec('set role authenticated')
    await rejects('select read_relationship_service_plan($1,$2,$3,0)',[w,relationship,owner],/permission denied/)
    await rejects('select read_relationship_work_queue($1,$2,$3,0)',[w,relationship,owner],/permission denied/)
    await db.exec('reset role')
    pass('queue checks dependencies before ordering, preserves waiting and scheduled work, returns shared tasks once and rejects direct client RPC access')
    await q(`insert into work_items(id,workspace_id,title,status)
        select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'Growth task '||n,'todo' from generate_series(1,1200) n`,[w])
    await q(`insert into work_item_relationships(workspace_id,relationship_id,work_item_id)
        select $1,$2,id from work_items where id::text like '10000000-%'`,[w,relationship])
    const grown=await timeline()
    assert.equal(grown.work.length,500)
    assert.equal(grown.workTruncated,true)
    const firstQueue=await queue()
    const secondQueue=(await one('select read_relationship_work_queue($1,$2,$3,30) result',[w,relationship,owner])).result
    assert.equal(firstQueue.items.length,31)
    assert.equal(firstQueue.hasMore,true)
    assert.equal(secondQueue.items.length,31)
    assert.equal(new Set([...firstQueue.items.slice(0,30),...secondQueue.items.slice(0,30)].map(x=>x.id)).size,60)
    pass('1,200 additional work items keep graph payload bounded and queue pages ordered without duplicated rows')
    console.log(`SS-02 PostgreSQL fixture passed ${checks} behavior groups`)
} finally { await db.close() }
