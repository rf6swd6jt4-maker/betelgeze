import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { repositoryRoot } from './pglite-fixture.mjs'
export async function validateSopEvidenceTitles({db,id,w,admin,sop,fixture}) {
 const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0]
 const image=id(9002)
 await db.query("update assets set title='SOP visual '||chr(194)||chr(183)||' Page 1' where id=$1",[image])
 // Emulate the production migration's misdecoded title literal, not just rows.
 await db.exec(`do $$declare def text;begin select pg_get_functiondef('finish_sop_extraction(uuid,uuid,text,jsonb,jsonb,text)'::regprocedure) into def;
 execute replace(def,quote_literal('SOP visual '||chr(183)||' '),quote_literal('SOP visual '||chr(194)||chr(183)||' '));end $$;`)
 const migration=await readFile(`${repositoryRoot}/supabase/migrations/20260915200000_sop_attachment_evidence_and_titles.sql`,'utf8')
 assert.equal(/[^\x00-\x7f]/.test(migration),false)
 await db.exec(migration)
 assert.equal((await one('select title from assets where id=$1',[image])).title,'SOP visual · Page 1')
 for(const [quote,context,expected] of [['Original\u00a0source\nquotation','Original source quotation',true],['ORIGINAL source quotation','Original source quotation',true],['a            b','a b',false],[null,'Original source quotation',false],['Original source quotation',null,false],['Invented words in this quote','Original source quotation',false]]){
  assert.equal((await one('select sop_attachment_quote_matches($1,$2) ok',[quote,context])).ok,expected)
 }
 const r=await fixture(9700),run=(await one('select accept_sop_work_request($1,$2,100) id',[r,'gpt-5.4-mini'])).id
 const job=await one('select * from claim_sop_work($1)',[run]);await one('select prepare_sop_work($1,$2)',[run,job.lease_token])
 const candidates=(await one('select sop_work_asset_candidates($1,$2,$3) value',[run,job.lease_token,[image]])).value
 const candidate=candidates.find(c=>c.id===image);assert.ok(candidate)
 const source={summary:'Tracking',applicability:[],warnings:[],missing_information:[],steps:[{title:'Compare tracking',instruction:'Check the tracking configuration against the approved example.',source_quote:'Original document says to compare conversion settings.',source_location:'Page 1',kind:'requirement',condition:'',image_ids:[image]}]}
 const choice={asset_id:image,source_step:1,source_quote:source.steps[0].source_quote,asset_quote:'Approved conversion settings screenshot',reason:'Shows the required settings for the tracking comparison.'}
 const task={title:'Check tracking',description:'Verify tracking.',instructions:source.steps[0].instruction,completion_requirements:['The tracking configuration matches.'],task_type:'implementation',requested_inputs:[],source_steps:[1],depends_on:[],blocked_reason:'',attachments:[choice]}
 const save=async(t=task)=>db.query("update sop_work_runs set plan=$1,source_snapshot=$2,asset_candidates=$3,schema_version='sop-work-assets-v8' where id=$4",[{summary:'Setup',warnings:[],tasks:[t]},source,candidates,run])
 await save({...task,attachments:[{...choice,source_quote:'A plausible but invented source statement.'}]})
 await assert.rejects(db.query('select publish_sop_work($1,$2)',[run,job.lease_token]),/evidence/)
 await save({...task,attachments:[{...choice,asset_quote:'An invented description of the image.'}]})
 await assert.rejects(db.query('select publish_sop_work($1,$2)',[run,job.lease_token]),/evidence/)
 await save();const ids=(await one('select publish_sop_work($1,$2) ids',[run,job.lease_token])).ids
 assert.equal((await one('select count(*)::int n from asset_work_items where asset_id=$1 and work_item_id=$2',[image,ids[0]])).n,1)
 // New extraction titles are correct after replacing the corrupted function.
 const pdf=id(9710),picture=id(9711),hash='c'.repeat(64),path=`${w}/sops/${sop}/assets/${pdf}/${hash}/original`
 await db.query('select attach_sop_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[w,admin,sop,pdf,'New visual.pdf','application/pdf',500,path,'reference',''])
 const extraction=(await one('select queue_sop_extraction($1,$2,$3,$4) id',[w,admin,sop,pdf])).id
 const lease=await one('select * from claim_sop_extraction($1)',[extraction])
 const visual={id:picture,ordinal:1,location:'Page 2',context:'Original document figure with supported instructions.',attachable:true,method:'pdf_page',width:1200,height:1600,hash:'d'.repeat(64),size:500}
 await one('select finish_sop_extraction($1,$2,$3,$4,$5)',[extraction,lease.lease_token,hash,[visual],[]])
 assert.equal((await one('select title from assets where id=$1',[picture])).title,'SOP visual · Page 2')
 // Re-running only the bounded repair must preserve a user-renamed title.
 await db.query('update assets set title=$1 where id=$2',['Custom Â· image name',picture])
 const repair=migration.slice(migration.indexOf('update public.assets'),migration.indexOf("notify pgrst"))
 await db.exec(repair);assert.equal((await one('select title from assets where id=$1',[picture])).title,'Custom Â· image name')
 await db.exec('set role authenticated');await assert.rejects(db.query("select sop_attachment_quote_matches('Original document quote','Original document quote')"),/permission denied/);await db.exec('reset role')
 console.log('PASS attachment evidence/title SQL: original quotations publish, invented quotes fail, Unicode whitespace parity, corrupt function and titles repaired, custom titles preserved')
}
