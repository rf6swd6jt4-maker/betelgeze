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
const create = (req, stage = 'setup', origin = 'already_onboarded', actor = owner, assignee = staff) =>
    one('select create_service_instance($1,$2,$3,$4,$5,$6,$7,$8) id', [w, r, actor, req, service, origin, stage, assignee])
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
        create function workspace_user_can_access_relationship(w uuid,r uuid,u uuid) returns boolean language sql stable security definer as $$
            select exists(select 1 from relationships x join workspace_memberships m on m.workspace_id=x.workspace_id and m.user_id=u
                where x.workspace_id=w and x.id=r and (m.role in ('owner','admin') or u in(x.seller_user_id,x.fulfilment_manager_user_id)
                    or exists(select 1 from relationship_services s where s.workspace_id=w and s.relationship_id=r and s.assignee_user_id=u))) $$;
        create function workspace_user_fully_covers_relationship(w uuid,r uuid,u uuid) returns boolean language sql stable security definer as $$
            select exists(select 1 from relationships x join workspace_memberships m on m.workspace_id=x.workspace_id and m.user_id=u
                where x.workspace_id=w and x.id=r and (m.role in ('owner','admin') or u in(x.seller_user_id,x.fulfilment_manager_user_id))) $$;
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
    const legacyTables = ['relationships','relationship_services','client_sales','client_sale_items','relationship_onboarding_sessions','relationship_onboarding_session_modules','work_items','work_item_relationships','work_item_dependencies','assets','fixture_client_chat_members','workspace_memberships']
    const legacy = async () => Object.fromEntries(await Promise.all(legacyTables.map(async t => [t, await q(`select * from ${t}`)])))
    const before = await legacy()
    const dry = (await one('select prepare_service_instance_import($1,$2,$3,false) report', [w,r,owner])).report
    assert.equal(dry.instance_count,1); assert.equal(dry.review_count,0); assert.equal(dry.instances[0].stage,'setup')
    assert.deepEqual(dry.unattributed_work_ids,[uuid(35)])
    assert.equal(JSON.stringify(dry).includes('private-token'),false)
    assert.equal((await one('select count(*)::int n from relationship_service_instances')).n,0)
    await db.exec('begin isolation level repeatable read')
    const imported = (await one('select prepare_service_instance_import($1,$2,$3,true) report',[w,r,owner])).report
    const replay = (await one('select prepare_service_instance_import($1,$2,$3,true) report',[w,r,owner])).report
    assert.equal(replay.import_id,imported.import_id); assert.equal(replay.replayed,true)
    await db.exec('commit')
    assert.deepEqual(await legacy(),before)
    const importedInstance = (await one('select id from relationship_service_instances where import_id=$1',[imported.import_id])).id
    const snapshot = (await one('select commercial_snapshot from service_instance_sale_items where instance_id=$1',[importedInstance])).commercial_snapshot
    assert.equal(snapshot.line.upfront_amount_cents,110000); assert.equal(snapshot.line.recurring_amount_cents,25000)
    assert.equal(snapshot.sale.billing_interval,'month'); assert.equal(snapshot.sale.seller_user_id,seller)
    assert.equal((await one('select count(*)::int n from service_instance_stage_events')).n,1)
    assert.equal((await one('select count(*)::int n from service_instance_work_items')).n,1)
    assert.equal((await one('select count(*)::int n from service_instance_module_requirements')).n,1)
    pass('dry run, replay, exact frozen prices/cadence, work IDs, tokens, assets, memberships and chat preservation')
    await db.exec(`update relationship_services set upfront_price_cents=999 where relationship_id='${r}'`)
    await rejects('select prepare_service_instance_import($1,$2,$3,false)',[w,r,owner],/stale/)
    await db.exec(`update relationship_services set upfront_price_cents=110000 where relationship_id='${r}'`)
    await rejects('update relationship_service_instances set stage=$1 where id=$2',['maintenance',importedInstance],/immutable/)
    await rejects('update service_instance_sale_items set commercial_snapshot=$1 where instance_id=$2',[{},importedInstance],/immutable/)
    await rejects('delete from service_instance_stage_events where instance_id=$1',[importedInstance],/immutable/)
    pass('stale source and immutable prepared imports, commercial snapshots and audit events')

    await db.exec('set role service_role')
    const first = await create(uuid(100)), second = await create(uuid(101),'completed')
    assert.notEqual(first.id,second.id)
    assert.equal((await create(uuid(100))).id,first.id)
    await rejects('select create_service_instance($1,$2,$3,$4,$5,$6,$7,$8)',[w,r,owner,uuid(100),service,'already_onboarded','maintenance',staff],/different input/)
    await assert.rejects(create(uuid(102),'onboarding'),/Existing work starts after onboarding/)
    await assert.rejects(create(uuid(103),'setup','negotiation'),/start in Negotiating/)
    await assert.rejects(create(uuid(104),'setup','already_onboarded',staff),/Owner or admin/)
    await db.exec('reset role')
    await db.exec(`insert into onboarding_service_revisions values('${uuid(109)}','${w}','${service}',2)`)
    assert.equal((await create(uuid(100))).id,first.id)
    assert.equal((await one('select service_revision_id from relationship_service_instances where id=$1',[first.id])).service_revision_id,revision)
    // Restore the fixture catalogue before subsequent independent cases.
    await db.exec(`delete from onboarding_service_revisions where id='${uuid(109)}'; set role service_role`)
    pass('repeat instances, duplicate-create recovery, changed-intent rejection and permitted entry modes')
    const change = (request,version,stage='maintenance',actor=owner,reason='Setup reviewed') =>
        q('select change_service_instance($1,$2,$3,$4,$5,$6,$7,$8,$9) version',[w,first.id,actor,request,version,stage,'active',staff,reason])
    assert.equal((await change(uuid(105),1))[0].version,2)
    assert.equal((await change(uuid(105),1))[0].version,2)
    await assert.rejects(change(uuid(106),1),/changed; reload/)
    await assert.rejects(change(uuid(105),1,'completed'),/different input/)
    await assert.rejects(change(uuid(107),2,'awaiting_payment'),/sale or onboarding transaction/)
    await change(uuid(108),2,'setup',owner,'Reopen requested revisions')
    pass('optimistic versions, lost acknowledgement replay, independent progress and audited reopening')
    await db.exec('reset role')

    // Execute real PostgreSQL RLS with separate identities, including MFA and revocation.
    for (const [user,expected] of [[owner,3],[staff,3],[unrelated,0],[seller,1]]) {
        await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${user}',false)`)
        assert.equal((await one('select count(*)::int n from relationship_service_instances')).n,expected)
        assert.equal((await one('select can_read_service_instance($1,$2) allowed',[other,first.id])).allowed,false)
        await db.exec('reset role')
    }
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${staff}',false); select set_config('fixture.aal2','false',false)`)
    assert.equal((await one('select count(*)::int n from relationship_service_instances')).n,0)
    await db.exec("reset role; select set_config('fixture.aal2','true',false)")
    for (const role of ['anon','authenticated']) {
        assert.equal((await one("select has_function_privilege($1,'prepare_service_instance_import(uuid,uuid,uuid,boolean)','EXECUTE') allowed",[role])).allowed,false)
        assert.equal((await one("select has_table_privilege($1,'relationship_service_instances','INSERT') allowed",[role])).allowed,false)
        assert.equal((await one("select has_table_privilege($1,'service_instance_sale_items','SELECT') allowed",[role])).allowed,false)
    }
    await db.exec(`delete from workspace_memberships where workspace_id='${w}' and user_id='${staff}'; set role authenticated; select set_config('request.jwt.claim.sub','${staff}',false)`)
    assert.equal((await one('select count(*)::int n from relationship_service_instances')).n,0)
    await db.exec(`reset role; insert into workspace_memberships values('${w}','${staff}','staff')`)
    pass('actual RLS: owner, assigned staff, seller, unrelated eligible staff, cross-workspace denial, MFA and revocation')

    await rejects('insert into relationship_service_instances(workspace_id,relationship_id,service_id,service_revision_id,service_key,source_key,origin,stage,change_request_id,change_reason,changed_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[w,r,service,revisionB,'ads','bad-revision','already_onboarded','setup',uuid(150),'test',owner],/revision does not belong/)
    await rejects('select create_service_instance($1,$2,$3,$4,$5,$6,$7,$8)',[w,rOther,owner,uuid(151),service,'already_onboarded','setup',staff],/foreign key/)
    await db.exec(`insert into work_items values('${uuid(152)}','${other}','${service}',null,'todo',null); insert into work_item_relationships values('${other}','${rOther}','${uuid(152)}')`)
    await rejects('insert into service_instance_work_items values($1,$2,$3,null,now())',[w,first.id,uuid(152)],/Work must belong/)
    await rejects('insert into service_instance_sessions(workspace_id,relationship_id,instance_id,session_id) values($1,$2,$3,$4)',[w,r,first.id,session],/Session must belong/)
    pass('database rejection of wrong revision, relationship, workspace, work item and unrelated session')

    const cycle = uuid(160)
    const cycleArgs = [cycle,w,first.id,'maintenance','2026-09','rev-1',{tasks:['review']}]
    await q('insert into service_instance_work_cycles(id,workspace_id,instance_id,phase,cycle_key,template_revision_key,template_snapshot) values($1,$2,$3,$4,$5,$6,$7)',cycleArgs)
    await rejects('insert into service_instance_work_cycles(workspace_id,instance_id,phase,cycle_key,template_revision_key,template_snapshot) values($1,$2,$3,$4,$5,$6)',cycleArgs.slice(1),/unique/)
    await rejects('insert into service_instance_work_items(workspace_id,instance_id,work_item_id,cycle_id) values($1,$2,$3,$4)',[w,second.id,work,cycle],/foreign key/)
    await q('insert into service_instance_work_items(workspace_id,instance_id,work_item_id) values($1,$2,$3),($1,$4,$3)',[w,first.id,uuid(35),second.id])
    pass('cycle idempotency key, exact cycle ownership, and explicit shared work without duplicate work records')

    const source = (await one('select service_instance_import_source($1,$2) source',[w,r])).source
    const candidates = async s => (await one('select service_instance_import_candidates($1) candidates',[s])).candidates
    for (const phase of ['retention','completed_lost']) {
        const result = await candidates({...source,relationship:{...source.relationship,lifecycle_phase:phase}})
        assert.equal(result[0].stage,null); assert.ok(result[0].review_reasons.length)
    }
    const paid = await candidates({...source,relationship:{...source.relationship,lifecycle_phase:'sold'}})
    assert.equal(paid[0].stage,'onboarding')
    const unpaidSource = {...source,relationship:{...source.relationship,lifecycle_phase:'sold'},sales:source.sales.map(s=>({...s,status:'payment_pending',stripe_invoice_status:null}))}
    assert.equal((await candidates(unpaidSource))[0].stage,'awaiting_payment')
    assert.equal((await candidates({...unpaidSource,sales:source.sales.map(s=>({...s,status:'unknown',stripe_invoice_status:null}))}))[0].stage,null)
    const repeated = {...source,sales:[...source.sales,{...source.sales[0],id:uuid(170)}],sale_items:[...source.sale_items,{...source.sale_items[0],id:uuid(171),client_sale_id:uuid(170)}]}
    const repeatedResult = await candidates(repeated)
    assert.equal(repeatedResult.length,2); assert.ok(repeatedResult.every(i=>i.stage===null && i.review_reasons.includes('ambiguous_repeated_service')))
    pass('evidence-based mapping: verified payment, retention/lost ambiguity and distinct repeated purchases')

    // Execute an ambiguous repeated-purchase import, not just its classifier.
    await db.exec(`insert into relationships values('${uuid(180)}','${w}','active','retention','${seller}','${owner}');
        insert into relationship_services select workspace_id,'${uuid(180)}',service_key,service_id,service_revision_id,assignee_user_id,upfront_price_cents,recurring_price_cents,currency from relationship_services where relationship_id='${r}';
        insert into client_sales select '${uuid(181)}',workspace_id,'${uuid(180)}',seller_user_id,status,snapshot_frozen_at,stripe_invoice_status,currency,upfront_total_amount,recurring_total_amount,billing_interval,billing_interval_count from client_sales where id='${sale}';
        insert into client_sales select '${uuid(182)}',workspace_id,'${uuid(180)}',seller_user_id,status,snapshot_frozen_at,stripe_invoice_status,currency,upfront_total_amount,recurring_total_amount,billing_interval,billing_interval_count from client_sales where id='${sale}';
        insert into client_sale_items select '${uuid(183)}',workspace_id,'${uuid(181)}',service_id,service_revision_id,service_code,service_name,upfront_amount_cents,recurring_amount_cents,currency from client_sale_items where id='${line}';
        insert into client_sale_items select '${uuid(184)}',workspace_id,'${uuid(182)}',service_id,service_revision_id,service_code,service_name,upfront_amount_cents,recurring_amount_cents,currency from client_sale_items where id='${line}';
        `)
    await db.exec('begin isolation level repeatable read')
    const ambiguous = (await one('select prepare_service_instance_import($1,$2,$3,true) report',[w,uuid(180),owner])).report
    assert.equal(ambiguous.instance_count,2); assert.equal(ambiguous.review_count,2)
    assert.equal((await one('select count(*)::int n from service_instance_sale_items where relationship_id=$1',[uuid(180)])).n,2)
    await db.exec('commit')
    pass('ambiguous repeated-purchase import preserves both sale lines without guessing current delivery state')
    // Actual shared service-module links and line-scoped immutable responsibility.
    const r2=uuid(200), sale2=uuid(201), itemA=uuid(202), itemB=uuid(203), session2=uuid(204), shared=uuid(205), wrongModule=uuid(206)
    await db.exec(`insert into relationships values('${r2}','${w}','active','potential_client',null,null);
        insert into client_sales values('${sale2}','${w}','${r2}','${seller}','paid',now(),'paid','eur',300,0,null,null);
        insert into client_sale_items values('${itemA}','${w}','${sale2}','${service}','${revision}','ads','Ads',100,0,'EUR'),('${itemB}','${w}','${sale2}','${serviceB}','${revisionB}','website','Website',200,0,'EUR');
        insert into relationship_onboarding_sessions values('${session2}','${w}','${r2}','${sale2}','active','second-private-token');
        insert into relationship_onboarding_session_modules values('${shared}','${w}','${session2}','${uuid(207)}','${uuid(208)}','service','${revision}');
        insert into relationship_onboarding_session_modules values('${wrongModule}','${w}','${session}','${uuid(209)}','${uuid(210)}','service','${revision}');
        insert into onboarding_service_revision_modules values('${w}','${revision}','${uuid(207)}'),('${w}','${revisionB}','${uuid(207)}');`)
    const newA=(await one('select create_service_instance($1,$2,$3,$4,$5,$6,$7,$8) id',[w,r2,owner,uuid(211),service,'negotiation','negotiating',staff])).id
    const newB=(await one('select create_service_instance($1,$2,$3,$4,$5,$6,$7,$8) id',[w,r2,owner,uuid(212),serviceB,'negotiation','negotiating',null])).id
    for(const [id,item] of [[newA,itemA],[newB,itemB]]) {
        await q('insert into service_instance_sale_items(workspace_id,relationship_id,instance_id,sale_item_id,sale_id,commercial_snapshot) values($1,$2,$3,$4,$5,$6)',[w,r2,id,item,sale2,{forged:true}])
        await q("insert into service_instance_sessions(workspace_id,relationship_id,instance_id,session_id,enrollment) values($1,$2,$3,$4,'active')",[w,r2,id,session2])
        await q('insert into service_instance_module_requirements(workspace_id,instance_id,session_id,session_module_id) values($1,$2,$3,$4)',[w,id,session2,shared])
    }
    assert.equal((await one('select count(*)::int n from service_instance_module_requirements where session_module_id=$1',[shared])).n,2)
    assert.equal((await one('select commercial_snapshot from service_instance_sale_items where instance_id=$1',[newA])).commercial_snapshot.forged,undefined)
    await rejects('insert into service_instance_module_requirements(workspace_id,instance_id,session_id,session_module_id) values($1,$2,$3,$4)',[w,newB,session2,wrongModule],/Module must belong/)
    await rejects("update service_instance_sessions set enrollment='active' where instance_id=$1",[importedInstance],/Only a live active session/)
    pass('shared catalogue module links two instances once, unrelated modules fail, and caller cannot forge commercial snapshots')

    // Empty and unversioned legacy relationships stay representable without invented sales.
    const empty=uuid(220), missing=uuid(221)
    await db.exec(`insert into relationships values('${empty}','${w}','active','lead',null,null),('${missing}','${w}','active','retention',null,null);
        insert into relationship_services values('${w}','${missing}','old-seo',null,null,null,0,0,'EUR');`)
    const emptyReport=(await one('select prepare_service_instance_import($1,$2,$3,false) report',[w,empty,owner])).report
    assert.equal(emptyReport.instance_count,0)
    await db.exec('begin isolation level repeatable read')
    const missingReport=(await one('select prepare_service_instance_import($1,$2,$3,true) report',[w,missing,owner])).report
    assert.equal(missingReport.instance_count,1); assert.ok(missingReport.instances[0].review_reasons.includes('missing_catalogue_revision'))
    await db.exec('commit')
    await rejects('select prepare_service_instance_import($1,$2,$3,true)',[w,empty,owner],/REPEATABLE READ/)
    await rejects('select prepare_service_instance_import($1,$2,$3,null)',[w,empty,owner],/Specify dry run/)
    await rejects('select prepare_service_instance_import($1,$2,$3,false)',[w,empty,staff],/owner or admin/)
    await db.exec(`insert into relationship_services select '${w}','${empty}','legacy-'||g,null,null,null,0,0,'EUR' from generate_series(1,501) g`)
    await rejects('select prepare_service_instance_import($1,$2,$3,false)',[w,empty,owner],/exceeds SS-01 rehearsal bounds/)
    pass('empty relationships, missing catalogue evidence, authorization, snapshot isolation and oversized batch rejection')

    // Representative growing candidate set: no browser is involved. Verify index
    // choices for the *new* user/relationship lookup paths with normal planner settings.
    await db.exec(`insert into relationship_service_instances(workspace_id,relationship_id,service_id,service_revision_id,service_key,source_key,origin,stage,assignee_user_id,change_request_id,change_reason,changed_by)
        select '${w}','${r}','${service}','${revision}','ads','growth-'||g,'already_onboarded','setup',case when g%1000=0 then '${staff}'::uuid else null end,gen_random_uuid(),'fixture growth','${owner}' from generate_series(1,5000) g;
        analyze relationship_service_instances;`)
    const explain=await one(`explain (analyze, buffers, format json) select id from relationship_service_instances where workspace_id=$1 and assignee_user_id=$2 and disposition='active' and stage in ('negotiating','awaiting_payment','onboarding','setup','maintenance') order by stage,id limit 50`,[w,staff])
    const plan=explain['QUERY PLAN'][0]
    assert.match(JSON.stringify(plan),/service_instances_active_assignee_idx/)
    assert.ok(plan.Plan['Actual Rows']<=50)
    console.log(JSON.stringify({fixture_instances:5000,lookup_index:'service_instances_active_assignee_idx',rows:plan.Plan['Actual Rows'],execution_ms:plan['Execution Time'],evidence:'single isolated PostgreSQL/WASM observation; not production latency'}))
    pass('growing assigned-instance lookup uses the intended partial index without full-workspace download')

    console.log(`SS-01 PostgreSQL fixture passed ${checks} behavior groups`)
} catch (error) {
    console.error({message:error.message,detail:error.detail,where:error.where,stack:error.stack})
    process.exitCode = 1
} finally { await db.close() }
