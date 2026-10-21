import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {portalAssetFixture} from './validate-portal-upload-team-access.mjs'
import {id,workspace as w,users} from './validate-workspace-search-capability.mjs'
const {db,query:q,add}=await portalAssetFixture()
const quantile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))]
try {
    await q('insert into relationships(id,workspace_id,seller_user_id) values($1,$2,$3)',[id(700),w,users.seller])
    await add(509,{native:'manual_upload',relationship:id(700)})
    await q('insert into relationship_service_instances(id,workspace_id,relationship_id,service_id,assignee_user_id) values($1,$2,$3,$4,$5)',[id(800),w,id(300),id(400),users.partial])
    await q('insert into service_instance_module_requirements values($1,$2,$3,$4,true)',[w,id(800),id(610),id(611)])
    await q("insert into work_items(id,workspace_id,title,service_id,visibility) values($1,$2,'Linked task',$3,'workspace')",[id(900),w,id(400)])
    await q('insert into work_item_relationships(workspace_id,work_item_id,relationship_id) values($1,$2,$3)',[w,id(900),id(300)])
    await q('insert into asset_work_items values($1,$2,$3)',[w,id(503),id(900)])
    await q(`insert into relationships(id,workspace_id,primary_person_name) select ('00000000-0000-4000-8000-'||lpad((10000+n)::text,12,'0'))::uuid,$1,'Unrelated client '||n from generate_series(1,20000)n`,[w])
    await q(`insert into workspace_teams(id,workspace_id,relationship_id,kind,name) select id,workspace_id,id,'relationship',primary_person_name from relationships where id>=$1`,[id(10001)])
    await q(`insert into workspace_team_members(workspace_id,team_id,user_id) select workspace_id,id,$1 from workspace_teams where id>=$2`,[users.other,id(10001)])
    await q(`insert into assets(id,workspace_id,title,native_kind,source_kind,metadata) select r.id,r.workspace_id,'Unrelated portal upload','client_portal_resource','upload',jsonb_build_object('source','client_portal','relationship_id',r.id) from relationships r where r.id>=$1`,[id(10001)])
    await q(`insert into asset_relationships(workspace_id,asset_id,relationship_id) select workspace_id,id,id from assets where id>=$1`,[id(10001)])
    await db.exec('analyze assets;analyze asset_relationships;analyze relationships;analyze workspace_teams;analyze workspace_team_members;analyze workspace_memberships;')
    const cohorts=[['owner',users.owner,500],['team portal',users.ordinary,500],['other team denied',users.other,500],['manual asset denied',users.ordinary,503],['selected service denied',users.ordinary,508],['legacy seller allowed',users.seller,509],['legacy linked work allowed',users.partial,503],['legacy selected module allowed',users.partial,508],['offboarded actor',id(999),500]]
    const results=[]
    for(const [name,user,asset]of cohorts){
        const samples={baseline:[],candidate:[]}
        for(let n=0;n<75;n++)for(const arm of n%2?['candidate','baseline']:['baseline','candidate']){
            const fn=arm==='baseline'?'portal_asset_baseline':'workspace_user_can_access_asset'
            const plan=(await q(`explain(analyze,buffers,format json) select public.${fn}($1,a,$3) from unnest($2::uuid[]) a`,[w,Array(40).fill(id(asset)),user])).rows[0]['QUERY PLAN'][0]
            if(n>=15)samples[arm].push(plan['Execution Time'])
        }
        const summary={cohort:name,checks:40,samples:60,baseline:{median:quantile(samples.baseline,.5),p95:quantile(samples.baseline,.95)},candidate:{median:quantile(samples.candidate,.5),p95:quantile(samples.candidate,.95)}}
        results.push({...summary,raw:samples});console.log(JSON.stringify(summary))
    }
    const sql=`select 1 from assets a join asset_relationships l on l.workspace_id=a.workspace_id and l.asset_id=a.id and l.relationship_id=(a.metadata->>'relationship_id')::uuid join workspace_teams t on t.workspace_id=l.workspace_id and t.relationship_id=l.relationship_id and t.kind='relationship' and t.archived_at is null join workspace_team_members m on m.workspace_id=t.workspace_id and m.team_id=t.id and m.user_id=$3 join relationships r on r.workspace_id=l.workspace_id and r.id=l.relationship_id and r.status<>'archived' join workspaces w on w.id=l.workspace_id and w.status='active' where a.workspace_id=$1 and a.id=$2 and a.native_kind='client_portal_resource' and a.source_kind='upload' and a.metadata->>'source'='client_portal'`
    const plan=(await q('explain(analyze,buffers,format json) '+sql,[w,id(500),users.ordinary])).rows[0]['QUERY PLAN'][0]
    const nodes=[];const visit=n=>{nodes.push(n);for(const child of n.Plans??[])visit(child)};visit(plan.Plan)
    for(const relation of ['assets','asset_relationships','workspace_teams','workspace_team_members','relationships']){
        const scan=nodes.find(n=>n['Relation Name']===relation)
        assert.ok(scan&&scan['Node Type']!=='Seq Scan',`${relation} uses existing index`)
        assert.ok(scan['Actual Rows']+(scan['Rows Removed by Filter']??0)<=1,`${relation} visits at most one row`)
    }
    console.log('PASS 20,000 unrelated client/team/asset rows: exact indexed lookups, no collection scans')
    await writeFile(process.env.BE_PORTAL_ACCESS_MEASURE??'/private/tmp/portal-upload-access-measure.json',JSON.stringify({runtime:'isolated PGlite PostgreSQL',results,plan},null,2)+'\n')
}finally{await db.close()}
