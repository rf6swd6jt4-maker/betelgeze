import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'

// Real PostgreSQL execution, isolated synthetic rows. No production credentials.
const measure = process.argv.includes('--measure')
const baselineRowCap=Number(process.env.SEARCH_BASELINE_ROW_CAP??1000)
assert.ok(Number.isInteger(baselineRowCap)&&baselineRowCap>=0)
const revisionCount=Number(process.env.SEARCH_RETRIEVAL_REVISIONS??3)
assert.ok(Number.isInteger(revisionCount)&&revisionCount>=3&&revisionCount<=30)
const db = new PGlite()
const query = (sql, values = []) => db.query(sql, values)
const read = (path) => readFile(`${repositoryRoot}${path}`, 'utf8')
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const workspace = id(1), foreignWorkspace = id(2)
const users = { ordinary: id(10), seller: id(11), manager: id(12), optional: id(13), assignee: id(14), owner: id(15), admin: id(16), other: id(17), instance: id(18) }
const categories = ['relationships', 'work_items', 'okrs', 'key_results', 'admin_activity', 'modules', 'services', 'clients', 'assets', 'notes', 'channels', 'activities']
const privateCategories = ['okrs', 'key_results', 'admin_activity', 'modules', 'services', 'clients', 'assets', 'notes', 'activities']

const projections={
    relationships:['id','primary_person_name','business_name','primary_email','primary_phone'],
    work_items:['id','title','description','kind','visibility'],
    okrs:['id','objective','objective_type','description','status','period_end'],
    key_results:['id','name','description'],admin_activity:['id','summary','category','level'],
    modules:['id','name','description','status'],services:['id','name','description','state'],
    clients:['id','name','email','phone','relationship_id'],assets:['id','title'],notes:['id','name','description'],
    channels:['relationship_id','external_address','provider'],activities:['id','relationship_id','activity_text','activity_type'],
}
function assertProjections(value){
    for(const [category,fields] of Object.entries(projections))for(const row of value[category])assert.deepEqual(Object.keys(row).sort(),[...fields].sort(),`${category} minimal projection`)
}

const search = async (user, term = 'sentinel', slug = 'synthetic') => (await query('select public.search_workspace_records($1,$2,$3) as value', [slug, user, term])).rows[0].value
const ids = (rows) => rows.map((row) => row.id)
let passed = 0
const report = (name) => { passed += 1; console.log(`PASS: ${name}`) }
const migrationSources = []
for (const name of (await readdir(`${repositoryRoot}supabase/migrations`)).filter((name) => name.endsWith('.sql')).sort()) {
    migrationSources.push({ name, source: await read(`supabase/migrations/${name}`) })
}
function lastFunction(name) {
    const pattern = new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'gu')
    const found = migrationSources.flatMap(({ name: source, source: sql }) => [...sql.matchAll(pattern)].map((match) => ({ source, sql: match[0] }))).at(-1)
    assert.ok(found, `effective real ${name} policy`)
    return found
}
const policyNames = ['workspace_role_for_user', 'workspace_user_can_sell', 'workspace_user_has_service', 'workspace_user_can_access_relationship', 'workspace_user_fully_covers_relationship', 'workspace_user_can_access_session_module', 'workspace_user_can_access_session_step', 'workspace_user_can_access_work_item', 'client_conversation_can_access', 'workspace_delivery_access_scope']
const policies = policyNames.map((name) => ({ name, ...lastFunction(name) }))

