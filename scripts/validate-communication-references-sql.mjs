import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCapabilityFixture, id, workspace, foreignWorkspace, users } from './validate-workspace-search-capability.mjs'
import { repositoryRoot } from './pglite-fixture.mjs'

export const referenceMigration = 'supabase/migrations/20261003120000_communication_record_references.sql'
const read = path => readFile(`${repositoryRoot}${path}`, 'utf8')
export async function createReferenceFixture({ installCandidate = true } = {}) {
    const fixture = await createCapabilityFixture({ installCandidate: false })
    const { db, query } = fixture
    try {
        await db.exec(`
            alter table assets add updated_at timestamptz default now();
            create table asset_relationships(workspace_id uuid,asset_id uuid,relationship_id uuid,primary key(asset_id,relationship_id));
            create table asset_work_items(workspace_id uuid,asset_id uuid,work_item_id uuid,primary key(asset_id,work_item_id));
            create index work_items_active_library_idx on work_items(workspace_id,updated_at desc) where visibility='workspace' and metadata->>'archived_at' is null;
            create index assets_attachment_choices_idx on assets(workspace_id,updated_at desc,id desc) where metadata->>'archived_at' is null;
        `)
        const migrations=[]
        for (const name of (await readdir(`${repositoryRoot}supabase/migrations`)).filter(name=>name.endsWith('.sql')).sort()) migrations.push(await read(`supabase/migrations/${name}`))
        const assetPolicy=migrations.flatMap(sql=>[...sql.matchAll(/create(?: or replace)? function public\.workspace_user_can_access_asset\([\s\S]*?\$\$;/gi)].map(match=>match[0])).at(-1)
        assert.ok(assetPolicy)
        await db.exec(assetPolicy)
        if (installCandidate) await db.exec(await read(referenceMigration))
        const references = async(actor,{term=null,refs=null,conversation=id(200),slug='synthetic'}={}) => (await query('select public.read_communication_references($1,$2,$3,$4,$5) value',[slug,actor,conversation,term,refs===null?null:JSON.stringify(refs)])).rows[0].value
        return {...fixture,references,assetPolicy}
    } catch(error){await db.close();throw error}
}

export async function validateCommunicationReferences() {
    const {db,query,references,withRole,policies,assetPolicy}=await createReferenceFixture()
    let passed=0
    const report=name=>{passed++;console.log(`PASS: ${name}`)}
    const run=(actor,options)=>withRole('service_role',()=>references(actor,options))
    const add=(table,row)=>query(`insert into ${table}(${Object.keys(row).join(',')}) values(${Object.keys(row).map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row))
    const ref=(type,number)=>({type,id:id(number)})
    try {
        await query("insert into workspaces(id,slug,name) values($1,'synthetic','Synthetic'),($2,'foreign','Foreign')",[workspace,foreignWorkspace])
        for(const actor of Object.values(users))await query('insert into workspace_memberships values($1,$2,$3)',[workspace,actor,actor===users.owner?'owner':'staff'])
        await query("insert into workspace_memberships values($1,$2,'owner')",[foreignWorkspace,users.owner])
        await query("insert into workspace_teams(id,workspace_id,kind,name,relationship_id) values($1,$2,'relationship','Team',$3)",[id(100),workspace,id(300)])
        await query('insert into workspace_team_members values($1,$2,$3),($1,$2,$4)',[workspace,id(100),users.owner,users.partial])
        await query("insert into workspace_native_conversations(id,workspace_id,team_id,kind) values($1,$2,$3,'team'),($4,$5,null,'direct')",[id(200),workspace,id(100),id(201),foreignWorkspace])
        await query('insert into workspace_native_conversation_participants values($1,$2,$3)',[foreignWorkspace,id(201),users.owner])
        await add('relationships',{id:id(300),workspace_id:workspace,primary_person_name:'Acme',business_name:'Acme Business',seller_user_id:users.partial})
        await add('relationships',{id:id(301),workspace_id:workspace,primary_person_name:'Acme hidden',seller_user_id:users.other})
        await add('relationships',{id:id(302),workspace_id:foreignWorkspace,primary_person_name:'Acme foreign',seller_user_id:users.owner})
        await add('work_items',{id:id(400),workspace_id:workspace,title:'Acme work'})
        await add('work_items',{id:id(401),workspace_id:workspace,title:'Acme hidden work'})
        await query('insert into work_item_relationships(workspace_id,work_item_id,relationship_id) values($1,$2,$3),($1,$4,$5)',[workspace,id(400),id(300),id(401),id(301)])
        await add('assets',{id:id(500),workspace_id:workspace,title:'Acme file'})
        await add('assets',{id:id(501),workspace_id:workspace,title:'Acme hidden file'})
        await query('insert into asset_relationships values($1,$2,$3),($1,$4,$5)',[workspace,id(500),id(300),id(501),id(301)])
        const search=await run(users.partial,{term:'Acme'})
        assert.deepEqual(new Set(search.results.map(r=>r.id)),new Set([id(300),id(400),id(500)]))
        assert.equal(search.relationshipRoute,'work')
        assert.deepEqual(search.scope,{userId:users.partial,workspaceId:workspace})
        for(const row of search.results)assert.deepEqual(Object.keys(row).sort(),['detail','id','label','type'])
        assert.ok(!JSON.stringify(search).includes('hidden')&&!JSON.stringify(search).includes('foreign'))
        assert.ok((await run(users.owner,{term:'Acme'})).results.length===4)
        assert.equal(await run(users.ordinary,{term:'Acme'}),null,'workspace member outside chat denied')
        assert.equal(await run(users.owner,{term:'Acme',conversation:id(201)}),null,'foreign chat cannot authenticate current workspace')
        for(const role of ['anon','authenticated'])await assert.rejects(withRole(role,()=>references(users.owner,{term:'Acme'})),/permission denied/)
        report('minimal projection; real work/asset/relationship policies; conversation/workspace scope; server-role-only access')

        const batch=await run(users.partial,{refs:[ref('relationship',300),ref('relationship',301),ref('relationship',302),ref('asset',500),ref('asset',501),ref('work_item',400),ref('work_item',401),ref('asset',999),ref('asset',500)]})
        assert.deepEqual(new Set(batch.results.map(r=>r.id)),new Set([id(300),id(400),id(500)]))
        assert.equal(batch.results.length,3)
        assert.ok(!JSON.stringify(batch).includes(id(301)),'denied identity and protected label absent')
        await assert.rejects(run(users.owner,{refs:Array.from({length:41},()=>ref('asset',500))}),/Invalid reference batch/)
        await assert.rejects(run(users.owner,{refs:[{type:'person',id:id(500)}]}),/Invalid reference identity/)
        await assert.rejects(run(users.owner,{refs:[{type:'asset',id:'invalid'}]}),/Invalid reference identity/)
        await assert.rejects(run(users.owner,{term:'x'.repeat(101)}),/too long/)
        assert.deepEqual((await run(users.partial,{refs:[]})).results,[])
        report('batched current-viewer denial, forged/missing IDs, duplicate collapse and input bounds')

        await query("update assets set metadata='{"+'"archived_at":"2020-01-01"'+"}' where id=$1",[id(500)])
        assert.ok(!(await run(users.partial,{term:'Acme'})).results.some(r=>r.id===id(500)))
        assert.equal((await run(users.partial,{refs:[ref('asset',500)]})).results[0].id,id(500),'existing reference retains archived authorized destination')
        await query("update assets set metadata='{}' where id=$1",[id(500)])
        await add('assets',{id:id(502),workspace_id:workspace,title:'İstanbul guide'})
        assert.equal((await run(users.owner,{term:'İs'})).results[0].id,id(502))
        await add('assets',{id:id(503),workspace_id:workspace,title:'%literal_file'})
        assert.equal((await run(users.owner,{term:'%lit'})).results[0].id,id(503),'wildcards are literal')
        await add('assets',{id:id(504),workspace_id:workspace,title:'ΟΔΟΣ'})
        assert.equal((await run(users.owner,{term:'ΟΔΟΣ'})).results[0].id,id(504))
        await add('assets',{id:id(505),workspace_id:workspace,title:'\udbff\udfff last Unicode scalar'})
        assert.equal((await run(users.owner,{term:'\udbff\udfff'})).results[0].id,id(505))
        await add('assets',{id:id(506),workspace_id:workspace,title:'\ud7ff boundary'})
        assert.equal((await run(users.owner,{term:'\ud7ff'})).results[0].id,id(506))
        assert.equal((await run(users.partial,{term:id(400)})).results[0].id,id(400))
        assert.equal((await run(users.partial,{term:''})).results[0].id,id(300),'conversation relationship wins contextual suggestions')
        report('archived resolution versus discovery, Unicode case/prefix edges, literal wildcards, exact IDs and context suggestions')

        // Exact company names rank ahead of newer prefix matches even when the
        // relationship's primary display label is a different person name.
        for(let n=0;n<6;n++)await add('relationships',{
            id:id(310+n),workspace_id:workspace,primary_person_name:`Person ${n}`,
            business_name:n===0?'ExactCompany':`ExactCompany Division ${n}`,
            seller_user_id:users.partial,updated_at:`2020-01-0${n+1}T00:00:00Z`,
        })
        await add('relationships',{
            id:id(316),workspace_id:workspace,primary_person_name:'Hidden person',
            business_name:'ExactCompany',seller_user_id:users.other,updated_at:'2026-01-01T00:00:00Z',
        })
        const exactCompany=await run(users.partial,{term:'exactcompany'})
        assert.equal(exactCompany.results.length,4)
        assert.equal(exactCompany.results[0].id,id(310),'exact authorized company precedes newer company prefixes')
        assert.ok(!exactCompany.results.some(row=>row.id===id(316)),'exact rank cannot disclose a denied company')
        report('exact authorized business-name ranking precedes newer prefix matches without exposing denied records')

        await query('update relationships set seller_user_id=$1 where id=$2',[users.other,id(300)])
        assert.deepEqual((await run(users.partial,{refs:[ref('relationship',300),ref('asset',500),ref('work_item',400)]})).results,[],'access revoked on all three canonical records')
        await query('update relationships set seller_user_id=$1 where id=$2',[users.partial,id(300)])
        await query('delete from workspace_team_members where user_id=$1',[users.partial])
        assert.equal(await run(users.partial,{refs:[ref('asset',500)]}),null,'chat revocation applies immediately')
        await query('insert into workspace_team_members values($1,$2,$3)',[workspace,id(100),users.partial])
        await query('delete from workspace_memberships where workspace_id=$1 and user_id=$2',[workspace,users.partial])
        assert.equal(await run(users.partial,{term:'Acme'}),null,'workspace revocation wins over retained roster')
        await query("insert into workspace_memberships values($1,$2,'staff')",[workspace,users.partial])
        await query("update workspaces set status='inactive' where id=$1",[workspace])
        assert.equal(await run(users.owner,{term:'Acme'}),null)
        await query("update workspaces set status='active' where id=$1",[workspace])
        report('current record, conversation, workspace membership and workspace status revocation')

        // Grow every name index, with denied matches before a readable outlier.
        for(const [table,column,offset]of [['work_items','title',10000],['assets','title',40000],['relationships','primary_person_name',70000]]) {
            await query(`insert into ${table}(id,workspace_id,${column}) select ('00000000-0000-4000-8000-'||lpad(($2+n)::text,12,'0'))::uuid,$1,'Growth '||lpad(n::text,8,'0') from generate_series(1,20000)n`,[workspace,offset])
        }
        await db.exec('analyze work_items; analyze assets; analyze relationships')
        for(const [table,column,index]of [['work_items','title','comms_reference_work_name_idx'],['assets','title','comms_reference_asset_name_idx'],['relationships','primary_person_name','comms_reference_relationship_name_idx']]) {
            const plan=(await query(`explain(analyze,buffers,format json) select id from ${table} where workspace_id=$1 and ${table==='relationships'?"status<>'archived'":"metadata->>'archived_at' is null"} and left(lower(${column} collate pg_catalog."und-x-icu"),240) collate "C">='growth ' and left(lower(${column} collate pg_catalog."und-x-icu"),240) collate "C"<'growth!' order by left(lower(${column} collate pg_catalog."und-x-icu"),240) collate "C",id limit 24`,[workspace])).rows[0]['QUERY PLAN'][0]
            const nodes=[];const walk=node=>{nodes.push(node);for(const child of node.Plans??[])walk(child)};walk(plan.Plan)
            assert.ok(nodes.some(node=>node['Index Name']===index),`${table} prefix range uses intended index`)
            assert.equal(plan.Plan['Actual Rows'],24)
            assert.ok(!nodes.some(node=>node['Node Type']==='Seq Scan'),`${table} has no full table scan`)
            console.log(`PLAN: ${table}, 20,000 rows, ${index}, 24 candidates, ${plan['Execution Time']}ms synthetic PostgreSQL`)
        }
        for (const [table,where,order,index] of [
            ['work_items', "visibility='workspace' and metadata->>'archived_at' is null",'updated_at desc','work_items_active_library_idx'],
            ['assets', "metadata->>'archived_at' is null",'updated_at desc,id desc','assets_attachment_choices_idx'],
            ['relationships', "status<>'archived'",'updated_at desc,id','comms_reference_relationship_recent_idx'],
        ]) {
            const plan=(await query(`explain(analyze,buffers,format json) select id from ${table} where workspace_id=$1 and ${where} order by ${order} limit 12`,[workspace])).rows[0]['QUERY PLAN'][0]
            const serialized=JSON.stringify(plan)
            assert.ok(serialized.includes(index),`${table} recent window uses intended index`)
            assert.ok(!serialized.includes('Seq Scan'),`${table} recent window has no full scan`)
            assert.equal(plan.Plan['Actual Rows'],12)
            console.log(`PLAN: ${table} empty suggestions, ${index}, 12 candidates, ${plan['Execution Time']}ms synthetic PostgreSQL`)
        }
        const measured=[...policies.filter(p=>['workspace_user_can_access_work_item','workspace_user_can_access_relationship'].includes(p.name)),{name:'workspace_user_can_access_asset',sql:assetPolicy}]
        for(const policy of measured) {
            await db.exec(policy.sql.replace(`public.${policy.name}(`,`public.fixture_${policy.name}(`))
            await db.exec(`create sequence fixture_${policy.name}_calls minvalue 0 start 0`)
            const parameter=policy.name==='workspace_user_can_access_work_item'?'p_work_item_id':policy.name==='workspace_user_can_access_asset'?'p_asset_id':'p_relationship_id'
            await db.exec(`create or replace function public.${policy.name}(p_workspace_id uuid,${parameter} uuid,p_user_id uuid default auth.uid()) returns boolean language plpgsql volatile security definer set search_path=public as $$ begin perform nextval('fixture_${policy.name}_calls'); return fixture_${policy.name}(p_workspace_id,${parameter},p_user_id); end $$`)
        }
        const denied=await run(users.partial,{term:'Growth '})
        assert.deepEqual(denied.results,[])
        for(const policy of measured) {
            const counter=(await query(`select last_value,is_called from fixture_${policy.name}_calls`)).rows[0]
            assert.equal(counter.is_called?Number(counter.last_value)+1:0,24,`${policy.name} authorization bounded before denied results`)
            await db.exec(policy.sql.replace('create function','create or replace function'))
        }
        // Exercise enough repeated requests to exceed PostgreSQL's generic-plan
        // selection threshold; function forces parameter-specific prefix plans.
        for(let n=0;n<8;n++)assert.equal((await run(users.owner,{term:'Growth 0001'})).results.length,4)
        assert.ok((await query("select proconfig from pg_proc where oid='public.read_communication_references(text,uuid,uuid,text,jsonb)'::regprocedure")).rows[0].proconfig.includes('plan_cache_mode=force_custom_plan'))
        assert.equal((await run(users.owner,{term:id(29999)})).results[0].id,id(29999),'exact ID bypasses bounded prefix window')
        report('20k rows per kind: actual indexed candidate bounds, denied-match policy bounds, generic-plan safety and exact ID fallback')
        console.log(`PASS: ${passed} communication-reference SQL groups; real canonical policies, isolated synthetic data, no production calls`)
    } finally {await db.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await validateCommunicationReferences()
