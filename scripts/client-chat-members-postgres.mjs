// Private disposable PostgreSQL cluster; never connects to an existing server.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

export async function createClientChatPostgresFixture() {
    const bin=process.env.BE_CLIENT_CHAT_PG_BIN
    assert.ok(bin&&path.isAbsolute(bin),'Set BE_CLIENT_CHAT_PG_BIN to reviewed PostgreSQL binaries')
    const require=createRequire(import.meta.url)
    const {Client}=require(require.resolve('pg',{paths:[process.env.BE_PG_ROOT||process.cwd()]}))
    const root=await mkdtemp(path.join(tmpdir(),'be-client-chat-pg-'))
    const data=path.join(root,'data'),socket=path.join(root,'socket'),clients=[]
    await mkdir(socket,{mode:0o700})
    let started=false
    const close=async()=>{
        await Promise.allSettled(clients.map(client=>client.end()))
        if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop'],{stdio:'pipe'})
        await rm(root,{recursive:true,force:true})
    }
    try {
        execFileSync(path.join(bin,'initdb'),['-D',data,'--username=fixture_owner','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--locale=C'],{stdio:'pipe'})
        execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'server.log'),'-o',`-k ${socket} -p 55489 -c listen_addresses='' -c unix_socket_permissions=0700 -c max_connections=8 -c shared_buffers=16MB`,'-w','start'],{stdio:'pipe'})
        started=true
        const connect=async()=>{
            const client=new Client({host:socket,port:55489,user:'fixture_owner',database:'postgres'})
            clients.push(client)
            await client.connect()
            await client.query("set statement_timeout='15s';set lock_timeout='8s';set idle_in_transaction_session_timeout='20s'")
            return client
        }
        const client=await connect()
        return {query:client.query.bind(client),exec:client.query.bind(client),connect,close}
    } catch(error){await close();throw error}
}