try {
    await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
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
    `)
    for (const policy of policies) await db.exec(policy.sql)
    // Production metadata confirms no client_id/created_at composite activity index.
    // Its single-client_id index is irrelevant to these workspace/created_at reads;
    // omit that unused index from this conservative, minimal schema fixture.
    const existingIndexes = ['clients_workspace_id_idx', 'client_activity_relationship_id_idx', 'relationships_client_id_unique', 'relationships_workspace_phase_idx', 'relationships_workspace_person_idx', 'relationship_delivery_assignee_idx', 'relationship_delivery_seller_idx', 'relationship_delivery_manager_idx', 'client_communication_channels_workspace_client_provider_unique', 'onboarding_module_revisions_workspace_idx', 'workspace_service_capabilities_workspace_idx', 'workspace_member_service_access_service_idx', 'service_instances_relationship_stage_idx', 'service_instances_active_assignee_idx', 'service_instance_requirements_module_idx', 'service_instance_work_lookup_idx', 'work_items_workspace_service_idx', 'notes_workspace_updated_idx', 'workspace_okrs_workspace_status_idx', 'workspace_okr_key_results_okr_idx', 'workspace_admin_activity_feed_idx']
    for (const name of existingIndexes) {
        const pattern = new RegExp(`create(?: unique)? index(?: if not exists)? ${name}\\s[\\s\\S]*?;`, 'u')
        const sql = migrationSources.map(({ source }) => source.match(pattern)?.[0]).find(Boolean)
        assert.ok(sql, `existing index ${name}`)
        await db.exec(sql)
    }
    // Keep the previous bounded contact owner available solely for comparison.
    await db.exec(await read('supabase/migrations/20260929120000_search_contact_authorization.sql'))
    const candidate = migrationSources.find(({ source }) => /create(?: or replace)? function public\.search_workspace_records\(/u.test(source))
    assert.ok(candidate, 'new retrieval migration exists')
    await db.exec(candidate.source)
    console.log(`Effective policies: ${JSON.stringify(policies.map(({ name, source }) => ({ name, source })))}`)
    await query("insert into workspaces(id,slug,name) values($1,'synthetic','Synthetic'),($2,'foreign','Foreign')", [workspace, foreignWorkspace])
    for (const [name, user] of Object.entries(users)) await query('insert into workspace_memberships values($1,$2,$3)', [workspace,user,['owner','admin'].includes(name)?name:'staff'])
    await query("insert into workspace_memberships values($1,$2,'owner')", [foreignWorkspace,users.other])
    await query('insert into workspace_operational_roles(workspace_id,user_id,can_sell,can_manage) values($1,$2,true,false),($1,$3,false,true)', [workspace,users.seller,users.manager])

    // Add older visible matches after more rows than every former sampling cap.
    for (const [number, owner] of [[100,users.other],[101,users.seller]]) {
        await query('insert into relationships(id,workspace_id,client_id,primary_person_name,seller_user_id,fulfilment_manager_user_id) values($1,$2,$3,$4,$5,$6)', [id(number),workspace,id(number+100),'sentinel relationship',owner,number===101?users.manager:null])
        await query('insert into clients(id,workspace_id,relationship_id,name,email) values($1,$2,$3,$4,$5)', [id(number+100),workspace,id(number),'sentinel client',`sentinel-${number}@example.invalid`])
        await query('insert into client_communication_channels(id,workspace_id,client_id,relationship_id,external_address,provider) values($1,$2,$3,$4,$5,$6)', [id(number+1000),workspace,id(number+100),id(number),'sentinel contact '+number,'meta_whatsapp'])
    }
    await query('insert into relationship_services values($1,$2,$3,$4)', [workspace,id(101),id(300),users.assignee])
    await query('insert into relationship_client_chat_members values($1,$2,$3)', [workspace,id(101),users.optional])
    await query('insert into onboarding_services(id,workspace_id,internal_code) values($1,$2,$3)', [id(300),workspace,'sentinel service'])
    await query("insert into workspace_service_capabilities values($1,$2,'onboarding.manage')", [workspace,id(300)])
    await query('insert into work_items(id,workspace_id,title,service_id) values($1,$2,$3,$4),($5,$2,$3,$4)', [id(400),workspace,'sentinel work',id(300),id(401)])
    await query('insert into work_item_relationships values($1,$2,$3),($1,$4,$5)', [workspace,id(400),id(100),id(401),id(101)])
    for (const role of ['owner', 'admin']) {
        const result = await search(users[role])
        assert.deepEqual(ids(result.relationships).sort(), [id(100),id(101)])
        assert.deepEqual(ids(result.work_items), [id(400),id(401)])
        assert.deepEqual(result.channels, [], 'admin authority is not conversation membership')
    }
    const optional = await search(users.optional)
    assertProjections(optional)
    assert.deepEqual(optional.relationships, [])
    assert.equal(optional.channels.length, 1)
    assert.equal(optional.channels[0].relationship_id, id(101))
    for (const actor of ['seller','manager','assignee']) {
        const result = await search(users[actor])
        assert.deepEqual(ids(result.relationships), [id(101)])
        assert.deepEqual(ids(result.work_items), [id(401)])
        for (const category of privateCategories) assert.deepEqual(result[category], [], `${actor} ${category}`)
        assert.equal(result.channels.length, actor === 'assignee' ? 0 : 1)
    }
    assert.ok(!(await search(users.assignee)).capabilities.includes('onboarding.manage'))
    await query('insert into workspace_member_service_access values($1,$2,$3)', [workspace,users.assignee,id(300)])
    assert.ok((await search(users.assignee)).capabilities.includes('onboarding.manage'))
    await query('delete from workspace_member_service_access where user_id=$1', [users.assignee])
    assert.deepEqual((await search(users.ordinary)).relationships, [])
    report('real row policies preserve staff, seller, manager, private panels, explicit onboarding grants and independent conversation membership')

    await query('insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,assignee_user_id) values($1,$2,$3,$4,$5)', [id(500),workspace,id(101),id(300),users.instance])
    await query('insert into service_instance_work_items(workspace_id,work_item_id,instance_id) values($1,$2,$3)', [workspace,id(401),id(500)])
    assert.deepEqual(ids((await search(users.instance)).work_items), [id(401)])
    await query("update relationship_service_instances set disposition='cancelled' where id=$1", [id(500)])
    assert.deepEqual((await search(users.instance)).work_items, [])
    assert.deepEqual((await search(users.instance)).relationships, [])
    await query("update relationship_service_instances set disposition='active' where id=$1", [id(500)])
    await query('insert into relationship_onboarding_sessions(id,workspace_id,relationship_id) values($1,$2,$3)', [id(510),workspace,id(101)])
    await query("insert into relationship_onboarding_session_modules(id,workspace_id,session_id,source_kind) values($1,$2,$3,'mandatory')", [id(511),workspace,id(510)])
    await query('insert into relationship_onboarding_session_steps values($1,$2,$3,$4)', [id(512),workspace,id(510),id(511)])
    await query('insert into service_instance_module_requirements values($1,$2,$3,$4,true)', [workspace,id(500),id(510),id(511)])
    await query("insert into work_items(id,workspace_id,title,native_kind,native_key,workflow_role,metadata) values($1,$2,'sentinel shared review','relationship_workflow',$3,'review',$4)", [id(402),workspace,`${id(510)}:service-review:${id(512)}`,JSON.stringify({session_id:id(510),session_step_id:id(512)})])
    await query('insert into service_instance_work_items(workspace_id,work_item_id,instance_id) values($1,$2,$3)', [workspace,id(402),id(500)])
    await query('insert into work_item_relationships values($1,$2,$3)', [workspace,id(402),id(101)])
    assert.ok(ids((await search(users.instance)).work_items).includes(id(402)))
    await query('update service_instance_module_requirements set review_required=false where instance_id=$1', [id(500)])
    assert.ok(!ids((await search(users.instance)).work_items).includes(id(402)))
    await query('update service_instance_module_requirements set review_required=true where instance_id=$1', [id(500)])
    await query("update work_items set native_key='wrong-session' where id=$1", [id(402)])
    assert.ok(!ids((await search(users.instance)).work_items).includes(id(402)))
    report('current service-instance grants and exact shared-review session/module links are enforced and revocable')

    await query('update relationships set pos_started_at=null,team_locked_at=null where id=$1', [id(100)])
    assert.ok(ids((await search(users.seller)).relationships).includes(id(100)))
    await query('update relationships set pos_started_at=now(),team_locked_at=now() where id=$1', [id(100)])
    await query('delete from relationship_client_chat_members where user_id=$1', [users.optional])
    assert.deepEqual((await search(users.optional)).channels, [])
    await query('insert into relationship_client_chat_members values($1,$2,$3)', [workspace,id(101),users.optional])
    await query('delete from workspace_memberships where workspace_id=$1 and user_id=$2', [workspace,users.optional])
    assert.equal(await search(users.optional), null)
    await query("insert into workspace_memberships values($1,$2,'staff')", [workspace,users.optional])
    await query('update relationship_services set assignee_user_id=$1 where relationship_id=$2', [users.other,id(101)])
    assert.deepEqual((await search(users.assignee)).relationships, [])
    assert.deepEqual((await search(users.assignee)).work_items, [])
    await query('update relationship_services set assignee_user_id=$1 where relationship_id=$2', [users.assignee,id(101)])
    assert.equal(await search(null),null)
    assert.equal(await search(id(999)),null)
    assert.equal(await search(users.seller,'sentinel','foreign'),null)
    assert.equal(await search(users.owner,'sentinel','missing'),null)
    await query("update workspaces set status='suspended' where id=$1", [workspace])
    assert.equal(await search(users.owner),null)
    await query("update workspaces set status='active' where id=$1", [workspace])
    assert.ok(categories.every((category) => (category in optional)))
    assert.ok(categories.every((category) => Array.isArray(optional[category])))
    const short = await search(users.owner,'x')
    assert.ok(categories.every((category) => short[category].length === 0))
    await assert.rejects(search(users.owner,'x'.repeat(201)), /Search query is too long/u)
    for (const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`)
        await assert.rejects(search(users.owner), /permission denied for function search_workspace_records/u)
        await db.exec('reset role')
    }
    await db.exec('set role service_role')
    assert.equal((await search(users.owner)).role,'owner')
    await db.exec('reset role')
    report('membership/assignment revocation, suspended and foreign workspaces, null actor, query bounds and RPC execution grants fail closed')

    for (const [number,title] of [[600,'literal 50%_\\sample'],[601,'literal 50xxsample'],[602,'mixed CASE sentinel']]) {
        await query('insert into notes(id,workspace_id,name,description) values($1,$2,$3,$4)', [id(number),workspace,title,'description'])
    }
    assert.deepEqual(ids((await search(users.owner,'50%_\\')).notes),[id(600)])
    assert.deepEqual(ids((await search(users.owner,' CASE SeNTINEL ')).notes),[id(602)])
    await query('insert into relationships(id,workspace_id,primary_person_name,business_name) values($1,$2,$3,$4)', [id(603),workspace,'joined', 'field'])
    assert.deepEqual(ids((await search(users.owner,'joined field')).relationships),[id(603)])
    await query('insert into clients(id,workspace_id,name) values($1,$2,$3)', [id(604),workspace,'legacy sentinel'])
    assert.ok(ids((await search(users.owner,'legacy sentinel')).relationships).includes(id(604)))
    assert.deepEqual((await search(users.assignee,'legacy sentinel')).relationships,[])
    report('literal wildcard/backslash, case normalization, readable field joins and admin-only legacy fallback retain matching behavior')

    await query('insert into clients(id,workspace_id,name,email) values($1,$2,$3,$4)',[id(605),workspace,'\t\u00a0','  legacy-whitespace@example.invalid  '])
    assert.equal((await search(users.owner,'legacy-whitespace')).relationships[0].primary_person_name,'legacy-whitespace@example.invalid')
    await query('insert into onboarding_modules(id,workspace_id,internal_code) values($1,$2,$3)',[id(800),workspace,'typed-fallback'])
    await query("insert into onboarding_module_revisions(id,workspace_id,module_id,revision_number,definition,updated_at) values($1,$2,$3,1,$4,now()-interval '1 day'),($5,$2,$3,2,$6,now())",[id(801),workspace,id(800),JSON.stringify({name:'stale-revision'}),id(802),JSON.stringify({name:{secret:'hidden-object'},description:123})])
    assert.deepEqual((await search(users.owner,'stale-revision')).modules,[])
    assert.deepEqual((await search(users.owner,'hidden-object')).modules,[])
    assert.equal((await search(users.owner,'typed-fallback')).modules[0].description,'Reusable onboarding module')
    await query('insert into relationships(id,workspace_id,client_id,primary_person_name,seller_user_id) values($1,$2,$3,$4,$5)',[id(850),foreignWorkspace,id(851),'foreign-sentinel',users.other])
    await query('insert into clients(id,workspace_id,name) values($1,$2,$3)',[id(851),foreignWorkspace,'foreign-sentinel'])
    await query('insert into notes(id,workspace_id,name) values($1,$2,$3)',[id(852),foreignWorkspace,'foreign-sentinel'])
    await query('insert into client_communication_channels(id,workspace_id,client_id,relationship_id,external_address,provider) values($1,$2,$3,$4,$5,$6)',[id(853),workspace,id(851),id(101),'foreign-sentinel','meta_whatsapp'])
    const foreign=await search(users.other,'foreign-sentinel','foreign')
    assert.ok(foreign.relationships.length===1&&foreign.notes.length===1)
    const local=await search(users.owner,'foreign-sentinel')
    assert.ok(categories.every((category)=>local[category].length===0))
    for(const role of ['owner','admin']){
        await query('insert into relationship_client_chat_members values($1,$2,$3)',[workspace,id(101),users[role]])
        assert.equal((await search(users[role],'sentinel')).channels.length,1)
        await query('delete from relationship_client_chat_members where user_id=$1',[users[role]])
        assert.deepEqual((await search(users[role],'sentinel')).channels,[])
    }
    report('minimal typed revisions, Unicode whitespace fallback, independent workspace scope and real administrator conversation grants remain correct')

    const unicode = []
    for (const [offset, value] of ['ŻÓŁĆ','İ','ΟΣ','CAFÉ'].entries()) {
        await query('insert into notes(id,workspace_id,name) values($1,$2,$3)', [id(700+offset),workspace,value])
        const term = value.toLowerCase()
        // The HTTP route normalizes with JavaScript first; a two-codepoint prefix
        // keeps the same minimum length for the dotted-I single glyph.
        const source = term.length < 2 ? `prefix ${value}` : value
        if (term.length < 2) await query('update notes set name=$1 where id=$2',[source,id(700+offset)])
        const normalized = source.toLowerCase()
        const found = ids((await search(users.owner,normalized)).notes).includes(id(700+offset))
        unicode.push({source,query:normalized,found,postgresLower:(await query('select lower($1) value',[source])).rows[0].value})
    }
    assert.ok(unicode.every((item)=>item.found),'SQL normalization preserves JavaScript Unicode lowercase matches')
    console.log(`UNICODE: ${JSON.stringify(unicode)}`)

    // More denied matches than final result caps, all INSIDE the old source
    // windows: applying the final limit before authorization would hide this hit.
    for(let n=90;n<100;n+=1){
        await query('insert into relationships(id,workspace_id,client_id,primary_person_name,seller_user_id) values($1,$2,$3,$4,$5)',[id(n),workspace,id(n+100),'acl-window denied',users.other])
        await query('insert into clients(id,workspace_id,name) values($1,$2,$3)',[id(n+100),workspace,'acl-window denied'])
        await query('insert into client_communication_channels(id,workspace_id,client_id,external_address,provider) values($1,$2,$3,$4,$5)',[id(n+900),workspace,id(n+100),'acl-window denied','meta_whatsapp'])
        await query('insert into work_items(id,workspace_id,title,service_id) values($1,$2,$3,$4)',[id(n+260),workspace,'acl-window denied',id(300)])
        await query('insert into work_item_relationships values($1,$2,$3)',[workspace,id(n+260),id(n)])
    }
    await query("update relationships set primary_person_name='sentinel acl-window allowed',updated_at=now()-interval '1 day' where id=$1",[id(101)])
    await query("update work_items set title='sentinel acl-window allowed',description='common readable work' where id=$1",[id(401)])
    await query("update client_communication_channels set external_address='sentinel acl-window allowed' where id=$1",[id(1101)])
    assert.deepEqual(ids((await search(users.assignee,'acl-window')).relationships),[id(101)])
    assert.deepEqual(ids((await search(users.assignee,'acl-window')).work_items),[id(401)])
    assert.deepEqual((await search(users.optional,'acl-window')).channels.map((row)=>row.relationship_id),[id(101)])
    report('within existing source windows, denied matches never consume the final authorized result cap')

    // Coverage expansion is deliberately deferred: preserve the prior explicit
    // windows and the required verified PostgREST1000 limit on unbounded reads.
    // Rare matches beyond those windows must stay absent in this speed-only pass.
    const growth = []
    const nodes = (plan) => [plan,...(plan.Plans??[]).flatMap(nodes)]
    const explain = async (sql,values=[]) => (await query(`explain(analyze,buffers,format json) ${sql}`,values)).rows[0]['QUERY PLAN'][0]
    const timed = async (sql,values) => {
        const samples=[]
        await query(sql,values)
        for(let n=0;n<5;n+=1) samples.push((await explain(sql,values))['Execution Time'])
        return samples.sort((a,b)=>a-b)[2]
    }
    const baselineQueries = [
        ['relationships','select id,client_id,primary_person_name,primary_email,primary_phone,business_name,website_url,industry_value,location_value,source_label,primary_contact_role,notes_summary,updated_at from relationships where workspace_id=$1 order by updated_at desc'],
        ['clients','select id,relationship_id,name,email,phone,created_at from clients where workspace_id=$1 and archived_at is null order by created_at desc'],
        ['work_items',"select id,title,description,lifecycle_phase,kind,visibility,area from work_items where workspace_id=$1 and visibility='workspace' limit 80"],
        ['private_work',"select id,title,description,lifecycle_phase,kind,visibility,area from work_items where workspace_id=$1 and visibility='admins_only' limit 80"],
        ['okrs','select id,objective,objective_type,description,status,period_end from workspace_okrs where workspace_id=$1 limit 60'],
        ['key_results','select id,name,description,unit,comparator from workspace_okr_key_results where workspace_id=$1 limit 100'],
        ['admin_activity','select id,category,level,event_key,summary,entity_type,entity_id from workspace_admin_activity where workspace_id=$1 order by occurred_at desc limit 100'],
        ['modules','select id,internal_code,status from onboarding_modules where workspace_id=$1 limit 100'],
        ['module_revisions','select module_id,status,definition from onboarding_module_revisions where workspace_id=$1 order by updated_at desc limit 200'],
        ['services','select id,internal_code,state from onboarding_services where workspace_id=$1 limit 100'],
        ['service_revisions','select service_id,name,description from onboarding_service_revisions where workspace_id=$1 order by published_at desc limit 200'],
        ['activities','select id,client_id,activity_text,activity_type from client_activity where workspace_id=$1 order by created_at desc limit 60'],
        ['assets','select id,asset_kind,source_kind,title,description from assets where workspace_id=$1 order by created_at desc limit 80'],
        ['notes','select id,name,description from notes where workspace_id=$1 order by updated_at desc limit 80'],
    ]
    const trimExpression = candidate.source.match(/v_trim constant text := ([^;]+);/u)?.[1]
    assert.ok(trimExpression)
    const statements = candidate.source.split(/v_result := v_result \|\| jsonb_build_object\('[^']+', v_rows\);/u).slice(0,12).map((section)=>{
        const statement=section.match(/(?:with (?:matching|latest|canonical) as materialized|select coalesce\(jsonb_agg)[\s\S]*?;\s*$/u)?.[0]
        assert.ok(statement,'extract exact category statement')
        return statement.replace(/into v_rows(?:, v_client_relationships)?/gu,'').replaceAll('v_workspace_id',`'${workspace}'::uuid`).replaceAll('p_user_id',`'${users.ordinary}'::uuid`).replaceAll('v_query',"'late-needle'").replaceAll('v_private','false').replaceAll('v_trim',trimExpression).replaceAll('v_client_relationships','$1::jsonb')
    })
    assert.equal(statements.length,12,'inspect every actual category statement, not hand-rewritten SQL')
    const policyInstrumentation = policies.filter(({name})=>['workspace_user_can_access_relationship','workspace_user_can_access_work_item','client_conversation_can_access'].includes(name))
    for (const {name,sql} of policyInstrumentation) {
        const original=sql.replace(new RegExp(`public\\.${name}\\(`,'u'),`public.fixture_${name}(`)
        await db.exec(original)
        await db.exec(`create sequence fixture_${name}_calls minvalue 0 start 0;`)
    }
    const installCounters=async()=>{
        for(const {name} of policyInstrumentation) {
            const recordParameter=name==='workspace_user_can_access_work_item'?'p_work_item_id':'p_relationship_id'
            await db.exec(`create or replace function public.${name}(p_workspace_id uuid,${recordParameter} uuid,p_user_id uuid default auth.uid()) returns boolean language plpgsql volatile security definer set search_path=public as $$ begin perform nextval('fixture_${name}_calls'); return fixture_${name}(p_workspace_id,${recordParameter},p_user_id); end $$; alter sequence fixture_${name}_calls restart with 0;`)
        }
    }
    const counters=async()=>Object.fromEntries(await Promise.all(policyInstrumentation.map(async({name})=>[name,Number((await query(`select case when is_called then last_value+1 else 0 end as value from fixture_${name}_calls`)).rows[0].value)])))
    const restorePolicies=async()=>{for(const {sql} of policyInstrumentation)await db.exec(sql.replace('create function','create or replace function'))}
    const sizes=(process.env.SEARCH_RETRIEVAL_SIZES??(measure?'1000,10000':'5001')).split(',').map(Number)
    assert.ok(sizes.every((size)=>Number.isInteger(size)&&size>=1000&&size<=10000))
    for (const total of sizes) {
        const uuid=(prefix,n='n')=>`('${prefix}000000-0000-4000-8000-'||lpad((${n})::text,12,'0'))::uuid`
        const title=`case when n=${total} then 'common late-needle' else 'common filler '||n end`
        const newest=`now()-n*interval '1 second'`
        await db.exec(`
            insert into relationships(id,workspace_id,client_id,primary_person_name,seller_user_id,updated_at)
            select ${uuid('10')},'${workspace}',${uuid('20')},${title},case when n=${total} then '${users.assignee}'::uuid else '${users.other}'::uuid end,${newest} from generate_series(1,${total}) n on conflict do nothing;
            insert into clients(id,workspace_id,relationship_id,name,email,created_at)
            select ${uuid('20')},'${workspace}',${uuid('10')},${title},'synthetic-'||n||'@example.invalid',${newest} from generate_series(1,${total}) n on conflict do nothing;
            insert into work_items(id,workspace_id,title,service_id)
            select ${uuid('30')},'${workspace}',${title},'${id(300)}' from generate_series(1,${total}) n on conflict do nothing;
            insert into work_item_relationships(workspace_id,work_item_id,relationship_id)
            select '${workspace}',${uuid('30')},${uuid('10')} from generate_series(1,${total}) n on conflict do nothing;
            insert into client_communication_channels(id,workspace_id,client_id,relationship_id,external_address,provider)
            select ${uuid('40')},'${workspace}',${uuid('20')},${uuid('10')},${title},'meta_whatsapp' from generate_series(1,${total}) n on conflict do nothing;
            insert into workspace_okrs(id,workspace_id,objective,description,status)
            select ${uuid('50')},'${workspace}',${title},'common description','active' from generate_series(1,${total}) n on conflict do nothing;
            insert into workspace_okr_key_results(id,workspace_id,name,description)
            select ${uuid('51')},'${workspace}',${title},'common description' from generate_series(1,${total}) n on conflict do nothing;
            insert into workspace_admin_activity(id,workspace_id,summary,category,level,event_key,occurred_at)
            select ${uuid('52')},'${workspace}',${title},'system','info','synthetic',${newest} from generate_series(1,${total}) n on conflict do nothing;
            insert into onboarding_modules(id,workspace_id,internal_code)
            select ${uuid('53')},'${workspace}','synthetic-module-'||n from generate_series(1,${total}) n on conflict do nothing;
            insert into onboarding_module_revisions(id,workspace_id,module_id,revision_number,definition,updated_at)
            select ${uuid('54','n*100+r')},'${workspace}',${uuid('53')},r,jsonb_build_object('name',${title},'description','common description','structure',repeat(md5(n::text),768)),${newest}+r*interval '1 millisecond' from generate_series(1,${total}) n cross join generate_series(1,${revisionCount}) r on conflict do nothing;
            insert into onboarding_services(id,workspace_id,internal_code)
            select ${uuid('55')},'${workspace}','synthetic-service-'||n from generate_series(1,${total}) n on conflict do nothing;
            insert into onboarding_service_revisions(id,workspace_id,service_id,revision_number,name,description,definition,published_at)
            select ${uuid('56','n*100+r')},'${workspace}',${uuid('55')},r,${title},'common description',jsonb_build_object('templateId','synthetic','configuration',repeat(md5(n::text),16)),${newest}+r*interval '1 millisecond' from generate_series(1,${total}) n cross join generate_series(1,${revisionCount}) r on conflict do nothing;
            insert into assets(id,workspace_id,title,description,created_at)
            select ${uuid('57')},'${workspace}',${title},'common description',${newest} from generate_series(1,${total}) n on conflict do nothing;
            insert into notes(id,workspace_id,name,description,updated_at)
            select ${uuid('58')},'${workspace}',${title},'common description',${newest} from generate_series(1,${total}) n on conflict do nothing;
            insert into client_activity(id,workspace_id,client_id,activity_text,activity_type,created_at)
            select ${uuid('59')},'${workspace}',${uuid('20')},${title},'synthetic',${newest} from generate_series(1,${total}) n on conflict do nothing;
            analyze;
        `)
        for (const actor of ['owner','admin']) {
            const result=await search(users[actor],'late-needle')
            assertProjections(await search(users[actor],'co'))
            for(const category of categories)assert.deepEqual(result[category],[],`existing ${category} source window stays bounded`)
            for(const category of categories) assert.ok(result[category].length<=({relationships:8,channels:4,activities:4}[category]??6))
            assert.deepEqual(result.channels,[])
        }
        const staff=await search(users.assignee,'late-needle')
        assert.deepEqual(staff.relationships,[])
        assert.deepEqual(staff.work_items,[])
        assert.deepEqual(staff.channels,[])
        for(const category of privateCategories)assert.deepEqual(staff[category],[])
        await query("insert into relationships(id,workspace_id,client_id,primary_person_name,updated_at) values($1,$2,$3,'map-window canonical',now()-interval '1 year'),($4,$2,$5,'map-window archived canonical',now()-interval '1 year') on conflict do nothing",[id(9010),workspace,id(9011),id(9013),id(9012)])
        await query("insert into clients(id,workspace_id,relationship_id,name,created_at,archived_at) values($1,$2,$3,'map-window active',now(),null),($4,$2,$5,'map-window archived',now(),now()) on conflict do nothing",[id(9011),workspace,id(9010),id(9012),id(9013)])
        await query("insert into client_activity(id,workspace_id,client_id,activity_text) values($1,$2,$3,'map-window activity'),($4,$2,$5,'map-window archived activity') on conflict do nothing",[id(9020),workspace,id(9011),id(9021),id(9012)])
        const mapped=await search(users.owner,'map-window')
        assert.deepEqual(ids(mapped.relationships),[id(9011)],'outside-window canonical keeps the existing active-client fallback')
        assert.equal(mapped.clients.find((row)=>row.id===id(9011)).relationship_id,id(9011),'client target uses same bounded map')
        assert.deepEqual(ids(mapped.activities),[id(9020)],'archived client and outside-window canonical cannot create a new activity destination')
        assert.equal(mapped.activities[0].relationship_id,id(9011))
        // Equal timestamps must not let an independently sampled client fall
        // through to an untrusted stored relationship_id outside this workspace.
        await db.exec('begin')
        try{
            await db.exec(`insert into clients(id,workspace_id,relationship_id,name,created_at)
                select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${workspace}','${id(850)}','tie-window-'||n,'2099-01-01'::timestamptz from generate_series(1,1100)n;
                insert into relationships(id,workspace_id,client_id,primary_person_name,updated_at) values
                ('${id(9501)}','${workspace}','91000000-0000-4000-8000-000000000001','tie-window-canonical','2100-01-01'),
                ('${id(9502)}','${workspace}','91000000-0000-4000-8000-000000000002','tie-window-outside','2000-01-01');`)
            const tied=await search(users.owner,'tie-window')
            assert.equal(tied.clients.length,6)
            for(const client of tied.clients)assert.equal(client.relationship_id,client.id==='91000000-0000-4000-8000-000000000001'?id(9501):client.id)
            assert.ok(!JSON.stringify(tied).includes(id(850)),'stored foreign association never leaves the RPC')
        } finally {await db.exec('rollback')}
        if(!measure)continue
        const baseline = {}
        for(const role of ['admin','staff','staff_readable']) {
            let rows=0,bytes=0,cpu=0,jsonCpu=0
            const actor=role==='admin'?users.admin:role==='staff_readable'?users.assignee:users.ordinary
            const preflight=[
                ['workspace',`select id,slug,name,status from workspaces where slug='synthetic' and status='active' and id=$1`],
                ['membership',`select role from workspace_memberships where workspace_id=$1 and user_id='${actor}'`],
                ...(role==='admin'?[
                    ['active_service_ids',`select id from onboarding_services where workspace_id=$1 and state<>'archived'`],
                    ['permission_service_definitions',`select service_id,definition from onboarding_service_revisions where workspace_id=$1 and service_id in(select id from onboarding_services where workspace_id=$1 and state<>'archived' ${baselineRowCap?`limit ${baselineRowCap}`:''})`],
                ]:[
                    ['member_services',`select a.service_id,(select json_agg(c.capability) from workspace_service_capabilities c where c.workspace_id=a.workspace_id and c.service_id=a.service_id) as capabilities from workspace_member_service_access a where a.workspace_id=$1 and a.user_id='${actor}'`],
                    ['operational_roles',`select can_sell,can_manage from workspace_operational_roles where workspace_id=$1 and user_id='${actor}'`],
                    ['allocated_services',`select service_id from relationship_services where workspace_id=$1 and assignee_user_id='${actor}'`],
                    ['connections_assignments',`select relationship_id from appointment_setting_setup_assignees where workspace_id=$1 and user_id='${actor}' limit 1`],
                ]),
            ]
            if(role==='staff_readable')preflight.push(
                ['active_service_ids',`select id from onboarding_services where workspace_id=$1 and state<>'archived'`],
                ['permission_service_definitions',`select service_id,definition from onboarding_service_revisions where workspace_id=$1 and service_id in(select id from onboarding_services where workspace_id=$1 and state<>'archived' ${baselineRowCap?`limit ${baselineRowCap}`:''})`],
            )
            const used=[...preflight,...(role==='admin'?baselineQueries:baselineQueries.slice(0,3))].map(([name,sql])=>[name,baselineRowCap?`select * from (${sql}) baseline_page limit ${baselineRowCap}`:sql])
            const perQuery=[]
            for(const [category,sql] of used){
                const value=(await query(sql,[workspace])).rows
                const medianMs=await timed(sql,[workspace])
                const jsonMedianMs=await timed(`select coalesce(json_agg(row),'[]'::json) from (${sql}) row`,[workspace])
                jsonCpu+=jsonMedianMs
                rows+=value.length;bytes+=Buffer.byteLength(JSON.stringify(value));cpu+=medianMs
                perQuery.push({category,rows:value.length,bytes:Buffer.byteLength(JSON.stringify(value)),medianMs,jsonMedianMs})
            }
            const contactsSql='select * from read_search_contact_channels($1,$2)'
            const contactsValue=(await query(contactsSql,[workspace,actor])).rows
            const contactsCpu=await timed(contactsSql,[workspace,actor])
            rows+=contactsValue.length;bytes+=Buffer.byteLength(JSON.stringify(contactsValue));cpu+=contactsCpu
            jsonCpu+=await timed(`select coalesce(json_agg(row),'[]'::json) from (${contactsSql}) row`,[workspace,actor])
            perQuery.push({category:'contacts',rows:contactsValue.length,bytes:Buffer.byteLength(JSON.stringify(contactsValue)),medianMs:contactsCpu})
            if(role!=='admin'){
                const sql='select workspace_delivery_access_scope($1,$2) as value'
                const value=(await query(sql,[workspace,actor])).rows[0].value
                const medianMs=await timed(sql,[workspace,actor])
                const jsonMedianMs=await timed(`select coalesce(json_agg(row),'[]'::json) from (${sql}) row`,[workspace,actor])
                const scopeRows=Object.values(value).reduce((sum,list)=>sum+list.length,0)
                rows+=scopeRows;bytes+=Buffer.byteLength(JSON.stringify(value));cpu+=medianMs;jsonCpu+=jsonMedianMs
                perQuery.push({category:'delivery_scope',rows:scopeRows,bytes:Buffer.byteLength(JSON.stringify(value)),medianMs,jsonMedianMs})
            }
            baseline[role]={dbCalls:used.length+(role==='admin'?1:2),returnedRows:rows,serializedBytes:bytes,sumMedianDatabaseMs:cpu,sumMedianDatabaseJsonMs:jsonCpu,queries:perQuery}
        }
        const candidateRuns=[]
        const scenarios=[
            ...['late-needle','no-such-query','co','wh','acl-window'].map((term)=>({role:'admin',actor:users.admin,term})),
            ...['late-needle','no-such-query','co','wh'].map((term)=>({role:'staff',actor:users.ordinary,term})),
            ...['acl-window','co'].map((term)=>({role:'staff_readable',actor:users.assignee,term})),
        ]
        for(const {role,actor,term} of scenarios){
            const value=await search(actor,term)
            assertProjections(value)
            if(term==='acl-window'||role==='staff_readable')assert.ok(categories.some((name)=>value[name].length>0),'selective in-window authorized result exists')
            const medianMs=await timed('select search_workspace_records($1,$2,$3) as value',['synthetic',actor,term])
            await installCounters()
            await search(actor,term)
            const calls=await counters()
            await restorePolicies()
            candidateRuns.push({role,term,dbCalls:1,returnedRows:categories.reduce((sum,name)=>sum+value[name].length,0),serializedBytes:Buffer.byteLength(JSON.stringify(value)),medianDatabaseMs:medianMs,policyCalls:calls})
        }
        const mapSql=statements[0].replaceAll('false','true').replace(/else '\{\}'::jsonb end/u,"else '{}'::jsonb end as fixture_client_map")
        const clientMap=(await query(mapSql)).rows[0].fixture_client_map
        assert.ok(clientMap&&typeof clientMap==='object')
        const plans=[]
        for(let i=0;i<statements.length;i+=1){
            const sql=statements[i].replaceAll('false','true')
            const plan=await explain(sql,sql.includes('$1')?[JSON.stringify(clientMap)]:[])
            const all=nodes(plan.Plan)
            plans.push({category:['relationships','work_items','channels','okrs','key_results','admin_activity','modules','services','clients','assets','notes','activities'][i],executionMs:plan['Execution Time'],returnedRows:plan.Plan['Actual Rows'],scans:all.filter((node)=>node['Relation Name']).map((node)=>({relation:node['Relation Name'],type:node['Node Type'],index:node['Index Name']??null,rows:node['Actual Rows'],loops:node['Actual Loops'],removed:node['Rows Removed by Filter']??0})),sorts:all.filter((node)=>node['Node Type']==='Sort').map((node)=>({rows:node['Actual Rows'],loops:node['Actual Loops'],method:node['Sort Method']}))})
        }
        growth.push({recordsPerCategory:total,revisionsPerParent:revisionCount,moduleStructuralStringBytes:24576,baseline,candidate:candidateRuns,plans})
        console.log(`GROWTH: ${JSON.stringify(growth.at(-1))}`)
    }
    report(`existing category source windows remain explicit at ${sizes.join('/')} records; beyond-window matches are deferred`)
    const addedIndexes=[...candidate.source.matchAll(/create(?: unique)? index(?: if not exists)? (\w+)/gu)].map((m)=>m[1])
    const summary={fixtureSha256:createHash('sha256').update(await readFile(new URL(import.meta.url),'utf8')).digest('hex'),migration:candidate.name,migrationSha256:createHash('sha256').update(candidate.source).digest('hex'),revisionCount,baselineRowCap,baselineCapAssumption:'User verified production PostgREST max_rows=1000 on 2026-09-30; default baseline preserves that cap. Set SEARCH_BASELINE_ROW_CAP=0 only for an uncapped diagnostic. JSON RPC scope remains one uncapped object.',engine:(await query('select version() value')).rows[0].value,limits:'Synthetic in-memory PostgreSQL; timings omit network, HTTP, authentication, cold disk, concurrency and full production schema. Baseline sums independent content-query medians, not wall-clock API latency; Baseline includes workspace/membership and loadWorkspaceAccess permission queries (admin active service definitions; ordinary staff has no service grants). Authentication provider cost is excluded from both paths. Module structures are 24KB repetitive compressible strings, not representative documents.',policySources:policies.map(({name,source})=>({name,source})),unicode,newIndexes:addedIndexes,newIndexWriteOverhead:addedIndexes.length===0?'No new indexes, generated columns, triggers or stored rows; no added index maintenance per write.':null,growth}
    if(measure)await writeFile(process.env.SEARCH_RETRIEVAL_REPORT??join(tmpdir(),'workspace-search-retrieval-report.json'),JSON.stringify(summary,null,2)+'\n')
    console.log(`Passed ${passed} SQL retrieval groups`)
} finally { await db.close() }
