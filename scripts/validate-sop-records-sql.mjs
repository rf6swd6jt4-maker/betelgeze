import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const w=id(1), other=id(2), admin=id(3), staff=id(4), sop=id(5), asset=id(6), legacy=id(7)
const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0]
let checks=0
const pass = label => console.log(`PASS ${++checks}: ${label}`)
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key);
 create table workspaces(id uuid primary key,status text default 'active');
 create table workspace_memberships(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
 create table assets(id uuid primary key,workspace_id uuid,title text,asset_kind text,source_kind text,native_kind text,native_id uuid,storage_path text,content_type text,file_size bigint,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
 insert into auth.users values('${admin}'),('${staff}'); insert into workspaces(id) values('${w}'),('${other}');
 insert into workspace_memberships values('${w}','${admin}','admin'),('${w}','${staff}','staff');
 insert into assets(id,workspace_id,title,native_kind,created_by) values('${legacy}','${w}','Legacy.pdf','sop_document','${admin}');`)
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20260914100000_sop_records_and_interpretation.sql`,'utf8'))
 assert.equal((await one('select sop_id from sop_assets where asset_id=$1',[legacy])).sop_id,legacy)
 pass('migration applies and preserves old document IDs as SOP records')
 await db.query('select create_sop_record($1,$2,$3,$4,$5)',[w,admin,sop,'Ads fulfilment','For this service'])
 await db.query('select create_sop_record($1,$2,$3,$4,$5)',[w,admin,sop,'Ads fulfilment','For this service'])
 assert.equal((await one('select count(*)::int n from sops where id=$1',[sop])).n,1)
 await assert.rejects(db.query('select create_sop_record($1,$2,$3,$4,$5)',[w,staff,id(9),'Staff','']),/admins/)
 await assert.rejects(db.query('select create_sop_record($1,$2,$3,$4,$5)',[other,admin,id(9),'Other','']),/admins/)
 pass('create retry is idempotent; staff and foreign workspace writes fail')
 const attach=()=>db.query('select attach_sop_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[w,admin,sop,asset,'Notes.txt','text/plain',120,`${w}/sops/${sop}/assets/${asset}/${"a".repeat(64)}/original`,'main','Use for agencies'])
 await attach();await attach()
 assert.equal((await one('select count(*)::int n from sop_assets where sop_id=$1',[sop])).n,1)
 assert.equal((await one('select version from sops where id=$1',[sop])).version,2)
 await assert.rejects(db.query('select update_sop_record($1,$2,$3,1,$4,$5,false)',[w,admin,sop,'Stale','']),/changed/)
 pass('asset finalization and parent version update occur once; stale edits fail')
 const queue=(retry=false,limit=2)=>one('select queue_sop_interpretation($1,$2,$3,$4,$5,$6,$7,$8) id',[w,admin,sop,asset,'sop-source-v1','fixture-model',retry,limit])
 const job=(await queue()).id
 assert.equal((await queue()).id,job)
 assert.equal((await one('select count(*)::int n from sop_interpretation_attempts')).n,1)
 const claimed=await one('select * from claim_sop_interpretation($1)',[job])
 assert.equal((await db.query('select * from claim_sop_interpretation($1)',[job])).rows.length,0)
 assert.equal((await one('select finish_sop_interpretation($1,$2,$3,$4,10,5,null) ok',[job,id(99),{},'hash'])).ok,false)
 assert.equal((await one('select finish_sop_interpretation($1,$2,$3,$4,10,5,null) ok',[job,claimed.lease_token,{summary:'Draft'},'hash'])).ok,true)
 assert.equal((await one('select review_sop_interpretation($1,$2,$3,$4) ok',[w,admin,sop,job])).ok,true)
 pass('queue deduplicates, leases exclude other workers, stale completion fails, review persists')
 const secondAsset=id(10)
 await db.query('select attach_sop_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[w,admin,sop,secondAsset,'Example.txt','text/plain',10,`${w}/sops/${sop}/assets/${secondAsset}/${"b".repeat(64)}/original`,'example',''])
 const secondJob=(await one('select queue_sop_interpretation($1,$2,$3,$4,$5,$6,false,2) id',[w,admin,sop,secondAsset,'sop-source-v1','fixture-model'])).id
 await one('select * from claim_sop_interpretation($1)',[secondJob]); await db.query("update sop_interpretations set lease_until=now()-interval '1 minute' where id=$1",[secondJob])
 await one('select * from claim_sop_interpretation($1)',[secondJob])
 assert.equal((await one('select status from sop_interpretations where id=$1',[secondJob])).status,'failed')
 await assert.rejects(db.query('select queue_sop_interpretation($1,$2,$3,$4,$5,$6,true,2)',[w,admin,sop,secondAsset,'sop-source-v1','fixture-model']),/daily/)
 pass('interrupted paid calls do not auto-retry; daily reservations include attempts')
 await db.query('select update_sop_record($1,$2,$3,3,$4,$5,true)',[w,admin,sop,'Ads fulfilment','For this service'])
 await assert.rejects(db.query('select queue_sop_interpretation($1,$2,$3,$4,$5,$6,true,10)',[w,admin,sop,secondAsset,'sop-source-v1','fixture-model']),/archived/)
 await db.query('select update_sop_record($1,$2,$3,4,$4,$5,false)',[w,admin,sop,'Ads fulfilment','For this service'])
 assert.equal((await one('select count(*)::int n from sop_assets where sop_id=$1',[sop])).n,2)
 pass('archive blocks new interpretation; restore retains all assets')
 await db.exec('set role authenticated')
 await assert.rejects(db.query('select * from sops'),/permission/)
 await assert.rejects(db.query('select * from claim_sop_interpretation(null)'),/permission/)
 await db.exec('reset role')
 pass('browser roles cannot bypass MFA-protected application routes or claim jobs')
 // Representative growth: no files or model payloads are read for catalogue pages.
 await db.query(`insert into sops(workspace_id,title,created_at) select $1,'Procedure '||i,now()-i*interval '1 second' from generate_series(1,30000) i`,[w])
 await db.query(`insert into assets(id,workspace_id,title) select gen_random_uuid(),$1,'Asset '||i from generate_series(1,30000) i`,[w])
 await db.query(`insert into sop_assets(asset_id,sop_id,workspace_id) select id,$1,$2 from assets where title like 'Asset %'`,[sop,w])
 await db.exec('analyze sops; analyze sop_assets;')
 const plan=await db.query('explain (analyze,format json) select id,title,created_at from sops where workspace_id=$1 and archived_at is null order by created_at desc,id desc limit 25',[w])
 const assetPlan=await db.query('explain (analyze,format json) select asset_id,role from sop_assets where workspace_id=$1 and sop_id=$2 order by created_at desc,asset_id desc limit 25',[w,sop])
 assert.match(JSON.stringify(plan.rows),/sops_catalogue_idx/)
 assert.match(JSON.stringify(assetPlan.rows),/sop_assets_page_idx/)
 const first=(await db.query('select asset_id,created_at::text created_at from sop_assets where workspace_id=$1 and sop_id=$2 order by created_at desc,asset_id desc limit 24',[w,sop])).rows
 const last=first.at(-1)
 const next=(await db.query('select asset_id from sop_assets where workspace_id=$1 and sop_id=$2 and (created_at,asset_id)<($3::timestamptz,$4::uuid) order by created_at desc,asset_id desc limit 24',[w,sop,last.created_at,last.asset_id])).rows
 assert.equal(next.length,24);assert.equal(next.some(row=>first.some(a=>a.asset_id===row.asset_id)),false)
 const joined=await db.query(`explain (analyze,format json)
   select p.asset_id,a.title,a.content_type,j.status from sop_assets p
   join assets a on a.id=p.asset_id
   left join sop_interpretations j on j.asset_id=p.asset_id and j.schema_version='sop-source-v1'
   where p.workspace_id=$1 and p.sop_id=$2 order by p.created_at desc,p.asset_id desc limit 25`,[w,sop])
 assert.match(JSON.stringify(joined.rows),/sop_assets_page_idx/)
 assert.equal(joined.rows[0]['QUERY PLAN'][0].Plan['Actual Rows'],25)
 pass('30k-record catalogue and joined 30k-asset detail pages use indexes; tie pagination has no overlap')
 console.log(JSON.stringify({checks,cataloguePlan:plan.rows[0],assetPlan:assetPlan.rows[0]}))
} finally { await db.close() }
