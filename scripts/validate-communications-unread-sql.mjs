import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite, repositoryRoot as root } from './pglite-fixture.mjs'
const db = new PGlite()
const sql = name => readFile(`${root}/supabase/migrations/${name}`, 'utf8')
const definition = (source,name) => { const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`)); assert.ok(start>=0); return source.slice(start,source.indexOf('$$;',start)+3) }
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const [w,me,client,native,other] = [1,2,3,4,5].map(id)
try {
 await db.exec(`
 create role authenticated; create role anon; create role service_role; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$;
 create function public.current_session_is_aal2() returns boolean language sql stable as $$ select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'aal'='aal2' $$;
 create table workspace_memberships(workspace_id uuid,user_id uuid);
 create function public.is_workspace_member(w uuid) returns boolean language sql stable as $$ select exists(select 1 from public.workspace_memberships where workspace_id=w and user_id=auth.uid()) $$;
 create table relationships(id uuid primary key,workspace_id uuid,seller_user_id uuid,fulfilment_manager_user_id uuid,status text);
 create table relationship_client_chat_members(workspace_id uuid,relationship_id uuid,user_id uuid);
 create table workspace_native_conversations(id uuid primary key,workspace_id uuid,kind text,team_id uuid);
 create table workspace_native_conversation_participants(conversation_id uuid,user_id uuid);
 create table workspace_team_members(team_id uuid,user_id uuid);
 create table workspace_native_conversation_visibility(conversation_id uuid,user_id uuid,cleared_at timestamptz);
 create table client_messages(id uuid primary key,workspace_id uuid,relationship_id uuid,direction text,created_at timestamptz);
 create table workspace_native_messages(id uuid primary key,workspace_id uuid,conversation_id uuid,sender_user_id uuid,created_at timestamptz);
 create table communication_read_cursors(workspace_id uuid,relationship_id uuid,user_id uuid,last_read_message_id uuid references client_messages(id) on delete set null,last_read_at timestamptz,primary key(workspace_id,relationship_id,user_id));
 create table workspace_native_read_cursors(workspace_id uuid,conversation_id uuid,user_id uuid,last_read_message_id uuid references workspace_native_messages(id) on delete set null,last_read_at timestamptz,primary key(conversation_id,user_id));
 create index client_messages_relationship_id_idx on client_messages(relationship_id,created_at desc);
 create index native_messages_conversation_idx on workspace_native_messages(conversation_id,created_at desc);
 insert into workspace_memberships values('${w}','${me}');
 insert into relationships values('${client}','${w}','${me}',null,'active'),('${id(30)}','${w}',null,null,'active');
 insert into workspace_native_conversations values('${native}','${w}','direct',null),('${id(40)}','${w}','direct',null);
 insert into workspace_native_conversation_participants values('${native}','${me}');
 `)
 await db.exec(definition(await sql('20260821150000_encrypted_communications.sql'),'native_conversation_can_read'))
 await db.exec(definition(await sql('20260909100000_client_delivery_teams.sql'),'client_conversation_can_access'))
 await db.exec(await sql('20260917140000_communications_unread_state.sql'))
 // Only the preview decoder is adapted here; the encrypted decoder has its own
 // native-inbox fixture. Read, summary and compact unread bodies are exact SQL.
 await db.exec(`create function public.communication_native_messages_bounded(w uuid,c uuid,n integer) returns setof public.workspace_native_messages language sql stable as $$ select * from public.workspace_native_messages where workspace_id=w and conversation_id=c order by created_at desc,id desc limit n $$;`)
 await db.exec(await sql('20260911010000_native_communications_inbox.sql'))
 if (process.env.BE_READ_CURSOR_BASELINE !== '1') await db.exec(await sql('20260925120000_preserve_chat_read_positions.sql'))
 for(const role of ['anon','service_role']) for(const name of ['communication_unread_summary(uuid)','advance_communication_read(uuid,text,uuid,uuid)','communication_native_inbox(uuid)']) {
  assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`public.${name}`])).rows[0].allowed,false,`${role} cannot execute ${name}`)
 }
 const claims = async (user=me,aal='aal2') => db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated',aal})])
 await claims()
 for (let n=1;n<=5;n++) await db.exec(`insert into client_messages values('${id(100+n)}','${w}','${client}','inbound','2026-09-17 10:00:0${n}.123456+00'); insert into workspace_native_messages values('${id(200+n)}','${w}','${native}','${other}','2026-09-17 10:00:0${n}.123456+00');`)
 await db.exec(`insert into client_messages values('${id(300)}','${w}','${id(30)}','inbound',now()); insert into workspace_native_messages values('${id(400)}','${w}','${id(40)}','${other}',now());`)
 const summary = async () => (await db.query('select communication_unread_summary($1) value',[w])).rows[0].value
 const read = async (kind,c,m) => (await db.query('select advance_communication_read($1,$2,$3,$4) value',[w,kind,c,m])).rows[0].value
 assert.deepEqual((await summary()).map(x=>x.count).sort(),[5,5])
 await read('native',native,id(203)); assert.equal((await summary()).find(x=>x.kind==='native').count,2)
 await read('native',native,id(201)); assert.equal((await summary()).find(x=>x.kind==='native').count,2,'late older read cannot regress')
 await read('client',client,id(105)); assert.equal((await summary()).some(x=>x.kind==='client'),false)
 await read('native',native,id(205)); assert.deepEqual(await summary(),[])
 await db.exec(`insert into workspace_native_messages values('${id(206)}','${w}','${native}',null,'2026-09-17 10:00:05.123457+00'),('${id(207)}','${w}','${native}','${me}','2026-09-17 10:00:06+00');`)
 assert.equal((await summary())[0].count,1,'system messages count; sent messages do not')
 await read('native',native,id(206)); assert.deepEqual(await summary(),[],'microseconds preserved')
 // The original schema's real FK would erase the read UUID here. Test both
 // kinds through the production RPC, including ties, late reads and reloads.
 for (const [kind,conversation,table,cursors,key,baseId] of [
  ['client',client,'client_messages','communication_read_cursors','relationship_id',500],
  ['native',native,'workspace_native_messages','workspace_native_read_cursors','conversation_id',600],
 ]) {
  const first=id(baseId), second=id(baseId+1), third=id(baseId+2), at='2026-09-17 10:10:00.123456+00'
  const add=async(message,time=at) => db.query(kind==='client'
   ? `insert into ${table} values($1,$2,$3,'inbound',$4)`
   : `insert into ${table} values($1,$2,$3,'${other}',$4)`,[message,w,conversation,time])
  const count=async() => (await summary()).find(row=>row.kind===kind)?.count ?? 0
  const compactCount=async() => (await db.query('select communication_native_inbox($1) value',[w])).rows[0].value.unread.find(row=>row.conversation_id===native).messages.length
  await add(first); await add(second)
  await read(kind,conversation,first)
  assert.equal(await count(),1,`${kind}: same-timestamp higher ID is unread before deletion`)
  await db.query(`delete from ${table} where id=$1`,[first])
  const preserved=(await db.query(`select last_read_message_id from ${cursors} where ${key}=$1 and user_id=$2`,[conversation,me])).rows[0]
  assert.equal(preserved.last_read_message_id,first,`${kind}: deleting the message preserves the historical UUID`)
  assert.equal(await count(),1,`${kind}: deletion cannot swallow an unseen timestamp tie`)
  if(kind==='native') assert.equal(await compactCount(),1,'compact metadata agrees after deleting a read boundary')
  const confirmed=await read(kind,conversation,second)
  assert.equal(confirmed.lastReadMessageId,second,`${kind}: surviving timestamp tie is acknowledgeable`)
  assert.equal(await count(),0)
  await add(third)
  assert.equal(await count(),1,`${kind}: a later arrival at the same timestamp stays unread`)
  if(kind==='native') assert.equal(await compactCount(),1)
  const older=await read(kind,conversation,kind==='client'?id(105):id(206))
  assert.equal(older.lastReadMessageId,second,`${kind}: an older read cannot regress the retained boundary`)
  await db.query(`delete from ${table} where id=$1`,[second])
  assert.equal(await count(),1,`${kind}: a second boundary deletion retains its ordering`)
  await assert.rejects(()=>read(kind,conversation,second),`${kind}: the RPC still rejects a deleted target`)
  assert.equal((await read(kind,conversation,third)).lastReadMessageId,third)
  await db.query(`delete from ${table} where id=$1`,[third])
  assert.equal(await count(),0,`${kind}: deleting the final read message does not resurrect older history`)
  await add(id(baseId+3),'2026-09-17 10:10:00.123457+00')
  assert.equal(await count(),1,`${kind}: later microsecond remains unread`)
  await read(kind,conversation,id(baseId+3))
  // A pre-existing null cursor has no recoverable UUID. Retain its historical
  // timestamp-inclusive behavior, without guessing a missing boundary.
  await db.query(`update ${cursors} set last_read_message_id=null where ${key}=$1 and user_id=$2`,[conversation,me])
  await add(id(baseId+4),'2026-09-17 10:10:00.123457+00')
  assert.equal(await count(),0,`${kind}: legacy null boundary semantics stay unchanged`)
  if(kind==='native') assert.equal(await compactCount(),0)
  await add(id(baseId+5),'2026-09-17 10:10:00.123458+00')
  assert.equal(await count(),1)
  await read(kind,conversation,id(baseId+5))
 }
 await db.exec(`insert into client_messages select md5(n::text)::uuid,'${w}','${client}','inbound',timestamptz '2026-09-17 11:00:00'+n*interval '1 second' from generate_series(1,10000) n; analyze;`)
 const start=performance.now(); const capped=await summary(); const ms=performance.now()-start
 assert.equal(capped[0].count,100,'badge count work is bounded')
 const plan=(await db.query(`explain (analyze,format json) select id from client_messages where relationship_id=$1 and direction='inbound' and created_at>$2 order by created_at desc limit 100`,[client,'2026-09-17 10:00:05.123456Z'])).rows[0]['QUERY PLAN']
 assert.match(JSON.stringify(plan),/Index Scan/)
 await db.exec(`insert into workspace_native_conversation_visibility values('${native}','${me}','2027-01-01'); insert into workspace_native_messages values('${id(208)}','${w}','${native}','${other}','2026-09-17 12:00:00');`)
 assert.equal((await summary()).some(x=>x.kind==='native'),false,'cleared history excluded')
 for (const [user,aal] of [[me,'aal1'],[other,'aal2']]) { await claims(user,aal); await assert.rejects(summary); await assert.rejects(()=>read('client',client,id(105))) }
 await claims(); await assert.rejects(()=>read('native',id(40),id(400)))
 await assert.rejects(()=>read('client',id(30),id(300)))
 console.log(JSON.stringify({passed:true,cases:['client and native counts','unauthorized conversations','AAL2 and membership','read clearing','late older read','microseconds','system messages','own messages','cleared history','deleted read boundary for both kinds','same-timestamp later arrival','deleted target rejected','legacy null boundary compatibility','compact metadata agreement','10000-message cap','indexed range'],summaryMs:Math.round(ms),physicalDevice:false}))
} finally { await db.close() }
