import { matchingConversationPreviewIds } from '../../lib/communications/preview-search.ts'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createDeviceUnreadFixture, id } from './production-fixture.mjs'
const f=await createDeviceUnreadFixture({chats:48,backlog:105}),checks=[]
const check=(name,fn)=>{fn();checks.push(name)}
try {
 const {db,ids,conversations,rpc}=f,{w,me,deviceA,deviceB,sessionB,newDevice,newSession}=ids
 const client=conversations[0],native=conversations[1]
 const summary=(device=deviceA)=>rpc('communication_device_unread_summary',[w,device,false])
 const history=(c,device=deviceA)=>rpc('communication_device_history',[w,device,c.kind,c.id])
 const previews=(kind,list,device=deviceA)=>rpc('communication_device_preview_batch',[w,device,kind,list])
 const search=async(kind,term,after=null)=>{const result=await rpc('communication_device_preview_search',[w,deviceA,kind,term,after]);return {...result,conversationIds:matchingConversationPreviewIds(result.candidates,term)}}
 const read=(c,message=c.latestMessageId,device=deviceA)=>rpc('advance_communication_device_read',[w,device,c.kind,c.id,message])
 const reject=async(name,fn,code)=>{await assert.rejects(fn,e=>!code||e.code===code);checks.push(name)}
 let result=await summary()
 check('Counts capped at100 across both kinds',()=>assert.ok(result.conversations.length===48&&result.conversations.every(c=>c.count===100)))
 check('Count-only summary excludes cursor map',()=>assert.equal('readCursors' in result,false))
 let h=await history(client)
 check('Client encrypted selected window decodes canonical body',()=>assert.ok(h.messages[0].body.startsWith('Encrypted latest preview')))
 check('Selected client history includes explicit microsecond frontier',()=>assert.equal(h.deviceCursor.lastReadAt,'2026-10-01T00:00:00.123456+00:00'))
 check('History frontier positively known',()=>assert.equal(h.cursorKnown,true))
 let nh=await history(native)
 check('Native selected history bounded to60',()=>assert.equal(nh.messages.length,60))
 const stored=await db.query('select body,body_ciphertext from client_messages where id=$1',[client.latestMessageId])
 check('Bodies remain encrypted at rest',()=>assert.ok(stored.rows[0].body===null&&stored.rows[0].body_ciphertext))
 let p=await previews('client',conversations.filter(c=>c.kind==='client').slice(0,20).map(c=>c.id))
 check('Preview batch returns20 canonical latest messages',()=>assert.ok(p.items.length===20&&p.items.every(x=>x.preview.body&&x.cursorKnown===true)))
 await reject('21 previews denied',()=>previews('client',conversations.filter(c=>c.kind==='client').slice(0,21).map(c=>c.id)),'22023')
 await reject('Duplicate preview IDs denied',()=>previews('client',[client.id,client.id]),'22023')
 await reject('Empty preview batch denied',()=>previews('client',[]),'22023')
 await reject('Null preview ID denied',()=>previews('client',[null]),'22023')
 await reject('Invalid preview kind denied',()=>previews('other',[client.id]),'22023')
 await db.query("insert into communication_message_deliveries(workspace_id,client_message_id,provider,status) values($1,$2,'meta_whatsapp','delivered')",[w,client.latestMessageId])
 p=await previews('client',[client.id]);check('Preview retains provider delivery metadata',()=>assert.equal(p.items[0].preview.deliveries[0].status,'delivered'))
 await db.query("update workspace_native_messages set edited_at='2026-10-10T01:00:00Z' where id=$1",[native.latestMessageId])
 p=await previews('native',[native.id]);check('Preview retains native edit metadata',()=>assert.equal(p.items[0].preview.edited_at,'2026-10-10T01:00:00+00:00'))
 const roster=await rpc('communication_device_roster',[w,deviceA,'client'])
 check('Roster metadata does not contain bodies',()=>assert.ok(roster.items.length===24&&!JSON.stringify(roster).includes('Encrypted')))
 check('Roster metadata names newest tuple',()=>assert.equal(roster.items.find(x=>x.conversationId===client.id).latestMessageId,client.latestMessageId))
 let s=await search('client','ENCRYPTED');check('Search first page bounded20',()=>assert.equal(s.conversationIds.length,20));check('Search exposes bounded server-only candidate page',()=>assert.ok(s.nextCursor&&s.candidates.length===20))
 const s2=await search('client','encrypted',s.nextCursor);check('Search traverses remaining authorized roster',()=>assert.ok(s2.conversationIds.length===4&&s2.nextCursor===null));check('Search pages have no duplicate IDs',()=>assert.equal(new Set([...s.conversationIds,...s2.conversationIds]).size,24))
 s=await search('native','%');check('Search treats wildcard literally',()=>assert.equal(s.conversationIds.length,0))
 const unicode='Greek ΑΒΓ and İstanbul and ẞ'
 await db.query("update client_messages set body_ciphertext=extensions.pgp_sym_encrypt($1,'synthetic-production-decoder-secret') where id=$2",[unicode,client.latestMessageId])
 const unicodePage=await rpc('communication_device_preview_search',[w,deviceA,'client','αβγ',null])
 check('Canonical encrypted decoder returns Unicode search candidate unchanged',()=>assert.equal(unicodePage.candidates.find(x=>x.conversationId===client.id).body,unicode))
 check('Server JavaScript search matches decoded Unicode independent of DB collation',()=>assert.ok(matchingConversationPreviewIds(unicodePage.candidates,'αβγ').includes(client.id)))
 await reject('Empty search denied',()=>rpc('communication_device_preview_search',[w,deviceA,'client','',null]),'22023')
 await reject('Oversized search denied',()=>rpc('communication_device_preview_search',[w,deviceA,'client','x'.repeat(121),null]),'22023')
 let ack=await read(client)
 check('Read ACK preserves private and account positions',()=>assert.ok(ack.deviceCursor.lastReadMessageId===client.latestMessageId&&ack.cursor.lastReadMessageId===client.latestMessageId))
 check('ACK scopes private cursor to installation',()=>assert.equal(ack.deviceCursor.deviceId,deviceA))
 result=await summary();check('Read conversation absent from own nonzero summary',()=>assert.ok(!result.conversations.some(x=>x.conversationId===client.id)))
 const before=(await db.query('select xmin::text from communication_device_read_cursors where device_id=$1 and conversation_id=$2',[deviceA,client.id])).rows[0].xmin
 await read(client);const after=(await db.query('select xmin::text from communication_device_read_cursors where device_id=$1 and conversation_id=$2',[deviceA,client.id])).rows[0].xmin
 check('Duplicate ACK does not rewrite private row',()=>assert.equal(after,before))
 await f.setClaims({...f.claims,session_id:sessionB});result=await summary(deviceB);check('Sleeping known installation uses frozen cutover position',()=>assert.equal(result.conversations.find(x=>x.conversationId===client.id).count,100))
 ack=await read(client,client.firstMessageId,deviceB);check('Account ahead ACK keeps private cursor behind',()=>assert.ok(ack.cursor.lastReadMessageId===client.latestMessageId&&ack.deviceCursor.lastReadMessageId===client.firstMessageId))
 await f.setClaims();await rpc('advance_communication_read',[w,'native',native.id,native.latestMessageId]);result=await summary();check('Legacy account read cannot clear private summary',()=>assert.equal(result.conversations.find(x=>x.conversationId===native.id).count,100))
 await db.query('insert into auth.sessions values($1,$2,null)',[newSession,me]);await db.query('insert into account_session_devices values($1,$2,$3)',[newSession,me,newDevice]);await f.setClaims({...f.claims,session_id:newSession});result=await summary(newDevice)
 check('New installation inherits current shared positions once',()=>assert.ok(!result.conversations.some(x=>[client.id,native.id].includes(x.conversationId))))
 await f.setClaims();await db.exec('begin');const beforeRollback=await history(native);await read(native);await db.exec('rollback');const afterRollback=await history(native);check('Explicit rollback preserves private position',()=>assert.deepEqual(beforeRollback.deviceCursor,afterRollback.deviceCursor))
 // Force failure of the added private write; the transaction must not publish a shared read.
 const fail=conversations[2];await db.exec(`create function fail_private() returns trigger language plpgsql as $$ begin raise exception 'synthetic private failure';end $$;create trigger fail_private before insert or update on communication_device_read_cursors for each row execute function fail_private();`)
 await reject('Private write failure rejects ACK',()=>read(fail));await db.exec('drop trigger fail_private on communication_device_read_cursors;drop function fail_private()')
 const shared=(await db.query('select last_read_message_id from communication_read_cursors where relationship_id=$1',[fail.id])).rows[0]
 check('Private write failure leaves shared alert frontier unchanged',()=>assert.equal(shared.last_read_message_id,fail.firstMessageId))
 await db.query('delete from communication_device_read_cursors where device_id=$1 and conversation_id=$2',[deviceA,fail.id]);h=await history(fail);check('Missing saved position is explicitly known-null',()=>assert.ok(h.cursorKnown===true&&h.deviceCursor===null))
 await reject('Read target outside conversation denied',()=>read(fail,client.latestMessageId),'22023')
 await reject('Other installation denied under current session',()=>summary(deviceB),'P0002')
 for(const [name,claims] of [['AAL1',{...f.claims,aal:'aal1'}],['Anonymous',{...f.claims,role:'anon'}],['Missing live session',{...f.claims,session_id:id(9999)}]]){await f.setClaims(claims);await reject(`${name} rejects device summary`,()=>summary(),'42501')}
 await f.setClaims();await db.query('update auth.sessions set not_after=now()-interval \'1 second\' where id=$1',[ids.sessionA]);await reject('Expired session rejects device history',()=>history(client),'42501');await db.query('update auth.sessions set not_after=null where id=$1',[ids.sessionA])
 await db.query('update relationships set seller_user_id=null where id=$1',[fail.id]);await reject('Revoked client access rejects preview',()=>previews('client',[fail.id]),'42501');await reject('Revoked client access rejects history',()=>history(fail),'42501');await reject('Revoked client access rejects read',()=>read(fail),'42501')
 await db.query('delete from workspace_native_conversation_participants where conversation_id=$1',[native.id]);await reject('Revoked native access rejects preview',()=>previews('native',[native.id]),'42501');await db.query('insert into workspace_native_conversation_participants values($1,$2)',[native.id,me])
 await db.query('insert into workspace_native_conversation_visibility values($1,$2,now())',[native.id,me]);p=await previews('native',[native.id]);check('Cleared native history has confirmed empty preview',()=>assert.equal(p.items[0].preview,null));result=await summary();check('Cleared native history excluded from counts',()=>assert.ok(!result.conversations.some(x=>x.conversationId===native.id)))
 await db.exec('set role authenticated');await reject('Private cursor table inaccessible directly',()=>db.query('select * from communication_device_read_cursors'),'42501');await db.exec('reset role')
 await db.query('delete from workspace_memberships where workspace_id=$1 and user_id=$2',[w,me]);await reject('Workspace revocation rejects search',()=>rpc('communication_device_preview_search',[w,deviceA,'client','encrypted',null]),'42501')
 const report={checks,assertions:checks.length,failures:0,implementation:'20261011120000_device_communications_progressive.sql',encryption:'Real pgcrypto and canonical installed-source decoders',limitations:['Single PGlite connection; native PostgreSQL concurrent sessions, WAL and durability remain separate','JWT/session and Vault decrypted-secret view are synthetic adapters; this is not live Supabase authentication']}
 await writeFile(process.argv[2]||'/private/tmp/device-unread-production-sql.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
} finally {await f.close()}
