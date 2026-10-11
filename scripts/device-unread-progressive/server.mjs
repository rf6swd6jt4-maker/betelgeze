// Isolated loopback HTTP harness. Never loads credentials or connects to production.
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { performance } from 'node:perf_hooks'
import { createProgressiveDatabase } from './sql-fixture.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function startProgressiveServer({ build, chats=200, backlog=100 }={}) {
  const fixture = await createProgressiveDatabase({ chats, backlog })
  const runs = new Map()
  let tail = Promise.resolve()
  const serial = work => { const pending=tail.then(work);tail=pending.catch(()=>{});return pending }
  const stats = () => ({ requests:[], rawBytes:0, compressedBytes:0, requestBodyBytes:0, reads:0, summaries:0, batches:0, histories:0, dbMs:0 })
  const parsedBody = async req => { const chunks=[];let total=0;for await(const c of req){total+=c.length;if(total>100000)throw Error('Request too large');chunks.push(c)}const raw=Buffer.concat(chunks).toString();return { raw, value:raw?JSON.parse(raw):{} } }
  const cursorFor = async (run, kind, conversationId) => {
    if(run.mode==='device') { const rows=await fixture.batch({kind,conversationIds:[conversationId],deviceId:run.deviceId});return rows.items[0]?.deviceCursor??null }
    const table=kind==='client'?'communication_read_cursors':'workspace_native_read_cursors',key=kind==='client'?'relationship_id':'conversation_id'
    const row=(await fixture.db.query(`select last_read_message_id as "lastReadMessageId",last_read_at::text as "lastReadAt" from ${table} where workspace_id=$1 and user_id=$2 and ${key}=$3`,[fixture.ids.w,fixture.ids.me,conversationId])).rows[0]
    return row??null
  }
  const ownedItem = (row,kind) => ({ id:row.conversationId,kind:row.kind??kind,conversationId:row.conversationId,cursorKnown:true,deviceCursor:row.deviceCursor??row.cursor??null,preview:row.preview??null })
  const dbWork = (run,work) => serial(async()=>{
    await fixture.setClaims({...fixture.claims,session_id:run.sessionId})
    const start=performance.now();try{return await work()}finally{run.stats.dbMs+=performance.now()-start}
  })
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1')
    const cookie=(req.headers.cookie??'').match(/be_fixture=([^;]+)/)?.[1]
    let run=runs.get(cookie)
    try {
      if(url.pathname==='/fixture/reset') {
        const {value}=await parsedBody(req)
        const key=String(value.run??'run');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(key))throw Error('Invalid fixture run')
        const mode=value.mode==='device'?'device':'baseline',kind=value.kind==='client'?'client':'native'
        const deviceB=value.device==='B'
        run={key,mode,kind,deviceId:deviceB?fixture.ids.deviceB:fixture.ids.deviceA,sessionId:deviceB?fixture.ids.sessionB:fixture.ids.sessionA,latencyMs:Math.min(3000,Math.max(0,Number(value.latencyMs??value.network?.rttMs)||0)),bytesPerSecond:Math.max(0,Number(value.bytesPerSecond??value.network?.bytesPerSecond)||0),stats:stats(),failRead:Boolean(value.failRead),loseAck:Boolean(value.lostAck??value.loseAck),failBatch:Boolean(value.failPreview??value.failBatch),offline:false,holdReadMs:0,holdPreviewMs:0,nextTransferAt:0}
        runs.set(key,run)
        await serial(async()=>{await fixture.setClaims({...fixture.claims,session_id:run.sessionId});if(!value.preserve)await fixture.resetReads({accountAhead:value.accountAhead===true});if(mode==='device')await fixture.rpc('initialize_communication_device_scope',[fixture.ids.w,fixture.ids.me,run.deviceId])})
        res.setHeader('Set-Cookie',`be_fixture=${key}; HttpOnly; SameSite=Lax; Path=/`)
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({run:key,mode,kind}));return
      }
      if(url.pathname==='/' || url.pathname==='/bundle.js') {
        res.setHeader('Content-Type',url.pathname==='/'?'text/html':'text/javascript')
        const payload=url.pathname==='/'?build.html:build.bundle
        const bytes=Buffer.isBuffer(payload)?payload:Buffer.from(payload)
        const packed=gzipSync(bytes);res.setHeader('Content-Encoding','gzip');res.end(packed);return
      }
      if(!run) {res.statusCode=401;res.end('{"error":"Initialize the synthetic fixture first"}');return}
      if(url.pathname==='/fixture/metrics') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(run.stats));return}
      if(url.pathname==='/fixture/control') {
        const {value}=await parsedBody(req)
        for(const name of ['failRead','loseAck','failBatch','offline'])if(typeof value[name]==='boolean')run[name]=value[name]
        if(value.failPreview!==undefined)run.failBatch=Boolean(value.failPreview)
        if(value.lostAck!==undefined)run.loseAck=Boolean(value.lostAck)
        for(const name of ['holdReadMs','holdPreviewMs'])if(value[name]!==undefined)run[name]=Math.min(10000,Math.max(0,Number(value[name])||0))
        if(value.clearMetrics)run.stats=stats()
        res.end('{"ok":true}');return
      }
      const start=performance.now(), {raw,value}=req.method==='POST'?await parsedBody(req):{raw:'',value:{}}
      run.stats.requestBodyBytes+=Buffer.byteLength(raw)
      if(run.latencyMs)await pause(run.latencyMs/2)
      let result
      if(run.offline) {res.statusCode=503;result={error:'Synthetic offline state'}}
      else if(url.pathname==='/fixture/bootstrap') {
        result=await dbWork(run,async()=>{
          const conversations=fixture.conversations.filter(c=>c.kind===run.kind).map(c=>({id:c.id,kind:c.kind,name:c.name}))
          const id=conversations[0].id
          const messages=(await fixture.history({kind:run.kind,conversationId:id,limit:run.kind==='client'?500:60})).reverse()
          const cursor=await cursorFor(run,run.kind,id)
          if(run.mode==='baseline') {
            const inbox=await fixture.baselineInbox({kind:run.kind})
            return {conversations,previews:inbox.items.map(x=>ownedItem(x,run.kind)),selected:{id,messages,cursor,cursorKnown:true},unreadMetadata:inbox.unread??[],loadedMessages:run.kind==='client'?(inbox.messages??[]):[]}
          }
          const latest=messages.at(-1)??null
          return {conversations,previews:[{id,kind:run.kind,conversationId:id,preview:latest,cursorKnown:true,deviceCursor:cursor}],selected:{id,messages,cursor,cursorKnown:true}}
        })
      } else if(url.pathname==='/fixture/previews') {
        run.stats.batches++
        if(run.holdPreviewMs)await pause(run.holdPreviewMs)
        if(run.failBatch){res.statusCode=503;result={error:'Synthetic preview failure'}}
        else result=await dbWork(run,async()=>{
          if(!Array.isArray(value.ids)||value.ids.length>20)throw Error('Batch bound exceeded')
          if(run.mode==='device')return fixture.batch({kind:value.kind??run.kind,conversationIds:value.ids,deviceId:run.deviceId})
          const inbox=await fixture.baselineInbox({kind:value.kind??run.kind});return{items:inbox.items.filter(x=>value.ids.includes(x.conversationId)).map(x=>ownedItem(x,run.kind))}
        })
      } else if(url.pathname==='/fixture/history') {
        run.stats.histories++
        const id=url.searchParams.get('id'),kind=url.searchParams.get('kind')??run.kind
        result=await dbWork(run,async()=>({messages:(await fixture.history({kind,conversationId:id,limit:kind==='client'?500:60})).reverse(),cursor:await cursorFor(run,kind,id),cursorKnown:true}))
      } else if(url.pathname.endsWith('/communications/unread')) {
        run.stats.summaries++
        result=await dbWork(run,async()=>{const next=await fixture.summary({device:run.mode==='device',deviceId:run.deviceId});return{conversations:Array.isArray(next)?next:next.conversations}})
      } else if(url.pathname.endsWith('/read')) {
        run.stats.reads++
        if(run.holdReadMs)await pause(run.holdReadMs)
        if(run.failRead){res.statusCode=503;result={error:'Synthetic failed save'}}
        else result=await dbWork(run,async()=>{
          const kind=value.relationshipId?'client':'native',conversationId=value.relationshipId??value.conversationId
          const next=await fixture.read({device:run.mode==='device',deviceId:run.deviceId,kind,conversationId,messageId:value.messageId})
          const owned=run.mode==='device'?next.deviceCursor:next
          const cursor={...owned,userId:`fixture-user-${run.key}`,workspaceId:'fixture-workspace',kind,conversationId}
          return {cursor,accountCursor:run.mode==='device'?next.cursor:next}
        })
        if(run.loseAck && res.statusCode===200){run.loseAck=false;res.statusCode=503;result={error:'Synthetic acknowledgement lost after commit'}}
      } else if(url.pathname==='/api/communications/activity') {
        // Activity eligibility is outside this fixture; never changes account/device reads.
        result={active:Boolean(value.active),revision:value.revision,applied:true}
      } else {res.statusCode=404;result={error:'Unknown diagnostic route'}}
      const bytes=Buffer.from(JSON.stringify(result)),packed=gzipSync(bytes)
      if(run.latencyMs)await pause(run.latencyMs/2)
      if(run.bytesPerSecond){
        // Model one aggregate compressed-body budget per installation/run.
        // Whole responses are scheduled in completion order; this is not TCP.
        run.nextTransferAt=Math.max(performance.now(),run.nextTransferAt)+packed.length/run.bytesPerSecond*1000
        await pause(Math.max(0,run.nextTransferAt-performance.now()))
      }
      run.stats.rawBytes+=bytes.length;run.stats.compressedBytes+=packed.length
      run.stats.requests.push({path:url.pathname,method:req.method,status:res.statusCode,requestBytes:Buffer.byteLength(raw),rawBytes:bytes.length,compressedBytes:packed.length,durationMs:performance.now()-start})
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Encoding','gzip');res.end(packed)
    } catch(error) {res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:String(error.message)}))}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  return {url:`http://127.0.0.1:${server.address().port}`,fixture,runs,close:async()=>{await new Promise(resolve=>server.close(resolve));await tail;await fixture.close()}}
}
