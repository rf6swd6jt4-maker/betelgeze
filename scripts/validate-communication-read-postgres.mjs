// Native PostgreSQL concurrency proof using a fresh private UNIX socket cluster.
// Never accepts a database URL, real account, external delivery or existing server.
import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {readEfficiencyFixtureSql,readEfficiencyFixtureIds,baselineReadDefinition,readEfficiencyMigration,id} from './communication-read-efficiency-fixture.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),bin=process.env.BE_RECORDS_PG_BIN
assert.ok(bin&&path.isAbsolute(bin),'Set BE_RECORDS_PG_BIN to a reviewed PostgreSQL binary directory')
const evidencePath=process.env.BE_COMMUNICATION_READ_PG_EVIDENCE
const temporary=await mkdtemp(path.join(tmpdir(),'be-shared-read-pg-')),data=path.join(temporary,'data'),socket=path.join(temporary,'socket')
await mkdir(socket,{mode:0o700})
const childEnv={PATH:'/usr/bin:/bin',LC_ALL:'C',TZ:'UTC'},port='55483',sessions=new Set(),results=[],observations=[],sources={}
const {w,me,client,native,other}=readEfficiencyFixtureIds
const literal=value=>`'${String(value).replaceAll("'","''")}'`
let serial=0,startAttempted=false,serverStarted=false,outcome='failed',admin
const pass=(name,extra={})=>{results.push({name,passed:true,...extra});console.log(`ok ${results.length} - ${name}`)}
class Session{
 constructor(name){
  this.name=`${name}_${++serial}`;this.buffer='';this.errors='';this.pending=null
  this.child=spawn(path.join(bin,'psql'),['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h',socket,'-p',port,'-U','fixture_owner','-d','postgres'],{env:childEnv,stdio:['pipe','pipe','pipe']})
  sessions.add(this)
  this.child.stdout.on('data',chunk=>{this.buffer+=chunk.toString();while(this.buffer.includes('\n')){const end=this.buffer.indexOf('\n'),line=this.buffer.slice(0,end).replace(/\r$/,'');this.buffer=this.buffer.slice(end+1);if(this.pending&&line===this.pending.marker){const pending=this.pending;this.pending=null;clearTimeout(pending.timer);pending.resolve(pending.lines)}else if(this.pending&&line.trim())this.pending.lines.push(line)}})
  this.child.stderr.on('data',chunk=>{this.errors+=chunk.toString()})
  this.child.on('error',error=>this.reject(error))
  this.child.on('exit',(code,signal)=>{this.exited=true;this.reject(Object.assign(Error(`psql ${this.name} exited ${code??signal}: ${this.errors}`),{sqlstate:this.errors.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]}));sessions.delete(this)})
 }
 reject(error){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null}}
 query(sql){assert.equal(this.pending,null,`Overlapping query on ${this.name}`);assert.ok(!this.exited,`Closed session ${this.name}`);return new Promise((resolve,reject)=>{const marker=`BE_READ_END_${++serial}`,timer=setTimeout(()=>{this.reject(Error(`Bounded query timeout: ${this.name}`));this.child.kill('SIGTERM')},20000);this.pending={marker,timer,resolve,reject,lines:[]};this.child.stdin.write(`${sql}\n;\n\\echo ${marker}\n`)})}
 async json(sql){const rows=await this.query(sql);assert.equal(rows.length,1,`Expected one JSON result: ${this.name}`);return JSON.parse(rows[0])}
 async close(){if(this.exited)return;this.child.stdin.end('\\q\n');await new Promise(resolve=>{this.child.once('exit',resolve);setTimeout(()=>{if(!this.exited)this.child.kill('SIGTERM');resolve()},500).unref()})}
}
async function connect(name,authenticated=false){const session=new Session(name);await session.query(`set application_name=${literal(`be_read_${session.name}`)};set statement_timeout='12s';set lock_timeout='8s';set idle_in_transaction_session_timeout='18s';${authenticated?`set role authenticated;set request.jwt.claims=${literal(JSON.stringify({sub:me,role:'authenticated',aal:'aal2'}))};`:''}`);session.pid=await session.json('select to_json(pg_backend_pid())');return session}
async function waitAdvisory(session){const deadline=Date.now()+4000;while(Date.now()<deadline){assert.ok(!session.exited,session.errors);const locks=await admin.json(`select coalesce(jsonb_agg(jsonb_build_object('locktype',locktype,'mode',mode)),'[]'::jsonb) from pg_locks where pid=${session.pid} and not granted`);if(locks.some(row=>row.locktype==='advisory'))return locks;await new Promise(resolve=>setTimeout(resolve,10))}throw Error(`No actual advisory wait observed for ${session.name}`)}
const rpc=(arm,kind,conversation,message)=>`select public.${arm==='old'?'advance_communication_read_legacy_fixture':arm==='control'?'advance_communication_read_control_fixture':'advance_communication_read'}(${literal(w)},${literal(kind)},${literal(conversation)},${literal(message)})`
const table=kind=>kind==='client'?'communication_read_cursors':'workspace_native_read_cursors'
const chatColumn=kind=>kind==='client'?'relationship_id':'conversation_id'
async function reset(){await admin.query('truncate communication_read_cursors,workspace_native_read_cursors,fixture_cursor_writes')}
const writes=()=>admin.json('select to_json(count(*)) from fixture_cursor_writes')
const current=kind=>admin.json(`select jsonb_build_object('id',last_read_message_id,'at',last_read_at) from ${table(kind)} where user_id=${literal(me)} and ${chatColumn(kind)}=${literal(kind==='client'?client:native)}`)
try{
 for(const relative of ['scripts/validate-communication-read-postgres.mjs','scripts/communication-read-efficiency-fixture.mjs','supabase/migrations/20261010120000_communication_read_efficiency.sql','supabase/migrations/20260917140000_communications_unread_state.sql','supabase/migrations/20260821120000_account_system_v2.sql','supabase/migrations/20260821150000_encrypted_communications.sql','supabase/migrations/20260909100000_client_delivery_teams.sql','supabase/migrations/20260925120000_preserve_chat_read_positions.sql','supabase/migrations/20260911010000_native_communications_inbox.sql'])sources[relative]=createHash('sha256').update(await readFile(path.join(root,relative))).digest('hex')
 execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fixture_owner','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C'],{env:childEnv,stdio:'pipe',timeout:20000})
 startAttempted=true
 execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(temporary,'server.log'),'-o',`-k ${socket} -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=16MB`,'-w','-t','15','start'],{env:childEnv,stdio:'pipe',timeout:20000})
 serverStarted=true;admin=await connect('admin')
 observations.push({name:'runtime',version:await admin.json('select to_json(version())'),tcpListeners:await admin.json("select to_json(current_setting('listen_addresses'))"),fixture:'Fresh private UNIX socket cluster; synthetic accounts/messages; exact canonical policies'})
 await admin.query(await readEfficiencyFixtureSql())
 const oldBody=(await baselineReadDefinition()).replace('public.advance_communication_read(','public.advance_communication_read_legacy_fixture(')
 await admin.query(`${oldBody}\nrevoke all on function public.advance_communication_read_legacy_fixture(uuid,text,uuid,uuid) from public,anon,service_role;grant execute on function public.advance_communication_read_legacy_fixture(uuid,text,uuid,uuid) to authenticated;`)
 const before=await admin.json("select jsonb_build_object('oid',oid,'definer',prosecdef,'config',proconfig) from pg_proc where oid='public.advance_communication_read(uuid,text,uuid,uuid)'::regprocedure")
 await admin.query(await readEfficiencyMigration())
 const after=await admin.json("select jsonb_build_object('oid',oid,'definer',prosecdef,'config',proconfig) from pg_proc where oid='public.advance_communication_read(uuid,text,uuid,uuid)'::regprocedure")
 assert.deepEqual(after,before,'In-place replacement preserves identity and security configuration')
 for(const role of ['anon','service_role','authenticated'])assert.equal(await admin.json(`select to_json(has_function_privilege(${literal(role)},'public.advance_communication_read(uuid,text,uuid,uuid)','execute'))`),role==='authenticated')
 pass('exact efficiency migration preserves RPC identity, definer configuration and authenticated-only grants')
 await admin.query(`create table fixture_cursor_writes(kind text,operation text,message_id uuid);create function fixture_audit_cursor() returns trigger language plpgsql as $$begin insert into public.fixture_cursor_writes values(TG_TABLE_NAME,TG_OP,new.last_read_message_id);return new;end$$;create trigger fixture_client_write after insert or update on communication_read_cursors for each row execute function fixture_audit_cursor();create trigger fixture_native_write after insert or update on workspace_native_read_cursors for each row execute function fixture_audit_cursor();
 insert into client_messages values('${id(102)}','${w}','${client}','inbound','2026-10-09 10:00:00.123457+00');insert into workspace_native_messages values('${id(202)}','${w}','${native}','${other}','2026-10-09 10:00:00.123457+00');
 insert into relationships values('${id(3000)}','${w}','${me}',null,'active');insert into client_messages values('${id(3010)}','${w}','${id(3000)}','inbound','2026-10-09 11:00:00+00');
 insert into workspace_native_conversations values('${id(4000)}','${w}','direct',null);insert into workspace_native_conversation_participants values('${id(4000)}','${me}');insert into workspace_native_messages values('${id(4010)}','${w}','${id(4000)}','${other}','2026-10-09 11:00:00+00');`)
 for(const kind of ['client','native']){
  const conversation=kind==='client'?client:native,base=kind==='client'?100:200
  for(const firstArm of ['old','new'])for(const waitingArm of ['old','new'])for(const scenario of ['older','equal','newer-tie']){
   await reset();const first=await connect('first',true),waiting=await connect('waiting',true)
   try{
    const firstId=id(base+1),waitingId=id(base+(scenario==='older'?0:scenario==='equal'?1:2)),expected=scenario==='newer-tie'?waitingId:firstId
    await first.json(`begin;${rpc(firstArm,kind,conversation,firstId)}`)
    const pending=waiting.json(rpc(waitingArm,kind,conversation,waitingId));pending.catch(()=>{})
    const locks=await waitAdvisory(waiting);await first.query('commit');const acknowledged=await pending
    assert.equal(acknowledged.lastReadMessageId,expected);assert.equal((await current(kind)).id,expected)
    assert.equal(await writes(),scenario==='newer-tie'?2:1,'Older/equal readers must not write duplicate receipt rows')
    pass(`${kind}: ${firstArm}/${waitingArm} ${scenario} reader waits then acknowledges committed maximum`,{writes:scenario==='newer-tie'?2:1,locks})
   }finally{await Promise.allSettled([first.close(),waiting.close()])}
  }
  await reset();const holder=await connect('rollback_holder',true),waiting=await connect('rollback_waiter',true)
  try{await holder.json(`begin;${rpc('new',kind,conversation,id(base+1))}`);const pending=waiting.json(rpc('old',kind,conversation,id(base)));pending.catch(()=>{});await waitAdvisory(waiting);await holder.query('rollback');const acknowledged=await pending;assert.equal(acknowledged.lastReadMessageId,id(base));assert.equal((await current(kind)).id,id(base));assert.equal(await writes(),1);pass(`${kind}: rollback releases lock and exposes no rolled-back read`)}finally{await Promise.allSettled([holder.close(),waiting.close()])}
  await reset();const held=await connect('cancel_holder',true),cancelled=await connect('cancel_waiter',true)
  try{await held.json(`begin;${rpc('old',kind,conversation,id(base+1))}`);const rejected=assert.rejects(cancelled.json(rpc('new',kind,conversation,id(base))),error=>error.sqlstate==='57014');await waitAdvisory(cancelled);assert.equal(await admin.json(`select to_json(pg_cancel_backend(${cancelled.pid}))`),true);await rejected;await held.query('commit');const retry=await connect('retry',true);try{assert.equal((await retry.json(rpc('new',kind,conversation,id(base)))).lastReadMessageId,id(base+1))}finally{await retry.close()}assert.equal(await writes(),1);pass(`${kind}: cancelled wait adds no write and a later retry recovers`)}finally{await Promise.allSettled([held.close(),cancelled.close()])}
  await reset();const locked=await connect('independent_holder',true),independent=await connect('independent_reader',true)
  try{await locked.json(`begin;${rpc('new',kind,conversation,id(base+1))}`);const otherConversation=id(kind==='client'?3000:4000),otherMessage=id(kind==='client'?3010:4010);await independent.query("set lock_timeout='500ms'");assert.equal((await independent.json(rpc('new',kind,otherConversation,otherMessage))).lastReadMessageId,otherMessage);await locked.query('commit');assert.equal(await writes(),2);pass(`${kind}: a held chat read does not block an unrelated chat`)}finally{await Promise.allSettled([locked.close(),independent.close()])}
 }
 assert.equal(results.length,31)
 // Matched warm SQL execution, with resets outside EXPLAIN and the fixture-only
 // audit triggers disabled. The unchanged control measures run/clock variation;
 // it never permits a slower candidate or substitutes for production latency.
 await admin.query(`${(await baselineReadDefinition()).replace('public.advance_communication_read(','public.advance_communication_read_control_fixture(')}
 revoke all on function public.advance_communication_read_control_fixture(uuid,text,uuid,uuid) from public,anon,service_role;grant execute on function public.advance_communication_read_control_fixture(uuid,text,uuid,uuid) to authenticated;
 alter table communication_read_cursors disable trigger fixture_client_write;alter table workspace_native_read_cursors disable trigger fixture_native_write;analyze;`)
 const measured=await connect('timing',true),sampleCount=120,warmups=12,timings=[]
 const statistics=values=>{const sorted=[...values].sort((a,b)=>a-b);return {n:sorted.length,median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],min:sorted[0],max:sorted.at(-1)}}
 try{
  for(const kind of ['client','native'])for(const scenario of ['advance','older','duplicate']){
   const conversation=kind==='client'?client:native,base=kind==='client'?100:200,prior=id(base+(scenario==='advance'?0:1)),target=id(base+(scenario==='older'?0:1)),samples={old:[],control:[],new:[]}
   for(let n=0;n<sampleCount+warmups;n++)for(const arm of n%2?['new','control','old']:['old','control','new']){
    await admin.query(`insert into public.${table(kind)}(workspace_id,${chatColumn(kind)},user_id,last_read_message_id,last_read_at) values('${w}','${conversation}','${me}','${prior}','2026-10-09 12:00:00+00') on conflict(${kind==='client'?'workspace_id,':''}${chatColumn(kind)},user_id) do update set last_read_message_id=excluded.last_read_message_id,last_read_at=excluded.last_read_at`)
    const plan=JSON.parse((await measured.query(`explain (analyze,format json) ${rpc(arm,kind,conversation,target)}`)).join('\n'))
    const elapsed=plan[0]['Execution Time'];assert.ok(Number.isFinite(elapsed)&&elapsed>=0)
    if(n>=warmups)samples[arm].push(elapsed)
   }
   timings.push({kind,scenario,latencyMs:Object.fromEntries(Object.entries(samples).map(([arm,values])=>[arm,statistics(values)]))})
  }
 }finally{await measured.close()}
 observations.push({name:'matched_warm_read_sql',sampleCount,warmups,timings,limits:'Server EXPLAIN ANALYZE execution time in milliseconds. Alternating prior/control/candidate definitions; setup outside timing; synthetic audit triggers disabled; small warm fixture. Not HTTP, production load or a tolerance for slower paths.'})
 outcome='passed'
}finally{
 await Promise.allSettled([...sessions].map(session=>session.close()))
 let stopped=!startAttempted
 if(startAttempted){try{execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','-t','10','stop'],{env:childEnv,stdio:'pipe',timeout:15000});stopped=true}catch{try{execFileSync(path.join(bin,'pg_ctl'),['-D',data,'status'],{env:childEnv,stdio:'pipe',timeout:5000})}catch(error){if(error.status===3)stopped=true}}}
 const report={outcome,passed:results.length,productionCalls:0,externalDeliveryCalls:0,serverStarted,serverStopped:stopped,sources,results,observations,limits:'Exact SQL bodies and canonical policy functions in synthetic PostgreSQL. Independent sessions prove lock schedules and committed results; not production latency, sustained load, authenticated UI or physical-device evidence.'}
 if(evidencePath)await writeFile(evidencePath,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({outcome,passed:results.length,serverStopped:stopped,evidencePath:evidencePath??null}))
 if(stopped)await rm(temporary,{recursive:true,force:true});else throw Error(`Fixture server shutdown unconfirmed; retained ${temporary}`)
}
