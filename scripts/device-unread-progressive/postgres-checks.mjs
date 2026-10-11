// Native PostgreSQL concurrency gate. Requires a disposable LOCAL server and
// creates/drops only its own random database. Never accepts a remote hostname.
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {createDeviceUnreadFixture,id} from './production-fixture.mjs'
if(!process.env.BE_DEVICE_POSTGRES_URL)throw Error('Set BE_DEVICE_POSTGRES_URL to an explicitly created disposable loopback cluster')
const url=new URL(process.env.BE_DEVICE_POSTGRES_URL)
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Only disposable loopback PostgreSQL is permitted')
const require=createRequire(import.meta.url)
const {Client}=require(require.resolve('pg',{paths:process.env.BE_PG_ROOT?[process.env.BE_PG_ROOT]:[process.cwd()]}))
const admin=new Client({connectionString:url.href});await admin.connect()
const database=`device_unread_${randomBytes(7).toString('hex')}`,checks=[]
let fixture,clients=[]
try {
 await admin.query(`create database ${database}`)
 url.pathname=`/${database}`
 const connect=async()=>{const client=new Client({connectionString:url.href});await client.connect();clients.push(client);return client}
 const initial=await connect()
 // Roles are cluster-scoped; do not drop roles a previous isolated suite made.
 const adapter={exec:sql=>initial.query(sql.replaceAll(/create role (authenticated|anon|service_role);/g,(_,role)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${role}')then create role ${role};end if;end$$;`)),query:(...args)=>initial.query(...args),close:async()=>{}}
 fixture=await createDeviceUnreadFixture({chats:8,backlog:4,database:adapter})
 const {ids,conversations,claims}=fixture,{w,me,deviceA,deviceB,sessionB}=ids,c=conversations[0],n=conversations[1]
 const a=await connect(),b=await connect(),legacy=await connect()
 const pids=await Promise.all([a,b,legacy].map(c=>c.query('select pg_backend_pid() pid').then(x=>x.rows[0].pid)))
 const waitForLock=async(expected)=>{
  const deadline=Date.now()+5000
  while(Date.now()<deadline){
   const result=await initial.query("select count(*)::int n from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'",[pids])
   if(result.rows[0].n===expected)return
   await new Promise(resolve=>setTimeout(resolve,10))
  }
  throw Error(`Expected ${expected} genuinely blocked concurrent PostgreSQL writers`)
 }
 await a.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)])
 await b.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({...claims,session_id:sessionB})])
 await legacy.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)])
 const call=(client,name,args)=>client.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args).then(x=>x.rows[0].result)
 await Promise.all([call(a,'communication_device_unread_summary',[w,deviceA,false]),call(legacy,'communication_device_history',[w,deviceA,'client',c.id]),call(b,'communication_device_unread_summary',[w,deviceB,false])])
 const scopes=await initial.query('select count(*)::int n from communication_device_read_scopes where workspace_id=$1 and user_id=$2',[w,me]);assert.equal(scopes.rows[0].n,2);checks.push('Concurrent same-installation initialization commits exactly one complete scope')
 const seed=await initial.query('select device_id,count(*)::int n from communication_device_read_cursors group by device_id');assert.ok(seed.rows.every(x=>x.n===8));checks.push('Concurrent seed contains every frozen baseline cursor')
 // Hold the canonical lock so old and new writers queue concurrently, then
 // release it. Separate sessions exercise PostgreSQL transaction snapshots.
 await initial.query('begin');await initial.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${me}:client:${c.id}`])
 const oldSave=call(legacy,'advance_communication_read',[w,'client',c.id,c.latestMessageId])
 const privateA=call(a,'advance_communication_device_read',[w,deviceA,'client',c.id,id(100002)])
 const privateB=call(b,'advance_communication_device_read',[w,deviceB,'client',c.id,id(100003)])
 await waitForLock(3);await initial.query('commit');await Promise.all([oldSave,privateA,privateB])
 const shared=(await initial.query('select last_read_message_id from communication_read_cursors where relationship_id=$1',[c.id])).rows[0]
 assert.equal(shared.last_read_message_id,c.latestMessageId);checks.push('Concurrent old/new writers preserve maximal shared alert frontier')
 const positions=(await initial.query('select device_id,last_read_message_id from communication_device_read_cursors where conversation_id=$1 order by device_id',[c.id])).rows
 assert.equal(positions.find(x=>x.device_id===deviceA).last_read_message_id,id(100002));assert.equal(positions.find(x=>x.device_id===deviceB).last_read_message_id,id(100003));checks.push('Concurrent devices retain independent private positions')
 // Same installation observed in two live sessions, with out-of-order writes.
 const sibling=id(950);await initial.query('insert into auth.sessions values($1,$2,null)',[sibling,me]);await initial.query('insert into account_session_devices values($1,$2,$3)',[sibling,me,deviceA]);await legacy.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({...claims,session_id:sibling})])
 await Promise.all([call(a,'advance_communication_device_read',[w,deviceA,'native',n.id,n.latestMessageId]),call(legacy,'advance_communication_device_read',[w,deviceA,'native',n.id,n.firstMessageId])])
 const own=await call(a,'communication_device_history',[w,deviceA,'native',n.id]);assert.equal(own.deviceCursor.lastReadMessageId,n.latestMessageId);checks.push('Same-installation sibling sessions cannot regress a cursor')
 await initial.query('begin');await initial.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`${me}:native:${n.id}`])
 const newer=call(a,'advance_communication_device_read',[w,deviceA,'native',n.id,n.latestMessageId]),duplicate=call(legacy,'advance_communication_device_read',[w,deviceA,'native',n.id,n.latestMessageId])
 await waitForLock(2);await initial.query('commit');await Promise.all([newer,duplicate]);checks.push('Concurrent duplicate saves both confirm without deadlock')
 const report={database:'native PostgreSQL, isolated loopback database',version:(await initial.query('select version()')).rows[0].version,assertions:checks.length,checks,failures:0,limits:['Synthetic auth and Vault secret view; not hosted Supabase session enforcement','This checks concurrency and transactions, not production load or replication latency']}
 await writeFile(process.argv[2]||'/private/tmp/device-unread-native-postgres.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
} finally {
 if(clients[0])await clients[0].query('rollback').catch(()=>undefined)
 await Promise.allSettled(clients.map(c=>c.end()))
 await admin.query(`drop database if exists ${database} with(force)`)
 await admin.end()
}
