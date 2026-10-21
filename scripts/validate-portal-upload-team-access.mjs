import assert from 'node:assert/strict'
import {readFile, writeFile, readdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createReferenceFixture} from './validate-communication-references-sql.mjs'
import {id, workspace as w, foreignWorkspace as foreign, users} from './validate-workspace-search-capability.mjs'
import {repositoryRoot} from './pglite-fixture.mjs'

export const migrationPath = 'supabase/migrations/20261021180000_portal_upload_delivery_team_access.sql'
const read = path => readFile(`${repositoryRoot}${path}`, 'utf8')
export async function portalAssetFixture({install = true} = {}) {
    const fixture = await createReferenceFixture()
    const {db, query:q} = fixture
    try {
        await db.exec(`alter table assets add native_kind text, add storage_path text, add content_type text, add file_size bigint;
            grant usage on schema auth to authenticated;
            grant select,insert,update,delete on assets,asset_relationships,asset_work_items to authenticated;
            alter table assets enable row level security;
            alter table asset_relationships enable row level security;
            alter table asset_work_items enable row level security;`)
        const scoped = await read('supabase/migrations/20260902170000_service_scoped_staff_access.sql')
        let member
        for(const file of (await readdir(`${repositoryRoot}supabase/migrations`)).filter(x=>x.endsWith('.sql')).sort()) {
            const found=(await read(`supabase/migrations/${file}`)).match(/create or replace function public\.is_workspace_member\([\s\S]*?\$\$;/)?.[0]
            if(found) member=found
        }
        assert.ok(member)
        await db.exec(member)
        for (const source of [await read('supabase/migrations/20260710120000_canonical_work_items_assets.sql'),scoped]) {
            for(const match of source.matchAll(/create policy[\s\S]*?;/g)) {
                if (/on public\.(assets|asset_relationships|asset_work_items)\s/.test(match[0])) await db.exec(match[0])
            }
        }
        await q("insert into workspaces(id,slug,name) values($1,'synthetic','Synthetic'),($2,'foreign','Foreign')",[w,foreign])
        for(const [key,user] of Object.entries(users)) await q('insert into workspace_memberships values($1,$2,$3)',[w,user,['owner','admin'].includes(key)?key:'staff'])
        await q("insert into workspace_memberships values($1,$2,'staff')",[foreign,users.other])
        await q("insert into relationships(id,workspace_id,primary_person_name,seller_user_id) values($1,$4,'Client A',$5),($2,$4,'Client B',$5),($3,$6,'Foreign',$5)",[id(300),id(301),id(302),w,users.owner,foreign])
        await q("insert into relationship_services(workspace_id,relationship_id,service_id,assignee_user_id) values($1,$2,$3,$4),($1,$2,$5,$6)",[w,id(300),id(400),users.partial,id(401),users.seller])
        await q("insert into workspace_teams(id,workspace_id,relationship_id,kind,name) values($1,$4,$5,'relationship','Team A'),($2,$4,$6,'relationship','Team B'),($3,$7,$8,'relationship','Foreign team')",[id(100),id(101),id(102),w,id(300),id(301),foreign,id(302)])
        for(const user of [users.owner,users.partial,users.ordinary]) await q('insert into workspace_team_members values($1,$2,$3)',[w,id(100),user])
        await q('insert into workspace_team_members values($1,$2,$3),($4,$5,$3)',[w,id(101),users.other,foreign,id(102)])
        await q("insert into workspace_native_conversations(id,workspace_id,team_id,kind) values($1,$2,$3,'team')",[id(200),w,id(100)])
        const add = async(n,{workspace=w,relationship=id(300),native='client_portal_resource',source='upload',metadata={}}={})=>{
            await q('insert into assets(id,workspace_id,title,asset_kind,source_kind,native_kind,storage_path,metadata) values($1,$2,$3,$4,$5,$6,$7,$8)',[id(n),workspace,`Portal ${n}`,'media',source,native,`${workspace}/portal/${n}.jpg`,{source:'client_portal',relationship_id:relationship,portal_session_id:id(600),...metadata}])
            await q('insert into asset_relationships values($1,$2,$3)',[workspace,id(n),relationship])
        }
        await add(500);await add(501,{relationship:id(301)});await add(502,{workspace:foreign,relationship:id(302)})
        await add(503,{native:'manual_upload'});await add(504,{native:'onboarding_upload'});await add(505,{source:'message',native:'client_message_attachment'})
        await add(506,{metadata:{archived_at:'2020-01-01'}})
        await add(507,{native:'client_portal_resource',metadata:{source:'other'}})
        await q("insert into relationship_onboarding_sessions(id,workspace_id,relationship_id,service_scope) values($1,$2,$3,'selected_services')",[id(610),w,id(300)])
        await q('insert into relationship_onboarding_session_modules(id,workspace_id,session_id) values($1,$2,$3)',[id(611),w,id(610)])
        await q('insert into relationship_onboarding_session_steps(id,workspace_id,session_id,session_module_id) values($1,$2,$3,$4)',[id(612),w,id(610),id(611)])
        await add(508,{metadata:{session_id:id(610),session_step_id:id(612)}})
        // Snapshot exact baseline for differential tests and reproducible timings.
        const baseline = (await q("select pg_get_functiondef('public.workspace_user_can_access_asset(uuid,uuid,uuid)'::regprocedure) sql")).rows[0].sql
        await db.exec(baseline.replace('FUNCTION public.workspace_user_can_access_asset(', 'FUNCTION public.portal_asset_baseline('))
        if(install) await db.exec(await read(migrationPath))
        const access = async(user,n,baseline=false)=>(await q(`select public.${baseline?'portal_asset_baseline':'workspace_user_can_access_asset'}($1,$2,$3) ok`,[w,id(n),user])).rows[0].ok
        const actor = async(user,operation,{aal='aal2',role='authenticated'}={})=>{
            await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.aal',$2,false),set_config('request.jwt.claim.role',$3,false)",[user??'',aal,role])
            try {return await fixture.withRole(role,operation)} finally {
                await db.exec("set request.jwt.claim.role='service_role';set request.jwt.claim.sub='';set request.jwt.claim.aal='aal2'")
            }
        }
        return {...fixture,access,actor,add}
    } catch(error){await db.close();throw error}
}

export async function validatePortalAssets() {
    const {db,query:q,access,actor,references,withRole}=await portalAssetFixture()
    let passed=0
    const pass=label=>{passed++;console.log(`PASS ${label}`)}
    const ref=n=>({type:'asset',id:id(n)})
    const rows=async(n=500)=>(await q('select id from assets where workspace_id=$1 and id=$2',[w,id(n)])).rows
    try {
        for(const user of [users.partial,users.ordinary]){
            assert.equal(await access(user,500,true),false)
            assert.equal(await access(user,500),true)
            assert.deepEqual(await actor(user,()=>rows()),[{id:id(500)}])
            const result=await withRole('service_role',()=>references(user,{refs:[ref(500),ref(501),ref(502),ref(503),ref(504),ref(505),ref(506),ref(507),ref(508)]}))
            assert.deepEqual(new Set(result.results.map(x=>x.id)),new Set([id(500),id(506)]))
        }
        pass('failing baseline becomes readable for assigned and manually added team members; existing and archived asset references resolve')
        for(const user of [users.owner,users.admin,users.seller,users.manager,users.partial,users.ordinary,users.other]) for(const n of [501,502,503,504,505,507,508,999]) assert.equal(await access(user,n),user===users.other&&n===501?true:await access(user,n,true),`preserve ${user}/${n}`)
        assert.equal(await access(users.other,500),false,'other client team cannot read this client portal upload')
        pass('other clients, foreign workspaces, manual files, message media, onboarding assets and missing records preserve existing policy results')
        await actor(users.ordinary,async()=>{
            assert.equal((await q('select * from asset_relationships where asset_id=$1',[id(500)])).rows.length,0,'asset read does not grant relationship detail')
            assert.equal((await q("update assets set title='Forbidden' where id=$1 returning id",[id(500)])).rows.length,0)
            assert.equal((await q('delete from assets where id=$1 returning id',[id(500)])).rows.length,0)
            await assert.rejects(q("insert into assets(id,workspace_id,title) values($1,$2,'Forbidden')",[id(999),w]),/row-level security/)
        })
        for(const options of [{aal:'aal1'},{}]) assert.equal((await actor(options.aal?users.ordinary:null,()=>rows(),options)).length,0)
        await q('insert into user_profiles(user_id,mfa_reenrollment_required) values($1,true)',[users.ordinary])
        assert.equal((await actor(users.ordinary,()=>rows())).length,0)
        await q('delete from user_profiles where user_id=$1',[users.ordinary])
        await assert.rejects(actor(null,()=>rows(),{role:'anon'}),/permission denied/)
        pass('real RLS retains MFA, reenrollment, actor, linked-destination and all write restrictions')
        const changes=[
            ['team removal','delete from workspace_team_members where team_id=$1 and user_id=$2',[id(100),users.ordinary]],
            ['workspace offboarding','delete from workspace_memberships where workspace_id=$1 and user_id=$2',[w,users.ordinary]],
            ['archived team','update workspace_teams set archived_at=now() where id=$1',[id(100)]],
            ['custom chat','update workspace_teams set kind=\'custom\' where id=$1',[id(100)]],
            ['archived relationship',"update relationships set status='archived' where id=$1",[id(300)]],
            ['inactive workspace',"update workspaces set status='inactive' where id=$1",[w]],
            ['missing canonical link','delete from asset_relationships where asset_id=$1',[id(500)]],
            ['untrusted provenance',"update assets set metadata=jsonb_set(metadata,'{source}','\"other\"') where id=$1",[id(500)]],
            ['foreign relationship provenance',"update assets set metadata=jsonb_set(metadata,'{relationship_id}',to_jsonb($2::text)) where id=$1",[id(500),id(302)]],
            ['malformed relationship provenance',"update assets set metadata=jsonb_set(metadata,'{relationship_id}','\"invalid\"') where id=$1",[id(500)]],
            ['wrong source kind',"update assets set source_kind='system' where id=$1",[id(500)]],
            ['wrong native kind',"update assets set native_kind='manual_upload' where id=$1",[id(500)]],
        ]
        for(const[label,sql,args]of changes){
            await db.exec('begin');await q(sql,args)
            assert.equal(await access(users.ordinary,500),false,label)
            assert.equal((await actor(users.ordinary,()=>rows())).length,0,label+' RLS')
            const result=await withRole('service_role',()=>references(users.ordinary,{refs:[ref(500)]}))
            assert.ok(result===null||result.results.length===0,label+' references')
            await db.exec('rollback')
            assert.equal(await access(users.ordinary,500),true,label+' restored fixture')
        }
        pass('membership, archive/status, provenance and canonical-link changes revoke both fresh RLS reads and reference resolution')
        await db.exec('begin')
        await q('delete from workspace_team_members where team_id=$1',[id(100)])
        for(const user of [users.owner,users.admin]) assert.equal(await access(user,500),true)
        await q('update relationships set seller_user_id=$1 where id=$2',[users.seller,id(300)])
        assert.equal(await access(users.seller,500),true,'independent seller access survives team removal')
        await db.exec('rollback')
        pass('removing the team grant preserves independent owner, admin and seller access')

 for(const value of ['invalid','',null]){
  await db.exec('begin')
  await q("update assets set metadata=metadata||jsonb_build_object('session_id',$1::text) where id=$2",[value,id(500)])
  assert.equal(await access(users.ordinary,500),true)
  await db.exec('rollback')
 }
 await db.exec('begin')
 await q('update relationships set seller_user_id=$1 where id=$2',[users.seller,id(300)])
 assert.equal(await access(users.seller,503,true),true);assert.equal(await access(users.seller,503),true)
 await db.exec('rollback')
 await db.exec('begin')
 await q('insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,assignee_user_id) values($1,$2,$3,$4,$5)',[id(800),w,id(300),id(400),users.partial])
 await q('insert into service_instance_module_requirements values($1,$2,$3,$4,true)',[w,id(800),id(610),id(611)])
 assert.equal(await access(users.partial,508,true),true);assert.equal(await access(users.partial,508),true)
 assert.equal(await access(users.ordinary,508),false)
 await db.exec('rollback')
 await db.exec('begin')
 await q('insert into workspace_member_service_access values($1,$2,$3)',[w,users.optional,id(400)])
 await q("insert into work_items(id,workspace_id,title,service_id,visibility) values($1,$2,'Linked task',$3,'workspace')",[id(900),w,id(400)])
 await q('insert into work_item_relationships(workspace_id,work_item_id,relationship_id) values($1,$2,$3)',[w,id(900),id(300)])
 await q('insert into asset_work_items values($1,$2,$3)',[w,id(503),id(900)])
 assert.equal(await access(users.partial,503,true),true);assert.equal(await access(users.partial,503),true)
 await db.exec('rollback')
        pass('malformed optional metadata and independent seller, selected-service module and linked-work grants remain correct')
        await assert.rejects(db.exec(await read(migrationPath)),/Asset access owner changed/)
        await db.exec('rollback')
        pass('guarded installer rejects changed or already-replaced owners')
        console.log(`Portal upload team access: ${passed} groups passed`)
        return {passed}
    } finally {await db.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const result=await validatePortalAssets()
    if(process.env.BE_PORTAL_ACCESS_EVIDENCE) await writeFile(process.env.BE_PORTAL_ACCESS_EVIDENCE,JSON.stringify(result,null,2)+'\n')
}
