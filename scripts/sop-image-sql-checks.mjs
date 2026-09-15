import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { repositoryRoot } from './pglite-fixture.mjs'
export async function validateSopImageSql({db,id,w,admin,staff,sop,revision,fixture}){
 const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0]
 await db.exec(`alter table assets add column if not exists description text;alter table assets add column if not exists external_url text;
 alter table work_items add column if not exists area text default 'client';alter table work_items add column if not exists visibility text default 'workspace';
 create table if not exists asset_relationships(workspace_id uuid,asset_id uuid references assets(id),relationship_id uuid,created_at timestamptz default now(),primary key(asset_id,relationship_id));`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260915170000_sop_images_and_work_assets.sql`,'utf8'))
 const pdf=id(9001),picture=id(9002),hash='a'.repeat(64),imageHash='b'.repeat(64)
 const path=`${w}/sops/${sop}/assets/${pdf}/${hash}/original`
 await db.query('select attach_sop_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[w,admin,sop,pdf,'Tracking.pdf','application/pdf',500,path,'main',''])
 const extraction=(await one('select queue_sop_extraction($1,$2,$3,$4) id',[w,admin,sop,pdf])).id
 assert.equal((await one('select queue_sop_extraction($1,$2,$3,$4) id',[w,admin,sop,pdf])).id,extraction)
 await assert.rejects(db.query('select queue_sop_extraction($1,$2,$3,$4)',[w,staff,sop,pdf]),/admins/)
 const claimed=await one('select * from claim_sop_extraction($1)',[extraction]);assert.equal(await one('select * from claim_sop_extraction($1)',[extraction]),undefined)
 const visual={id:picture,ordinal:1,location:'Page 1',context:'Approved conversion settings screenshot with the required verification values.',attachable:true,method:'pdf_page',width:1200,height:1600,hash:imageHash,size:500}
 const finish=lease=>one('select finish_sop_extraction($1,$2,$3,$4,$5) saved',[extraction,lease,hash,[visual],[]])
 assert.equal((await finish(id(9999))).saved,false);assert.equal((await finish(claimed.lease_token)).saved,true);assert.equal((await finish(claimed.lease_token)).saved,false)
 assert.equal((await one('select count(*)::int n from sop_extracted_images where extraction_id=$1',[extraction])).n,1)
 assert.equal((await one('select native_kind from assets where id=$1',[picture])).native_kind,'sop_extracted_image')
 await db.query('select link_sop_service($1,$2,$3,$4,$5)',[w,admin,sop,revision,pdf])
 const relationship=await fixture(9010), run=(await one('select accept_sop_work_request($1,$2,100) id',[relationship,'gpt-5.4-mini'])).id
 const job=await one('select * from claim_sop_work($1)',[run]);await one('select prepare_sop_work($1,$2)',[run,job.lease_token])
 assert.equal((await one('select schema_version from sop_interpretations where id=$1',[job.interpretation_id])).schema_version,'sop-source-images-v3')
 const own=id(9011),other=id(9012),privateAsset=id(9013),otherRelationship=await fixture(9014)
 for(const asset of [own,other,privateAsset])await db.query("insert into assets(id,workspace_id,title,description,asset_kind,source_kind) values($1,$2,'Tracking reference','Use this approved tracking reference for conversion settings.','document','upload')",[asset,w])
 await db.query('insert into asset_relationships values($1,$2,$3,now()),($1,$4,$5,now()),($1,$6,$3,now()),($1,$6,$5,now())',[w,own,relationship,other,otherRelationship,privateAsset])
 const read=async()=> (await one('select sop_work_asset_candidates($1,$2,$3) data',[run,job.lease_token,[picture]])).data
 await db.query('update sop_extracted_images set attachable=false where asset_id=$1',[picture]);assert(!(await read()).some(a=>a.id===picture));await db.query('update sop_extracted_images set attachable=true where asset_id=$1',[picture]);
 let candidates=await read();assert(candidates.some(a=>a.id===picture));assert(candidates.some(a=>a.id===own));assert(!candidates.some(a=>[other,privateAsset].includes(a.id)))
 const source={summary:'Tracking',applicability:[],warnings:[],missing_information:[],steps:[{title:'Verify tracking',instruction:'Compare the conversion settings against the approved reference screenshot.',condition:'',source_location:'Page 1',source_quote:'Compare the conversion settings',kind:'requirement',image_ids:[picture]}]}
 const choice={asset_id:picture,source_step:1,source_quote:'Compare the conversion settings',asset_quote:'Approved conversion settings screenshot',reason:'Shows the specific conversion settings to verify.'}
 const task={title:'Verify conversion settings',description:'Check tracking settings.',instructions:source.steps[0].instruction,completion_requirements:['Settings have been verified.'],task_type:'implementation',requested_inputs:[],source_steps:[1],depends_on:[],blocked_reason:'',attachments:[choice]}
 const save=async(t=task,s=source)=>db.query("update sop_work_runs set plan=$1,source_snapshot=$2,asset_candidates=$3,schema_version='sop-work-assets-v7' where id=$4",[{summary:'Setup',warnings:[],tasks:[t]},s,candidates,run])
 const publish=()=>one('select publish_sop_work($1,$2) ids',[run,job.lease_token])
 await save({...task,attachments:[{...choice,asset_id:other}]});await assert.rejects(publish(),/stale|unavailable/)
 await save({...task,attachments:[{...choice,asset_quote:'Unrelated screenshot material'}]});await assert.rejects(publish(),/evidence/)
 await save(task,{...source,steps:[{...source.steps[0],image_ids:[]}]});await assert.rejects(publish(),/support/)
 await save({...task,task_type:'request_information'});await assert.rejects(publish(),/count/)
 await save();await db.query("update assets set description='Changed reference' where id=$1",[picture]);await assert.rejects(publish(),/stale/)
 await db.query('update assets set description=$1 where id=$2',[visual.context,picture]);candidates=await read();await save()
 const ids=(await publish()).ids;assert.equal(ids.length,1);assert.deepEqual((await publish()).ids,ids)
 const links=(await db.query('select asset_id from asset_work_items where work_item_id=$1',[ids[0]])).rows.map(a=>a.asset_id);assert.deepEqual(new Set(links),new Set([pdf,picture]))
 assert.equal((await one("select metadata->'ai_asset_evidence' evidence from work_items where id=$1",[ids[0]])).evidence[0].reason,choice.reason)
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from sop_extracted_images'),/permission denied/);await assert.rejects(db.query('select claim_sop_extraction(null)'),/permission denied/);await db.exec('reset role')
 console.log('PASS SOP images: durable extraction, retries, scoped candidates, stale/evidence denial, atomic attachments, replay and ordinary-role isolation')
}
