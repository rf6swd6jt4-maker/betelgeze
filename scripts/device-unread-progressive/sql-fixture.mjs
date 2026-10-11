// Bounded isolated diagnostic database, never accepts a connection URL.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PGlite, repositoryRoot } from '../pglite-fixture.mjs'
import { deviceUnreadFixtureSql, deviceUnreadIds as ids, id } from './sql-base.mjs'
export { ids, id }
const uuid = text => { const h=createHash('md5').update(text).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}` }
export async function createProgressiveDatabase({chats=200,devices=1,backlog=100,messagesPerChat=backlog+1}={}) {
 const db=new PGlite();await db.exec(await deviceUnreadFixtureSql({includeDeviceMigration:false}))
 await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261010120000_communication_read_efficiency.sql`,'utf8'))
 await db.exec(`alter table client_messages add column body text not null default 'Synthetic preview body';alter table workspace_native_messages add column body text not null default 'Synthetic preview body';
 delete from communication_read_cursors; delete from workspace_native_read_cursors;delete from client_messages;delete from workspace_native_messages;delete from workspace_native_conversation_participants;delete from relationships;delete from workspace_native_conversations;`)
 const conversations=[]
 for(let n=0;n<chats;n++){const kind=n%2?'native':'client',cid=uuid(`progressive-chat-${n}`);conversations.push({id:cid,kind,name:`Conversation ${String(n+1).padStart(4,'0')}`,latestMessageId:uuid(`progressive-message-${n}-${messagesPerChat}`),firstMessageId:uuid(`progressive-message-${n}-1`)})}
 await db.exec(`insert into relationships select md5('progressive-chat-'||n)::uuid,'${ids.w}','${ids.me}',null,'active' from generate_series(0,${chats-1})n where n%2=0;
 insert into workspace_native_conversations select md5('progressive-chat-'||n)::uuid,'${ids.w}','direct',null from generate_series(0,${chats-1})n where n%2=1;
 insert into workspace_native_conversation_participants select id,'${ids.me}' from workspace_native_conversations;
 insert into client_messages select md5('progressive-message-'||n||'-'||m)::uuid,'${ids.w}',md5('progressive-chat-'||n)::uuid,'inbound',timestamptz '2026-10-01 00:00:00.123456+00'+m*interval '1 second',left(repeat('Synthetic preview body ',8),120) from generate_series(0,${chats-1})n cross join generate_series(1,${messagesPerChat})m where n%2=0;
 insert into workspace_native_messages select md5('progressive-message-'||n||'-'||m)::uuid,'${ids.w}',md5('progressive-chat-'||n)::uuid,'${ids.other}',timestamptz '2026-10-01 00:00:00.123456+00'+m*interval '1 second',left(repeat('Synthetic preview body ',8),120) from generate_series(0,${chats-1})n cross join generate_series(1,${messagesPerChat})m where n%2=1;
 insert into communication_read_cursors select '${ids.w}',r.id,'${ids.me}',m.id,m.created_at from relationships r join client_messages m on m.relationship_id=r.id and m.created_at=timestamptz '2026-10-01 00:00:01.123456+00';
 insert into workspace_native_read_cursors select '${ids.w}',r.id,'${ids.me}',m.id,m.created_at from workspace_native_conversations r join workspace_native_messages m on m.conversation_id=r.id and m.created_at=timestamptz '2026-10-01 00:00:01.123456+00';`)
 await db.exec(await readFile(new URL('./sql-held-device.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('./sql-preview.sql',import.meta.url),'utf8'))
 const claims={sub:ids.me,role:'authenticated',aal:'aal2',session_id:ids.sessionA}
 async function setClaims(next=claims){await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(next)])}
 await setClaims()
 // Populate initialized retained scopes with the same cutover baseline.
 await db.exec(`select initialize_communication_device_scope('${ids.w}','${ids.me}','${ids.deviceA}');
 insert into communication_device_read_scopes(workspace_id,user_id,device_id) select '${ids.w}','${ids.me}',md5('progressive-device-'||n)::uuid from generate_series(2,${devices})n;
 insert into communication_device_read_cursors select '${ids.w}','${ids.me}',md5('progressive-device-'||n)::uuid,b.kind,b.conversation_id,b.last_read_message_id,b.last_read_at from communication_read_cutover_baselines b cross join generate_series(2,${devices})n;
 analyze;`)
 const rpc=async(fn,args)=>(await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result
 const summary=({device=true,deviceId=ids.deviceA}={})=>device?rpc('communication_device_unread_summary',[ids.w,deviceId,false]):rpc('communication_unread_summary',[ids.w])
 const batch=({conversationIds,kind,deviceId=ids.deviceA})=>rpc('diagnostic_device_preview_batch',[ids.w,deviceId,kind,conversationIds])
 const read=({device=true,kind,conversationId,messageId,deviceId=ids.deviceA})=>device?rpc('advance_communication_device_read',[ids.w,deviceId,kind,conversationId,messageId]):rpc('advance_communication_read',[ids.w,kind,conversationId,messageId])
 const history=async({kind,conversationId,limit=60})=>{const bounded=Math.min(kind==='client'?500:60,Math.max(1,limit));if(!conversations.some(c=>c.kind===kind&&c.id===conversationId))throw Error('Unauthorized diagnostic history');const table=kind==='client'?'client_messages':'workspace_native_messages',key=kind==='client'?'relationship_id':'conversation_id';return(await db.query(`select id,created_at::text as "createdAt",body from ${table} where workspace_id=$1 and ${key}=$2 order by created_at desc,id desc limit $3`,[ids.w,conversationId,bounded])).rows}
 // Canonical SQL inbox shape, synthetic body projection; production decrypt CPU excluded.
 const baselineInbox=async({kind})=>{
  const native=kind==='native',ct=native?'workspace_native_read_cursors':'communication_read_cursors',key=native?'conversation_id':'relationship_id'
  const cursors=(await db.query(`select ${key} as "conversationId",last_read_at::text as "lastReadAt",last_read_message_id as "lastReadMessageId" from ${ct} where workspace_id=$1 and user_id=$2`,[ids.w,ids.me])).rows
  let messages,unread
  if(native){const inbox=await rpc('communication_native_inbox',[ids.w]);messages=inbox.messages;unread=inbox.unread}
  else{messages=(await db.query('select id,workspace_id,relationship_id,direction,created_at::text as created_at,body from client_messages where workspace_id=$1 order by created_at desc,id desc limit 2000',[ids.w])).rows;unread=undefined}
  const previews=new Map();for(const m of messages){const cid=m[key];if(!previews.has(cid))previews.set(cid,m)}
  const cursorById=new Map(cursors.map(c=>[c.conversationId,c]))
  const items=conversations.filter(c=>c.kind===kind).map(c=>{const p=previews.get(c.id);return {kind,conversationId:c.id,cursorKnown:true,cursor:cursorById.get(c.id)||null,preview:p?{id:p.id,createdAt:typeof p.created_at==='string'?p.created_at:p.created_at.toISOString(),body:p.body}:null}})
  return {items,messages,unread,cursors}
 }

 const setAccountAhead=()=>db.exec(`update communication_read_cursors c set last_read_message_id=m.id,last_read_at=m.created_at from client_messages m where m.relationship_id=c.relationship_id and m.created_at=timestamptz '2026-10-01 00:00:00.123456+00'+${messagesPerChat}*interval '1 second';update workspace_native_read_cursors c set last_read_message_id=m.id,last_read_at=m.created_at from workspace_native_messages m where m.conversation_id=c.conversation_id and m.created_at=timestamptz '2026-10-01 00:00:00.123456+00'+${messagesPerChat}*interval '1 second';`)
 const resetReads=async({accountAhead=false}={})=>{await db.exec(`update communication_read_cursors c set last_read_message_id=b.last_read_message_id,last_read_at=b.last_read_at from communication_read_cutover_baselines b where b.kind='client' and b.conversation_id=c.relationship_id;
 update workspace_native_read_cursors c set last_read_message_id=b.last_read_message_id,last_read_at=b.last_read_at from communication_read_cutover_baselines b where b.kind='native' and b.conversation_id=c.conversation_id;
 update communication_device_read_cursors c set last_read_message_id=b.last_read_message_id,last_read_at=b.last_read_at from communication_read_cutover_baselines b where b.kind=c.kind and b.conversation_id=c.conversation_id;`);if(accountAhead)await setAccountAhead()}
 return {resetReads,db,ids,conversations,rpc,summary,batch,read,history,baselineInbox,setAccountAhead,setClaims,claims,close:()=>db.close()}
}
