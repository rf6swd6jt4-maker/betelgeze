import React,{useEffect,useLayoutEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MobileConversationSurface} from './MobileConversationSurface.js'
import {useConversationRead} from './useConversationRead.js'
import {useCommunicationsUnread} from './useCommunicationsUnread.js'
import {useSharedUnreadSummary} from './useSharedUnreadSummary.js'
import {subscribeChatReads,compareReadPositions} from './read-state.js'
import {Navigation} from './stubs.js'
import {invalidateUnreadSummary} from './unread-broadcast.js'
const h=React.createElement, wait=ms=>new Promise(done=>setTimeout(done,ms))
const cases=[]
const assert=(ok,message)=>{if(!ok)throw Error(message)}
const until=async(predicate,label)=>{for(let i=0;i<150;i++){if(predicate())return;await wait(20)}throw Error('Timed out: '+label)}
const message=n=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,createdAt:`2026-09-25T10:00:00.${String(n).padStart(6,'0')}Z`})
let root, api, requests, server, readGates, failReads, sharedNow, shellNow
function App({kind,initial}){
 const [state,setState]=useState({active:true,positioned:true,atLatest:true,showPane:true,showRow:true,latest:message(1),...initial}),[cursor,setCursor]=useState()
 const pane=useRef(null)
 const summary=useCommunicationsUnread('workspace','fixture','user',true)
 const shared=useSharedUnreadSummary('workspace','user')
 const reading=useConversationRead({workspaceId:'workspace',workspaceSlug:'fixture',userId:'user',kind,conversationId:'chat',latest:state.latest,cursor,active:state.active,atLatest:state.atLatest,pane})
 useEffect(()=>subscribeChatReads('workspace','user',read=>{if(read.kind===kind&&read.conversationId==='chat')setCursor(read)}),[kind])
 useLayoutEffect(()=>{api={setState,summary,reading};sharedNow=shared;shellNow=summary},[state,shared,summary,reading])
 return h(Navigation.Provider,{value:{tabId:'fixture-tab',active:state.active}},h('div',{style:{height:'100%'}},h(MobileConversationSurface,{selected:true,active:state.active,onClose(){}},h('section',{className:'fixture-chat'},h('header',null,'Synthetic chat'),state.showPane?h('div',{ref:pane,className:'fixture-pane','data-message-pane':true,'data-positioned':state.positioned?'true':'false'},state.showRow?h('div',{className:'fixture-row','data-message-interaction':state.latest.id},'Synthetic newest message'):null):null,h('footer',null,'Composer')))))
}
function remaining(){return !server.cursor||compareReadPositions(server.cursor,{lastReadAt:server.latest.createdAt,lastReadMessageId:server.latest.id})<0}
const rowCount=()=>sharedNow?.rows.find(row=>row.conversationId==='chat')?.count??0
async function setup(kind,initial={}){
 root?.unmount();await wait(30);document.querySelectorAll('.cover').forEach(node=>node.remove());sessionStorage.clear()
 requests=[];readGates=[];failReads=0;server={kind,latest:message(1),cursor:null};api=null;sharedNow=null;shellNow=null
 document.body.dataset.workspaceActiveTabId='fixture-tab'
 window.fetch=async(url,options={})=>{
  if(String(url).endsWith('/unread'))return {ok:true,json:async()=>({conversations:remaining()?[{kind,conversationId:'chat',count:3,latestMessageId:server.latest.id,latestMessageAt:server.latest.createdAt}]:[]})}
  if(!String(url).endsWith('/read'))throw Error('Unexpected fixture request: '+url)
  const body=JSON.parse(options.body),position={workspaceId:'workspace',userId:'user',kind,conversationId:body.conversationId??body.relationshipId,lastReadAt:message(Number(body.messageId.slice(-12))).createdAt,lastReadMessageId:body.messageId}
  requests.push(position)
  if(readGates.length)await readGates.shift()
  if(failReads>0){failReads--;throw Error('Synthetic offline failure')}
  if(!server.cursor||compareReadPositions(position,server.cursor)>0)server.cursor=position
  return {ok:true,json:async()=>({cursor:server.cursor})}
 }
 root=createRoot(document.getElementById('stage'));root.render(h(App,{kind,initial}));await until(()=>api&&sharedNow,'hooks mounted')
}
const cover=()=>{const node=document.createElement('div');node.className='cover';document.body.append(node);return node}
async function run(name,body){try{await body();cases.push({name,passed:true})}catch(error){cases.push({name,passed:false,error:String(error)})}}
await until(()=>document.hasFocus(),'foreground fixture')
for(const kind of ['native','client']){
 await run(kind+' opening rechecks without extra interaction',async()=>{
  await setup(kind)
  if(innerWidth<1024){assert(requests.length===0,'must not read during entry');await wait(70);assert(requests.length===0,'entry must stay unread')}
  await until(()=>requests.length===1,'read after presentation');await until(()=>shellNow.count===0&&rowCount()===0,'shell and row clear');await wait(200);assert(requests.length===1,'no duplicate acknowledged read')
 })
 await run(kind+' unpositioned pane waits for layout',async()=>{
  await setup(kind,{positioned:false});await wait(400);assert(requests.length===0,'unpositioned read');api.setState(s=>({...s,positioned:true}));await until(()=>requests.length===1,'positioning acknowledged')
 })
 await run(kind+' covered row waits for programmatic reveal',async()=>{
  await setup(kind,{positioned:false});const modal=cover();api.setState(s=>({...s,positioned:true}));await wait(400);assert(requests.length===0,'covered read');modal.remove();await until(()=>requests.length===1,'uncovered without pointer event')
 })
 await run(kind+' scrolled history never clears newest unread',async()=>{
  await setup(kind,{atLatest:false});await wait(400);assert(requests.length===0&&rowCount()===3,'history read incorrectly');api.setState(s=>({...s,atLatest:true}));await until(()=>requests.length===1&&rowCount()===0,'latest acknowledged')
 })
 await run(kind+' inactive chat waits for activation',async()=>{
  await setup(kind,{active:false});await wait(300);assert(requests.length===0&&rowCount()===3,'inactive read');api.setState(s=>({...s,active:true}));await until(()=>requests.length===1&&rowCount()===0,'activation acknowledged')
 })
 await run(kind+' synchronous native tab identity fences queued visibility checks',async()=>{
  await setup(kind,{positioned:false});await wait(350)
  api.setState(s=>({...s,positioned:true}));document.body.dataset.workspaceActiveTabId='another-tab'
  await wait(180);assert(requests.length===0&&rowCount()===3,'stale React tab identity created a read')
  document.body.dataset.workspaceActiveTabId='fixture-tab'
  await until(()=>requests.length===1&&rowCount()===0,'canonical tab restoration without a synthetic interaction')
 })
 for(const blocker of ['inert','hidden','aria-hidden'])await run(kind+' settled ancestor '+blocker+' prevents reads until removed',async()=>{
  await setup(kind,{positioned:false});await wait(350)
  const ancestor=document.querySelector('.fixture-chat');ancestor.setAttribute(blocker,blocker==='aria-hidden'?'true':'')
  api.setState(s=>({...s,positioned:true}));await wait(180)
  assert(requests.length===0&&rowCount()===3&&shellNow.count===3,'blocked ancestor cleared confirmed unread')
  ancestor.removeAttribute(blocker);await until(()=>requests.length===1&&rowCount()===0,'unblocked ancestor without pointer/key event')
 })
 await run(kind+' deferred pane attachment is observed without selection changing',async()=>{
  await setup(kind,{showPane:false});await wait(350);assert(requests.length===0,'missing pane read')
  api.setState(s=>({...s,showPane:true}));await until(()=>requests.length===1&&rowCount()===0,'deferred pane acknowledged')
 })
 await run(kind+' deferred latest row is observed without message identity changing',async()=>{
  await setup(kind,{showRow:false});await wait(350);assert(requests.length===0,'missing row read')
  api.setState(s=>({...s,showRow:true}));await until(()=>requests.length===1&&rowCount()===0,'deferred row acknowledged')
 })
 await run(kind+' detached pane is rediscovered after nested reattachment',async()=>{
  await setup(kind,{positioned:false});await wait(350)
  const pane=document.querySelector('.fixture-pane'),parent=pane.parentElement,next=pane.nextSibling
  pane.remove();await wait(60);pane.dataset.positioned='true';await wait(80)
  assert(requests.length===0&&rowCount()===3,'detached pane read')
  parent.insertBefore(pane,next);await until(()=>requests.length===1&&rowCount()===0,'nested reattachment acknowledged')
 })
 await run(kind+' delayed acknowledgement keeps unread until saved',async()=>{
  await setup(kind,{positioned:false});let release;readGates.push(new Promise(done=>release=done));api.setState(s=>({...s,positioned:true}));await until(()=>requests.length===1,'pending save');assert(shellNow.count===3&&rowCount()===3,'optimistic read before save');release();await until(()=>rowCount()===0&&shellNow.count===0,'confirmed count')
 })
 await run(kind+' failed save recovers on online',async()=>{
  await setup(kind,{positioned:false});failReads=1;api.setState(s=>({...s,positioned:true}));await until(()=>Boolean(api.reading.error),'failed save surfaced');assert(rowCount()===3&&shellNow.count===3,'failed save cleared unread');window.dispatchEvent(new Event('online'));await until(()=>requests.length===2&&rowCount()===0,'recovered save')
 })
 await run(kind+' acknowledged clear/reconciliation updates the existing summary owner',async()=>{
  await setup(kind,{positioned:false});await until(()=>rowCount()===3,'initial count')
  server.cursor={lastReadAt:message(1).createdAt,lastReadMessageId:message(1).id}
  invalidateUnreadSummary('other-workspace','user');await wait(80);assert(rowCount()===3,'cross-workspace event affected count')
  invalidateUnreadSummary('workspace','user');await until(()=>rowCount()===0&&shellNow.count===0,'clear acknowledgement invalidation');assert(requests.length===0,'summary invented a read')
 })
 await run(kind+' confirmed read from another browser reaches row and shell',async()=>{
  await setup(kind,{positioned:false});await until(()=>rowCount()===3,'initial count')
  const cursor={workspaceId:'workspace',userId:'user',kind,conversationId:'chat',lastReadAt:message(1).createdAt,lastReadMessageId:message(1).id}
  server.cursor=cursor;const channel=new BroadcastChannel('betelgeze:chat-read:workspace:user');channel.postMessage(cursor)
  await until(()=>rowCount()===0&&shellNow.count===0,'cross-browser confirmed read');channel.close();assert(requests.length===0,'remote acknowledgement generated local save')
 })
 await run(kind+' older acknowledgement cannot clear newer arrival',async()=>{
  await setup(kind,{positioned:false});let first,second;readGates.push(new Promise(done=>first=done),new Promise(done=>second=done));api.setState(s=>({...s,positioned:true}));await until(()=>requests.length===1,'first save');server.latest=message(2);api.setState(s=>({...s,latest:message(2)}));await wait(100);first();await until(()=>requests.length===2,'new position queued');await wait(100);assert(rowCount()===3&&shellNow.count===3,'old acknowledgement cleared new arrival');second();await until(()=>rowCount()===0,'new arrival acknowledged')
 })
}
root?.unmount()
window.commsReadingFixtureResult={status:'complete',total:cases.length,passed:cases.filter(row=>row.passed).length,cases}
document.getElementById('result').textContent=JSON.stringify(window.commsReadingFixtureResult,null,2)
