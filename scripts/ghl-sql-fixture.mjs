// Optional native PostgreSQL uses a new socket-only cluster, never a supplied URL.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
export { repositoryRoot } from './pglite-fixture.mjs'
export async function createGhlFixture() {
 if (process.env.BE_GHL_NATIVE_PG !== '1') {
  const { PGlite, loadPGliteExtension } = await import('./pglite-fixture.mjs')
  return new PGlite({extensions:{pgcrypto:loadPGliteExtension('pgcrypto')}})
 }
 const bin=process.env.BE_RECORDS_PG_BIN
 assert.ok(bin && path.isAbsolute(bin),'Reviewed PostgreSQL binary directory is required')
 const require=createRequire(import.meta.url)
 const {Client}=require(require.resolve('pg',{paths:[process.env.BE_PG_ROOT||process.cwd()]}))
 const root=await mkdtemp(path.join(tmpdir(),'be-ghl-pg-')),data=path.join(root,'data'),socket=path.join(root,'socket')
 await mkdir(socket,{mode:0o700})
 const clients=[];let started=false
 const close=async()=>{
  await Promise.allSettled(clients.map(c=>c.end()))
  if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{stdio:'pipe'})
  await rm(root,{recursive:true,force:true})
 }
 try {
  execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fixture_owner','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C'],{stdio:'pipe'})
  execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'server.log'),'-o',`-k ${socket} -p 55488 -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=8 -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'});started=true
  const connect=async()=>{
   const client=new Client({host:socket,port:55488,user:'fixture_owner',database:'postgres'})
   await client.connect();clients.push(client)
   await client.query("set statement_timeout='15s';set lock_timeout='10s';select set_config('request.jwt.claim.role','service_role',false);select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)")
   client.pid=(await client.query('select pg_backend_pid() pid')).rows[0].pid
   return client
  }
  const admin=await connect()
  return {query:(...args)=>admin.query(...args),exec:text=>admin.query(text),close,connect,
   waitLock:async client=>{const deadline=Date.now()+4000;while(Date.now()<deadline){if((await admin.query('select exists(select 1 from pg_locks where pid=$1 and not granted) waiting',[client.pid])).rows[0].waiting)return;await new Promise(r=>setTimeout(r,10))}throw Error('Expected independent session lock wait was not observed')}}
 } catch(error) {await close();throw error}
}
