// Production React and real loopback HTTP/cookies; every account/message is synthetic.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const directory = mkdtempSync(join(tmpdir(), 'be-device-unread-'))
const sources = ['components/account/AccountDevicePresence.tsx','components/communications/useConversationRead.ts','components/communications/useChatDocumentAttention.ts','components/workspace/useWorkspaceTabActive.ts','components/communications/useCommunicationsUnread.ts','components/communications/useSharedUnreadSummary.ts','lib/workspace-tabs.ts','lib/workspace-tab-activity.ts','lib/communications/reading-visibility.ts','lib/communications/reading-observer.ts','lib/communications/read-queue.ts','lib/communications/read-state.ts','lib/communications/device-read-state.ts','lib/record-version.js','lib/communications/unread-summary.ts','lib/communications/unread-broadcast.ts']
const aliases = new Map(sources.flatMap(path => {
 const file=path.split('/').at(-1), compiled='./'+file.replace(/\.tsx?$/,'.js')
 return [['@/'+path.replace(/\.(tsx?|js)$/,''),compiled],['./'+file,compiled],['./'+file.replace(/\.(tsx?|js)$/,''),compiled]]
}))
for(const key of ['@/components/workspace/WorkspaceNavigation','./WorkspaceNavigation','@/lib/workspace-performance','@/lib/push/browser-notifications']) aliases.set(key,'./stubs.js')
aliases.set('../record-version.js','./record-version.js')
let bundle
try {
 for(const path of sources){let source=readFileSync(path,'utf8');for(const [from,to] of aliases)source=source.replaceAll(`"${from}"`,JSON.stringify(to));writeFileSync(join(directory,path.split('/').at(-1).replace(/\.tsx?$/,'.js')),ts.transpileModule(source,{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText)}
 writeFileSync(join(directory,'stubs.js'),`import React from 'react'; export const Navigation=React.createContext({tabId:'fixture-tab',active:true}); export const useWorkspaceNavigation=()=>React.useContext(Navigation); export const beginWorkspaceInteraction=input=>({mark(name){if(input.command==='message.read'&&name==='server_ack')window.deviceUnreadAckAt=performance.now()},finish(){}}); export const dismissReadChatNotification=async()=>{};`)
 writeFileSync(join(directory,'runner.js'),readFileSync('scripts/browser/device-unread-runner.mjs','utf8'))
 bundle=await new Promise((done,fail)=>webpack({mode:'production',devtool:false,entry:join(directory,'runner.js'),output:{path:directory,filename:'bundle.js'},resolve:{modules:[resolve('node_modules'),'node_modules']},optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?fail(error??Error(stats.toString({all:false,errors:true}))):done(readFileSync(join(directory,'bundle.js')))))
}finally{rmSync(directory,{recursive:true,force:true})}
const states=new Map()
const message=n=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,createdAt:`2026-10-09T10:00:00.${String(n).padStart(6,'0')}Z`})
const getState=run=>{if(!states.has(run))states.set(run,{latest:3,devices:new Map(),global:new Map(),reads:[],summaries:[],mode:'healthy',summaryMode:'healthy',pending:[],pendingSummaries:[],observations:[],observationMode:'healthy',requireBinding:false,bindings:new Map(),bindingRejections:[]});return states.get(run)}
const cookies=req=>Object.fromEntries((req.headers.cookie??'').split(';').map(pair=>pair.trim().split('=')))
const key=(device,user,kind)=>`${device}:${user}:${kind}`
const cursor=(run,user,kind,n)=>({workspaceId:run,userId:user,kind,conversationId:'chat',lastReadMessageId:message(n).id,lastReadAt:message(n).createdAt})
const json=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(body))}
const body=async req=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32000)throw Error('Oversized fixture request')}return raw?JSON.parse(raw):{}}
const server=createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1'), path=url.pathname, cookie=cookies(req)
 if(path==='/bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle);return}
 if(path==='/'){
  const run=url.searchParams.get('run')??'fixture', kind=url.searchParams.get('kind')==='client'?'client':'native',device=cookie.betelgeze_push_device??randomUUID(),user=cookie.fixture_user??'fixture-user',session=cookie.fixture_session??randomUUID()
  const bootstrap={workspaceId:run,workspaceSlug:run,userId:user,kind,presence:url.searchParams.get('presence')==='1',latest:message(getState(run).latest),globalCursor:getState(run).global.get(`${user}:${kind}`)??null}
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#111;color:white;font:16px system-ui}main{height:100dvh;display:flex;flex-direction:column}header{padding:12px;flex:none}#pane{flex:1;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;justify-content:flex-end}.message{height:90px;flex:none;background:#333;padding:10px}#composer{font:inherit;padding:14px;box-sizing:border-box;width:100%;flex:none}.cover{position:fixed;inset:0;background:#444;z-index:1000}output{display:inline-block;min-width:35px}</style></head><body data-workspace-active-tab-id="fixture-tab" data-bootstrap='${JSON.stringify(bootstrap)}'><div id="root"></div><script src="/bundle.js"></script></body></html>`
  res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Set-Cookie':[`betelgeze_push_device=${device}; Path=/; HttpOnly; SameSite=Lax`,`fixture_user=${user}; Path=/; HttpOnly; SameSite=Lax`,`fixture_session=${session}; Path=/; HttpOnly; SameSite=Lax`],'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(html);return
 }
 if(path==='/api/account/devices'&&req.method==='POST'){
  const run=new URL(req.headers.referer).searchParams.get('run'),state=getState(run),device=cookie.betelgeze_push_device,user=cookie.fixture_user??'fixture-user',session=cookie.fixture_session
  const observation={deviceId:device,userId:user,session,status:state.observationMode==='fail'?'failed':'saved'};state.observations.push(observation)
  if(state.observationMode==='fail'){json(res,503,{error:'Synthetic device observation unavailable'});return}
  state.bindings.set(`${session}:${user}`,device);json(res,200,{deviceId:device});return
 }
 if(path==='/fixture/control'){
  const input=await body(req),state=getState(input.run)
  if(input.action==='mode')state.mode=input.mode
  if(input.action==='binding'){state.requireBinding=input.required??state.requireBinding;state.observationMode=input.mode??state.observationMode}
  if(input.action==='summaryMode')state.summaryMode=input.mode
  if(input.action==='latest')state.latest=input.latest
  if(input.action==='release'){const held=state.pending.splice(0);for(const release of held)release()}
  if(input.action==='releaseSummaries'){const held=state.pendingSummaries.splice(0);for(const release of held)release()}
  if(input.action==='switchUser'){json(res,200,{ok:true},{'Set-Cookie':`fixture_user=${input.userId}; Path=/; HttpOnly; SameSite=Lax`});return}
  if(input.action==='rotateDevice'){json(res,200,{ok:true},{'Set-Cookie':`betelgeze_push_device=${randomUUID()}; Path=/; HttpOnly; SameSite=Lax`});return}
  if(input.action==='serverRead')state.devices.set(key(input.deviceId,input.userId??'fixture-user',input.kind),input.position??state.latest)
  json(res,200,{reads:state.reads,summaries:state.summaries,pending:state.pending.length,pendingSummaries:state.pendingSummaries.length,global:[...state.global],devices:[...state.devices],observations:state.observations,bindingRejections:state.bindingRejections,bindings:[...state.bindings]});return
 }
 const match=path.match(/^\/api\/workspaces\/([^/]+)\/communications\/(native\/)?(unread|read)$/)
 if(!match){json(res,404,{error:'Unknown fixture route'});return}
 const run=decodeURIComponent(match[1]),state=getState(run),device=cookie.betelgeze_push_device,user=cookie.fixture_user??'fixture-user'
 if(match[3]==='unread'){
  const cursorsIncluded=url.searchParams.get('cursors')==='1'
  state.summaries.push({deviceId:device,userId:user,scope:url.searchParams.get('scope'),cursorsIncluded})
  if(state.requireBinding&&state.bindings.get(`${cookie.fixture_session}:${user}`)!==device){state.bindingRejections.push({deviceId:device,code:'P0002'});json(res,409,{error:'Synthetic installation/session mapping mismatch',code:'P0002'});return}
  if(!device||state.summaryMode==='unbound'){json(res,409,{error:'Device unavailable'});return}
  if(state.summaryMode==='hold')await new Promise(done=>state.pendingSummaries.push(done))
  if(state.summaryMode==='fail'){json(res,503,{error:'Synthetic summary unavailable'});return}
  const kinds=['client','native'],activeKind=url.searchParams.get('kind')
  const rows=[],readCursors=[]
  for(const kind of kinds){const n=state.devices.get(key(device,user,kind))??0;if(n)readCursors.push(cursor(run,user,kind,n));if(n<state.latest)rows.push({kind,conversationId:'chat',count:state.latest-n,latestMessageId:message(state.latest).id,latestMessageAt:message(state.latest).createdAt})}
  // Each fixture mounts one conversation kind; pass its stable kind in a cookie-independent run suffix.
  const fixtureKind=run.includes('-client-')?'client':run.includes('-native-')?'native':activeKind
  json(res,200,{deviceId:device,conversations:fixtureKind?rows.filter(row=>row.kind===fixtureKind):rows,cursorsIncluded,...cursorsIncluded?{readCursors}:{}});return
 }
 const input=await body(req),kind=match[2]?'native':'client',n=Number(String(input.messageId).slice(-12))
 state.reads.push({deviceId:device,bodyDeviceId:input.deviceId,userId:user,kind,messageId:input.messageId,status:'pending'})
 const record=state.reads.at(-1)
 if(!device||input.deviceId!==device){record.status='mismatch';json(res,409,{error:'Device changed'});return}
 if(state.mode==='hold')await new Promise(done=>state.pending.push(done))
 if(state.mode==='fail'){record.status='failed';json(res,503,{error:'Synthetic offline save'});return}
 const saved=Math.max(state.devices.get(key(device,user,kind))??0,n);state.devices.set(key(device,user,kind),saved)
 const accountKey=`${user}:${kind}`,global=Math.max(Number(state.global.get(accountKey)?.lastReadMessageId?.slice(-12)??0),n)
 const globalCursor=cursor(run,user,kind,global);state.global.set(accountKey,globalCursor);record.status='saved';record.ackAt=Date.now()
 json(res,200,{deviceId:state.mode==='wrong-ack-device'?randomUUID():device,cursor:globalCursor,deviceCursor:cursor(run,user,kind,saved)})
 }catch(error){json(res,500,{error:String(error)})}
})
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/`))
