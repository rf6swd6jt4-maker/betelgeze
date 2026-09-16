import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {repositoryRoot} from './pglite-fixture.mjs'
export async function validateRelationshipContextAssets({db,id,w,admin,staff,sop,revision,fixture}){
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
 await db.exec(`alter table relationships add column primary_person_name text default 'Andy';alter table relationships add column primary_contact_role text;alter table relationships add column seller_user_id uuid;alter table relationships add column pos_started_at timestamptz;
 create function workspace_role_for_user(uuid,uuid) returns text language sql as $$select role from workspace_memberships where workspace_id=$1 and user_id=$2$$;
 create function workspace_user_can_sell(uuid,uuid) returns boolean language sql as $$select false$$;`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260916120000_relationship_context_assets.sql`,'utf8'))
 await db.exec('grant all on all tables in schema public to service_role;grant execute on all functions in schema public to service_role;')
 const r=await fixture(9800),asset=id(9801),hash='a'.repeat(64),path=`${w}/relationship-context/${r}/${asset}/${hash}/original`
 const args=[w,r,admin,asset,'Old website brief.txt','The booking page exists now.','text/plain',100,path,hash,'The website does not yet have a booking page.']
 await db.exec('set role service_role')
 const attach='select attach_relationship_context_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) id'
 await assert.rejects(db.query(attach,args.map((v,i)=>i===2?staff:v)),/seller, manager/)
 assert.equal((await one(attach,args)).id,asset);assert.equal((await one(attach,args)).id,asset)
 assert.equal((await one('select count(*)::int n from relationship_context_assets where relationship_id=$1',[r])).n,1)
 let packet=(await one('select sop_work_evidence($1::uuid,$2::uuid,null,($2::uuid)::text) p',[w,r])).p
 assert.equal(packet.client_context.documents[0].document_text,args[10]);assert.equal(packet.client_context.documents[0].description,args[5]);assert.equal(packet.client_context.relationship.name,'Andy')
 const first=JSON.stringify(packet)
 // A leased run must not publish against edited relationship evidence.
 const sourceAsset=(await one("select asset_id from sop_service_sources where workspace_id=$1 and service_id=$2 and enabled",[w,revision])).asset_id
 const run=id(9802)
 await one('select queue_sop_work($1,$2,$3,$4,$5,$6,$7,$8,100)',[w,admin,run,sop,sourceAsset,r,r,'gpt-5.4-mini'])
 const job=await one('select * from claim_sop_work($1)',[run])
 await one('select prepare_sop_work($1,$2)',[run,job.lease_token])

 await db.query('update relationships set notes_summary=$1,website_url=$2,industry_value=$3 where id=$4',['The booking page is live at /book','https://example.com','Lighting',r])
 packet=(await one('select sop_work_evidence($1::uuid,$2::uuid,null,($2::uuid)::text) p',[w,r])).p
 await assert.rejects(db.query('select publish_sop_work($1,$2)',[run,job.lease_token]),/context or service changed/)
 assert.equal((await one('select count(*)::int n from service_instance_work_items where instance_id=$1',[r])).n,0)
 assert.notEqual(JSON.stringify(packet),first);assert.equal(packet.client_context.relationship.description,'The booking page is live at /book')
 await assert.rejects(db.query('select edit_relationship_context_asset($1,$2,$3,$4,$5,false,$6)',[w,r,admin,asset,'New','stale']),/changed/)
 await db.query('select edit_relationship_context_asset($1,$2,$3,$4,$5,false,$6)',[w,r,admin,asset,'Newest correction',args[5]])
 packet=(await one('select sop_work_evidence($1::uuid,$2::uuid,null,($2::uuid)::text) p',[w,r])).p
 assert.equal(packet.client_context.documents[0].description,'Newest correction')
 await db.query('select edit_relationship_context_asset($1,$2,$3,$4,$5,true,$6)',[w,r,admin,asset,'Newest correction','Newest correction'])
 assert.equal((await one('select sop_work_evidence($1::uuid,$2::uuid,null,($2::uuid)::text) p',[w,r])).p.client_context.documents.length,0)
 await assert.rejects(db.query(attach,args),/removed/)
 await db.exec('reset role;set role authenticated')
 await assert.rejects(db.query('select document_text from relationship_context_assets'),/permission denied/)
 await assert.rejects(db.query(attach,args),/permission denied|Trusted runtime/)
 await db.exec('reset role')
 console.log('PASS relationship context: scoped writes, idempotency, extraction reuse, description CAS, evidence changes, removal, RLS')
}
