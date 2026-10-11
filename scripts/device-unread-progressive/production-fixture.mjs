// Actual candidate RPCs and canonical encrypted decoders in isolated PGlite.
// Auth claims/session tables and Vault decrypted-secret view are local adapters.
// No connection URL, credentials or external provider is accepted.
import { readFile } from 'node:fs/promises'
import { PGlite, loadPGliteExtension, repositoryRoot } from '../pglite-fixture.mjs'
import { deviceUnreadFixtureSql, deviceUnreadIds as ids, id } from './sql-base.mjs'
export { ids, id }
const migration = name => readFile(`${repositoryRoot}/supabase/migrations/${name}`,'utf8')
const definition = (source,name) => { const start=source.search(new RegExp(`create (?:or replace )?function ${name.replaceAll('.','\\.')}\\(`));if(start<0)throw Error(`Missing ${name}`);return source.slice(start,source.indexOf('$$;',start)+3) }
export async function createDeviceUnreadFixture({chats=40,backlog=100,database}={}) {
 const db=database ?? new PGlite({extensions:{pgcrypto:loadPGliteExtension('pgcrypto')}})
 await db.exec(await deviceUnreadFixtureSql({includeDeviceMigration:false}))
 await db.exec(await migration('20261010120000_communication_read_efficiency.sql'))
 await db.exec(`
 create schema extensions;create extension pgcrypto with schema extensions;create schema communications_secure;create schema vault;
 create table communications_secure.content_keys(id uuid primary key,vault_secret_id uuid);
 create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);
 insert into communications_secure.content_keys values('${id(71)}','${id(72)}');
 insert into vault.decrypted_secrets values('${id(72)}','synthetic-production-decoder-secret');
 alter table client_messages add column client_request_id uuid,add column body text,add column provider text default 'meta_whatsapp',add column provider_message_id text,add column whatsapp_message_id text,add column reply_to_whatsapp_message_id text,add column reply_to_message_id uuid,add column status text default 'received',add column error text,add column sender_kind text default 'client',add column sender_user_id uuid,add column automation_kind text,add column automation_label text,add column sent_at timestamptz,add column delivered_at timestamptz,add column read_at timestamptz,add column failed_at timestamptz,add column raw_payload jsonb,add column body_ciphertext bytea,add column raw_payload_ciphertext bytea,add column body_key_id uuid;
 alter table workspace_native_messages add column client_request_id uuid,add column sender_workspace_role text default 'staff',add column body text,add column reply_to_message_id uuid,add column attachment jsonb,add column quote jsonb,add column body_ciphertext bytea,add column attachment_ciphertext bytea,add column quote_ciphertext bytea,add column body_key_id uuid,add column edited_at timestamptz;
 create table communication_message_deliveries(workspace_id uuid,client_message_id uuid,provider text,provider_message_id text,status text,error text,sent_at timestamptz,delivered_at timestamptz,read_at timestamptz,failed_at timestamptz,created_at timestamptz default now());
 delete from communication_read_cursors;delete from workspace_native_read_cursors;delete from client_messages;delete from workspace_native_messages;delete from workspace_native_conversation_participants;delete from relationships;delete from workspace_native_conversations;
 drop function communication_native_messages_bounded(uuid,uuid,integer);
 `)
 const repaired=await migration('20260821230000_fix_communication_key_roundtrip.sql'),client=(await migration('20260909100000_client_delivery_teams.sql')).replaceAll('decrypted.secret','decrypted.decrypted_secret'),native=await migration('20260908183000_native_message_quotes.sql')
 for(const [source,name] of [[repaired,'communications_secure.try_decrypt_text'],[repaired,'communications_secure.try_decrypt_jsonb'],[client,'public.communication_client_message'],[client,'public.communication_client_messages'],[native,'public.communication_native_message'],[native,'public.communication_native_messages']])await db.exec(definition(source,name))
 await db.exec(await migration('20260910230000_bounded_communication_decoding.sql'))
 const conversations=Array.from({length:chats},(_,n)=>({id:id(1000+n),kind:n%2?'native':'client',title:`Conversation ${String(n+1).padStart(3,'0')}`,firstMessageId:id(100000+n*10000),latestMessageId:id(100000+n*10000+backlog)}))
 for(const [n,c] of conversations.entries()){
  if(c.kind==='client')await db.query("insert into relationships values($1,$2,$3,null,'active')",[c.id,ids.w,ids.me])
  else{await db.query("insert into workspace_native_conversations values($1,$2,'direct',null)",[c.id,ids.w]);await db.query('insert into workspace_native_conversation_participants values($1,$2)',[c.id,ids.me])}
  const table=c.kind==='client'?'client_messages':'workspace_native_messages',column=c.kind==='client'?'relationship_id':'conversation_id',kindcol=c.kind==='client'?'direction':'sender_user_id',kindvalue=c.kind==='client'?"'inbound'":`'${ids.other}'::uuid`
  await db.exec(`with encrypted as materialized(select extensions.pgp_sym_encrypt('Encrypted latest preview for ${c.title}', 'synthetic-production-decoder-secret') body)
   insert into ${table}(id,workspace_id,${column},${kindcol},created_at,body_ciphertext,body_key_id)
   select ('00000000-0000-4000-8000-'||lpad((${100000+n*10000}+m)::text,12,'0'))::uuid,'${ids.w}','${c.id}',${kindvalue},timestamptz '2026-10-01 00:00:00.123456+00'+m*interval '1 second',encrypted.body,'${id(71)}' from generate_series(0,${backlog})m cross join encrypted;`)
  const cursor=c.kind==='client'?'communication_read_cursors':'workspace_native_read_cursors'
  await db.query(`insert into ${cursor}(workspace_id,${column},user_id,last_read_message_id,last_read_at) values($1,$2,$3,$4,'2026-10-01 00:00:00.123456+00')`,[ids.w,c.id,ids.me,c.firstMessageId])
 }
 await db.exec(await migration('20261011120000_device_communications_progressive.sql'))
 const claims={sub:ids.me,role:'authenticated',aal:'aal2',session_id:ids.sessionA}
 const setClaims=(next=claims)=>db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(next)])
 await setClaims()
 const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result
 return {db,ids,conversations,claims,setClaims,rpc,close:()=>db.close()}
}
