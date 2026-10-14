// Fresh socket-only PostgreSQL cluster. No production URLs or existing databases.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fixtureSql,migration,seed,id} from './fixture.mjs'
const require=createRequire(import.meta.url)
const {Client}=require(require.resolve('pg',{paths:[process.env.BE_PG_ROOT||process.cwd()]}))
const bin=process.env.BE_RECORDS_PG_BIN
assert.ok(bin&&path.isAbsolute(bin),'Set BE_RECORDS_PG_BIN to reviewed PostgreSQL binaries')
const root=await mkdtemp(path.join(tmpdir(),'be-shared-queue-pg-')),data=path.join(root,'data'),socket=path.join(root,'socket');await mkdir(socket,{mode:0o700})
const clients=[];let started=false,passed=0
const pass=name=>console.log(`PASS ${++passed}: ${name}`)
const connect=async()=>{const c=new Client({host:socket,port:55487,user:'fixture_owner',database:'postgres'});await c.connect();clients.push(c);await c.query("set statement_timeout='10s';set lock_timeout='8s'");c.pid=(await c.query('select pg_backend_pid() pid')).rows[0].pid;return c}
try {
 execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fixture_owner','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C'],{stdio:'pipe'})
 execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'server.log'),'-o',`-k ${socket} -p 55487 -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});started=true
 const admin=await connect();await admin.query(await fixtureSql());await admin.query(await migration());const f=await seed(admin)
 const {w,alice,bob,client,instance}=f
 const one=async(s,p=[])=>(await admin.query(s,p)).rows[0]
 const version=async(n)=>(await one('select updated_at::text v from work_items where id=$1',[id(n)])).v
 const roster=async(c,members,v,request)=>(await c.query('select save_service_queue_roster($1,$2,$3,$4,$5,$6,$7) r',[w,client,instance,f.admin,id(request),v,members])).rows[0].r
 const cmd=async(c,n,action,user,v,request)=>(await c.query('select shared_queue_command($1,$2,$3,$4,$5,$6) r',[w,user,id(n),action,v,id(request)])).rows[0].r
 const waitLock=async c=>{const deadline=Date.now()+3000;while(Date.now()<deadline){if((await one('select exists(select 1 from pg_locks where pid=$1 and not granted) waiting',[c.pid])).waiting)return;await new Promise(r=>setTimeout(r,10))}throw Error('No real lock wait observed')}
 await roster(admin,[bob],0,100)
 const a=await connect(),b=await connect()
 let v=await version(20)
 await a.query('begin');await cmd(a,20,'start',alice,v,101)
 const loser=assert.rejects(cmd(b,20,'start',bob,v,102),/changed/);await waitLock(b);await a.query('commit');await loser
 assert.equal((await one('select count(*)::int n from service_queue_activity where active')).n,1)
 pass('simultaneous same-task starts serialize and the stale actor cannot start twice')
 await cmd(admin,20,'pause',alice,await version(20),103)
 await a.query('begin');await cmd(a,20,'start',alice,await version(20),104)
 await b.query("set lock_timeout='500ms'");await cmd(b,21,'start',bob,await version(21),105);await b.query("set lock_timeout='8s'");await a.query('commit')
 pass('different members start different tasks concurrently without waiting on each other')
 await cmd(admin,20,'pause',alice,await version(20),106)
 await a.query('begin');await cmd(a,20,'start',alice,await version(20),107)
 const sameActor=assert.rejects(cmd(b,22,'start',alice,await version(22),108),/Pause your current/);await waitLock(b);await a.query('commit');await sameActor
 pass('one person cannot race two active tasks across browser tabs')
 v=await version(20)
 await a.query('begin');const completed=await cmd(a,20,'complete',bob,v,109)
 const secondComplete=assert.rejects(cmd(b,20,'complete',alice,v,110),/no longer available/);await waitLock(b);await a.query('commit');await secondComplete
 assert.deepEqual(await cmd(admin,20,'complete',bob,v,109),completed)
 assert.equal((await one('select count(*)::int n from work_queue_completion_followups where work_item_id=$1',[id(20)])).n,1)
 pass('cross-member completion, concurrent completion and lost-response replay create one follow-up')
 await a.query('begin');await roster(a,[],1,111)
 const removed=assert.rejects(cmd(b,22,'start',bob,await version(22),112),/assignment changed/);await waitLock(b);await a.query('commit');await removed
 assert.equal((await one('select status from work_items where id=$1',[id(21)])).status,'todo')
 pass('removal commits before a waiting action; removed actor cannot operate and active work is released')
 await roster(admin,[bob],2,113)
 await a.query('begin');await cmd(a,22,'start',bob,await version(22),114)
 const removal=roster(b,[],3,115);removal.catch(()=>{});await waitLock(b);await a.query('commit');await removal
 assert.equal((await one('select status from work_items where id=$1',[id(22)])).status,'todo')
 assert.equal((await one('select count(*)::int n from service_queue_receipts where request_id=$1',[id(114)])).n,1)
 pass('accepted action precedes removal without losing its receipt or leaving an active removed worker')
 console.log(JSON.stringify({passed,productionCalls:0,postgres:(await one('select version() v')).v}))
}finally{
 await Promise.allSettled(clients.map(c=>c.end()))
 if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{stdio:'pipe'})
 await rm(root,{recursive:true,force:true})
}
