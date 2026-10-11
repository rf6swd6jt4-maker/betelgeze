import {matchingConversationPreviewIds} from '../../lib/communications/preview-search.ts'
// Sequential, bounded synthetic performance evidence for the actual candidate.
// No credentials, connection URL, external services or production data.
import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {execFileSync} from 'node:child_process'
import {performance} from 'node:perf_hooks'
import {createDeviceUnreadFixture} from './production-fixture.mjs'
const samples=Number(process.env.BE_DEVICE_SQL_SAMPLES??30)
if(!Number.isInteger(samples)||samples<5||samples>100)throw Error('Samples must be5-100 (default30)')
const warmups=4,round=n=>Math.round(n*1000)/1000
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,medianMs:round(sorted[Math.floor(sorted.length/2)]),p95Ms:round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]),minMs:round(sorted[0]),maxMs:round(sorted.at(-1))}}
const bytes=value=>{const data=Buffer.from(JSON.stringify(value));return {jsonBytes:data.length,gzipBytes:gzipSync(data).length}}
const sourceFiles=['lib/communications/preview-search.ts','app/api/workspaces/[workspaceSlug]/communications/search/route.ts','supabase/migrations/20261011120000_device_communications_progressive.sql','supabase/migrations/20261010120000_communication_read_efficiency.sql','supabase/migrations/20260910230000_bounded_communication_decoding.sql','scripts/device-unread-progressive/production-fixture.mjs','scripts/device-unread-progressive/production-measure.mjs']
const sources=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])))
const report={startedAt:new Date().toISOString(),node:process.version,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources,samples,warmups,datasets:[],limits:[
 'SQL execution-only values use EXPLAIN(ANALYZE,FORMAT JSON) Execution Time, matching the prior diagnostic method. RPC wall values include JS/PGlite result bridging and must not be compared directly with prior execution-only ~0.05ms read overhead.',
 'Actual checked-in candidate RPCs, current shared read/summary SQL and canonical pgcrypto encrypted decoders; synthetic Auth/session and Vault decrypted-secret adapters.',
 'All fixture tables receive ANALYZE before timing. Query planner statistics are local synthetic statistics, not production plans.',
 'One PGlite connection on this machine. Timings include local driver/JSON result decoding; exclude network, Supabase authorization latency, concurrent production load, WAL durability and replication.',
 'Each read/init observation is a transaction rolled back after timing. BEGIN/ROLLBACK and case setup are excluded; storage is captured fresh before that churn.',
 'The account-ahead comparison invokes both RPCs. The existing UI can omit its account save entirely, so these figures cannot price its zero-to-network change.',
 'Synthetic repeated plaintext compresses strongly. Gzip is response-body serialization only; it excludes request headers, TLS and transport.',
 'Search RPC transfers bounded candidate bodies from database to application server. JavaScript matches existing UI case folding; the browser receives IDs only. SQL execution excludes JavaScript matching; all-page wall measurements include it.',
 'A search page scans at most20 authorized latest previews. All-page search is explicit user work and remains linear in conversation count; no latency ceiling is claimed.',
 'Server wall clock, database execution and browser end-to-end latency are different measurements. These results do not replace matched full-app browser measurements or deployment approval.',
]}
async function observe(fn){const start=performance.now();const value=await fn();return {ms:performance.now()-start,value}}
async function measure(fn){const values=[];let result;for(let n=-warmups;n<samples;n++){const sample=await observe(fn);if(n>=0)values.push(sample.ms);result=sample.value}return {...stats(values),...bytes(result),result}}
async function paired(before,after){const a=[],b=[];let av,bv;for(let n=-warmups;n<samples;n++){const order=n%2===0?[[before,a,'a'],[after,b,'b']]:[[after,b,'b'],[before,a,'a']];for(const[fn,list,key]of order){const sample=await fn();if(n>=0)list.push(sample.ms);if(key==='a')av=sample.value;else bv=sample.value}}return {account:{...stats(a),...bytes(av)},device:{...stats(b),...bytes(bv)},medianDeltaMs:round(stats(b).medianMs-stats(a).medianMs)}}
for(const chats of [100,1000]){
 const started=performance.now();console.log(JSON.stringify({phase:'fixture',chats,samples}));const f=await createDeviceUnreadFixture({chats,backlog:100})
 try{
  const{db,ids,conversations,rpc}=f,{w,me,deviceA,deviceB,sessionB,newDevice,newSession}=ids
  await db.exec('analyze')
  const c=conversations.find(x=>x.kind==='client'),n=conversations.find(x=>x.kind==='native')
  const storageTables=['communication_read_cutover_installations','communication_read_cutover_baselines','communication_device_read_scopes','communication_device_read_cursors']
  const storage=async()=>{const relations=(await db.query(`select relname,pg_total_relation_size(oid)::bigint::text bytes from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[]) order by relname`,[storageTables])).rows;return {relations,totalRelationBytes:relations.reduce((sum,row)=>sum+Number(row.bytes),0),initializedDevices:(await db.query('select count(*)::int n from communication_device_read_scopes')).rows[0].n,deviceRows:(await db.query('select count(*)::int n from communication_device_read_cursors')).rows[0].n}}
  const data={chats,clientChats:chats/2,nativeChats:chats/2,messagesPerChat:101,backlogPerChat:100,fixtureMs:round(performance.now()-started),storageAtCutover:await storage(),reads:{},operations:{},initialization:{}}
  await rpc('initialize_communication_device_scope',[w,me,deviceA]);data.storageOneInitializedDevice=await storage()
  const execution=async(name,args)=>(await db.query(`explain(analyze,format json) select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args)).rows[0]['QUERY PLAN'][0]['Execution Time']
  const executionStats=async(name,args)=>{const values=[];for(let i=-warmups;i<samples;i++){const ms=await execution(name,args);if(i>=0)values.push(ms)}return stats(values)}
  const transaction=async(fn,setup)=>{await db.exec('begin');try{if(setup)await setup();return await observe(fn)}finally{await db.exec('rollback')}}
  console.log(JSON.stringify({phase:'paired-reads-and-summary',chats}))
  for(const conversation of[c,n])for(const scenario of['advance','accountAhead','duplicate']){
   const target=conversation.latestMessageId,table=conversation.kind==='client'?'communication_read_cursors':'workspace_native_read_cursors',key=conversation.kind==='client'?'relationship_id':'conversation_id'
   const setup=async()=>{if(scenario!=='advance')await db.query(`update ${table} set last_read_at='2026-10-01T00:01:40.123456Z',last_read_message_id=$1 where workspace_id=$2 and ${key}=$3 and user_id=$4`,[target,w,conversation.id,me]);if(scenario==='duplicate')await db.query("update communication_device_read_cursors set last_read_at='2026-10-01T00:01:40.123456Z',last_read_message_id=$1 where workspace_id=$2 and conversation_id=$3 and user_id=$4 and device_id=$5",[target,w,conversation.id,me,deviceA])}
   const rpcWall=await paired(()=>transaction(()=>rpc('advance_communication_read',[w,conversation.kind,conversation.id,target]),setup),()=>transaction(()=>rpc('advance_communication_device_read',[w,deviceA,conversation.kind,conversation.id,target]),setup))
   const sqlExecution=await paired(()=>transaction(()=>execution('advance_communication_read',[w,conversation.kind,conversation.id,target]),setup).then(x=>({ms:x.value,value:null})),()=>transaction(()=>execution('advance_communication_device_read',[w,deviceA,conversation.kind,conversation.id,target]),setup).then(x=>({ms:x.value,value:null})))
   for(const arm of[sqlExecution.account,sqlExecution.device]){delete arm.jsonBytes;delete arm.gzipBytes}
   data.reads[`${conversation.kind}.${scenario}`]={rpcWall,sqlExecution}
  }
  const summaryRpcWall=await paired(()=>observe(()=>rpc('communication_unread_summary',[w])),()=>observe(()=>rpc('communication_device_unread_summary',[w,deviceA,false])))
  const summarySql=await paired(()=>execution('communication_unread_summary',[w]).then(ms=>({ms,value:null})),()=>execution('communication_device_unread_summary',[w,deviceA,false]).then(ms=>({ms,value:null})))
  for(const arm of[summarySql.account,summarySql.device]){delete arm.jsonBytes;delete arm.gzipBytes}
  data.summary={rpcWall:summaryRpcWall,sqlExecution:summarySql}
  console.log(JSON.stringify({phase:'encrypted-window-and-search',chats}))
  for(const kind of['client','native']){
   const selected=kind==='client'?c:n,ids20=conversations.filter(x=>x.kind===kind).slice(0,20).map(x=>x.id)
   for(const[name,fn,args]of[
    [`${kind}.roster`,'communication_device_roster',[w,deviceA,kind]],
    [`${kind}.preview20`,'communication_device_preview_batch',[w,deviceA,kind,ids20]],
    [`${kind}.history`,'communication_device_history',[w,deviceA,kind,selected.id]],
   ]){console.log(JSON.stringify({phase:'bounded-operation',chats,name}));const result=await measure(()=>rpc(fn,args));const rows=result.result.messages?.length??result.result.items?.length;delete result.result;data.operations[name]={rpcWall:result,sqlExecution:await executionStats(fn,args),rows,...(name.endsWith('.history')?{limit:kind==='client'?500:60}:{})}}
   for(const[caseName,term]of[['allMatches','encrypted latest'],['noMatches','a-search-with-no-matching-body']]){
    console.log(JSON.stringify({phase:'search-pages',chats,kind,caseName}))
    const routePage=data=>({deviceId:data.deviceId,readProtocol:'device-v1',conversationIds:matchingConversationPreviewIds(data.candidates,term),nextCursor:data.nextCursor})
    const page=await measure(async()=>routePage(await rpc('communication_device_preview_search',[w,deviceA,kind,term,null])));delete page.result
    const firstDatabaseResponse=bytes(await rpc('communication_device_preview_search',[w,deviceA,kind,term,null]))
    const full=await measure(async()=>{let after=null,count=0;const responses=[],databaseResponses=[];do{const data=await rpc('communication_device_preview_search',[w,deviceA,kind,term,after]);const page=routePage(data);count+=page.conversationIds.length;responses.push(page);databaseResponses.push(data);after=page.nextCursor}while(after);return {pages:responses.length,matches:count,responses,databaseResponses}})
    const responseSizes=full.result.responses.map(bytes),databaseSizes=full.result.databaseResponses.map(bytes)
    const result={pages:full.result.pages,matches:full.result.matches,responseJsonBytes:responseSizes.reduce((sum,x)=>sum+x.jsonBytes,0),responseGzipBytes:responseSizes.reduce((sum,x)=>sum+x.gzipBytes,0),databaseJsonBytes:databaseSizes.reduce((sum,x)=>sum+x.jsonBytes,0)};delete full.result;delete full.jsonBytes;delete full.gzipBytes
    data.operations[`${kind}.search.${caseName}`]={firstPageRpcWall:page,firstDatabaseResponse,firstPageSqlExecution:await executionStats('communication_device_preview_search',[w,deviceA,kind,term,null]),allPagesRpcWall:{...full,...result}}
   }
  }
  // The main dataset has101 rows/client. Price the actual500-row maximum
  // separately without changing the100-message backlog used in other cases.
  await db.exec(`with encrypted as materialized(select body_ciphertext,body_key_id from client_messages where id='${c.latestMessageId}') insert into client_messages(id,workspace_id,relationship_id,direction,created_at,body_ciphertext,body_key_id) select ('00000000-0000-4000-8000-'||lpad((900000000+m)::text,12,'0'))::uuid,'${w}','${c.id}','inbound',timestamptz '2026-10-02T00:00:00Z'+m*interval '1 second',encrypted.body_ciphertext,encrypted.body_key_id from generate_series(1,399)m cross join encrypted`)
  console.log(JSON.stringify({phase:'history500',chats}))
  const maximum=await measure(()=>rpc('communication_device_history',[w,deviceA,'client',c.id]));const rows=maximum.result.messages.length;delete maximum.result;data.operations['client.history500Full']={rpcWall:maximum,sqlExecution:await executionStats('communication_device_history',[w,deviceA,'client',c.id]),rows}
  await db.exec("delete from client_messages where created_at>='2026-10-02T00:00:00Z'")
  console.log(JSON.stringify({phase:'first-scope-initialization',chats}))
  await db.query('insert into auth.sessions values($1,$2,null)',[newSession,me]);await db.query('insert into account_session_devices values($1,$2,$3)',[newSession,me,newDevice])
  for(const[name,device,session]of[['known',deviceB,sessionB],['new',newDevice,newSession]]){
   await f.setClaims({...f.claims,session_id:session})
   const seedTimes=[],summaryTimes=[],seedSqlTimes=[],summarySqlTimes=[];let summaryResult
   for(let iteration=-warmups;iteration<samples;iteration++){
    const first=await transaction(()=>rpc('initialize_communication_device_scope',[w,me,device]));if(iteration>=0)seedTimes.push(first.ms)
    const full=await transaction(()=>rpc('communication_device_unread_summary',[w,device,false]));if(iteration>=0)summaryTimes.push(full.ms);summaryResult=full.value
    const seedSql=await transaction(()=>execution('initialize_communication_device_scope',[w,me,device]));if(iteration>=0)seedSqlTimes.push(seedSql.value)
    const summarySql=await transaction(()=>execution('communication_device_unread_summary',[w,device,false]));if(iteration>=0)summarySqlTimes.push(summarySql.value)
   }
   data.initialization[name]={seedOnly:{rpcWall:stats(seedTimes),sqlExecution:stats(seedSqlTimes)},firstAuthorizedSummary:{rpcWall:{...stats(summaryTimes),...bytes(summaryResult)},sqlExecution:stats(summarySqlTimes)}}
  }
  await f.setClaims()
  // Capacity is measured only after every timed operation. Remove benchmark
  // rollback churn first, then initialize99 additional installations once.
  console.log(JSON.stringify({phase:'capacity100-installations',chats}))
  for(const table of storageTables)await db.exec(`vacuum full public.${table}`)
  for(let i=0;i<99;i++){const device=i===0?deviceB:i===1?newDevice:`00000000-0000-4000-8000-${String(50000000+i).padStart(12,'0')}`;await rpc('initialize_communication_device_scope',[w,me,device])}
  data.storage100InitializedDevices=await storage()
  data.storageCapacityPreparation='After all timed observations, VACUUM FULL removes rollback-only benchmark churn from the four private tables before99 additional scopes initialize once. Includes heap, indexes and TOAST; excludes Auth/session bookkeeping and production WAL/backups.'
  if(data.storage100InitializedDevices.initializedDevices!==100||data.storage100InitializedDevices.deviceRows!==100*chats)throw Error('Capacity fixture must contain100 complete device scopes')
  data.elapsedMs=round(performance.now()-started);report.datasets.push(data)
  await writeFile(process.argv[2]||'/private/tmp/device-unread-production-measure.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify({phase:'complete',chats,elapsedMs:data.elapsedMs,reads:data.reads,summary:data.summary}))
 }finally{await f.close()}
}
report.finishedAt=new Date().toISOString();await writeFile(process.argv[2]||'/private/tmp/device-unread-production-measure.json',JSON.stringify(report,null,2))
console.log(JSON.stringify({output:process.argv[2]||'/private/tmp/device-unread-production-measure.json',datasets:report.datasets.length,samples,finishedAt:report.finishedAt}))
