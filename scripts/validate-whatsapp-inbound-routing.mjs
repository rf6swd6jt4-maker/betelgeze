import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { PGlite, repositoryRoot } from './pglite-fixture.mjs'
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const owner = await readFile(`${repositoryRoot}/supabase/migrations/20260913120000_relationship_card_workspace.sql`, 'utf8')
const normalizer = owner.slice(owner.indexOf('create function public.relationship_contact_phone'), owner.indexOf('-- Bounded, relationship-scoped'))
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create table relationships(id uuid primary key,workspace_id uuid not null,client_id uuid,status text not null,whatsapp_phone text,primary_phone text,notes text);
grant select on relationships to service_role;
create index relationships_workspace_whatsapp_phone_idx on relationships(workspace_id,whatsapp_phone) where whatsapp_phone is not null;
${normalizer}`)
const w=id(1), other=id(2), r=id(3)
await db.query("insert into relationships values($1,$2,null,'active','+1 (817) 555-0123','+1 (817) 555-0123','')",[r,w])
const legacy = await db.query("select id from relationships where workspace_id=$1 and status<>'archived' and (whatsapp_phone=any($2) or primary_phone=any($2))",[w,['+18175550123','whatsapp:+18175550123','+8175550123','whatsapp:+8175550123']])
assert.equal(legacy.rows.length,0,'reproduce formatted-phone failure')
await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261020220000_whatsapp_inbound_phone_lookup.sql`,'utf8'))
const lookup = async (workspace=w,phone='whatsapp:+18175550123') => (await db.query('select * from find_whatsapp_inbound_relationships($1,$2)',[workspace,phone])).rows
assert.deepEqual(await lookup(),[{id:r,client_id:null}])
assert.deepEqual(await lookup(other),[])
for(const phone of ['+1 (817) 555-0123','0018175550123','817-555-0123','whatsapp:+18175550123 ext. 42']) assert.equal((await lookup(w,phone))[0]?.id,r)
for(const phone of ['',null,'whatsapp:','123','+18175550124']) assert.deepEqual(await lookup(w,phone),[])
await db.query("insert into relationships values($1,$2,null,'archived','+18175550123',null,''),($3,$4,null,'active','+18175550123',null,'')",[id(4),w,id(5),other])
assert.deepEqual(await lookup(),[{id:r,client_id:null}])
await db.query("insert into relationships values($1,$2,null,'active',null,'(817) 555-0123','')",[id(6),w])
assert.equal((await lookup()).length,2,'do not choose a relationship when two share the number')
await db.query("insert into relationships values($1,$2,null,'active','+44 (0) 7700 900123',null,'')",[id(7),w])
assert.equal((await lookup(w,'whatsapp:+447700900123'))[0]?.id,id(7))
await db.exec('set role authenticated')
await assert.rejects(lookup(),/permission denied/)
await db.exec('reset role; set role anon')
await assert.rejects(lookup(),/permission denied/)
await db.exec('reset role; set role service_role')
assert.equal((await lookup()).length,2)
await db.exec('reset role')
// Matched 20,000-row synthetic fixture; no production/provider calls.
await db.exec(`insert into relationships
select md5(i::text)::uuid,'${w}'::uuid,null,'active','+1900'||lpad(i::text,7,'0'),'+1900'||lpad(i::text,7,'0'),'' from generate_series(100,20100)i;
create table baseline(like relationships including constraints);
create unique index baseline_id on baseline(id);
create index baseline_raw_phone on baseline(workspace_id,whatsapp_phone) where whatsapp_phone is not null;
insert into baseline select * from relationships; analyze relationships; analyze baseline;`)
const explain = async (sql,params=[]) => (await db.query('explain (analyze, buffers, format json) '+sql,params)).rows[0]['QUERY PLAN'][0]
const resolverSql=(await db.query("select prosrc from pg_proc where oid='find_whatsapp_inbound_relationships(uuid,text)'::regprocedure")).rows[0].prosrc.replaceAll('p_workspace_id','$1::uuid').replaceAll('p_from_address','$2::text')
const plan = await explain(resolverSql,[w,'+19000015000'])
const textPlan = JSON.stringify(plan)
assert.match(textPlan,/relationships_inbound_whatsapp_phone_idx/)
assert.match(textPlan,/relationships_inbound_primary_phone_idx/)
const summary = values => { values.sort((a,b)=>a-b); return {medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.floor(values.length*.95)]} }
const timings={}
for(const action of ['lookup','phoneEdit','notesEdit']) {
    const times={baseline:[],candidate:[]}
    for(let i=0;i<120;i++) {
        for(const arm of (i%2 ? ['baseline','candidate']:['candidate','baseline'])) {
            const table=arm==='baseline'?'baseline':'relationships'
            let ms
            if(action==='lookup') {
                if(arm==='candidate') ms=(await explain('select * from find_whatsapp_inbound_relationships($1,$2)',[w,'+19000015000']))['Execution Time']
                else {
                    ms=0
                    for(const field of ['whatsapp_phone','primary_phone']) ms+=(await explain(`select id,client_id from baseline where workspace_id=$1 and status<>'archived' and ${field}=any($2)`,[w,['+19000015000','whatsapp:+19000015000']]))['Execution Time']
                }
            } else {
                const identifier=(await db.query('select md5($1)::uuid id',[(100+i).toString()])).rows[0].id
                const update=action==='phoneEdit'?"whatsapp_phone='+18005550123',primary_phone='+18005550123'":"notes='updated'"
                ms=(await explain(`update ${table} set ${update} where id=$1`,[identifier]))['Execution Time']
            }
            if(i>=20) times[arm].push(ms)
        }
    }
    timings[action]=Object.fromEntries(Object.entries(times).map(([name,values])=>[name,summary(values)]))
}
// Many shared-number rows must still inspect only two candidates per index.
await db.exec(`insert into relationships select md5(('duplicate'||i)::text)::uuid,'${w}'::uuid,null,'active','+18175550123','+18175550123','' from generate_series(1,10000)i; analyze relationships;`)
assert.equal((await lookup()).length,2)
const duplicatePlan=await explain(resolverSql,[w,'+18175550123'])
assert.doesNotMatch(JSON.stringify(duplicatePlan),/Seq Scan/)
const evidence={checks:'formatting, US aliases, trunk zero, extensions, invalid inputs, both fields, duplicate identities, workspace, archive and role boundaries passed',rowsBeforeDuplicateFixture:20006,samplesPerArm:100,timings,plan,duplicatePlan}
if(process.argv[2]) await writeFile(process.argv[2],JSON.stringify(evidence,null,2)+'\n')
console.log(JSON.stringify({checks:evidence.checks,timings,lookupMs:plan['Execution Time'],duplicateLookupMs:duplicatePlan['Execution Time']}))
await db.close()
