import React,{useEffect,useLayoutEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Navigation,beginWorkspaceInteraction} from './stubs.js'
import {useConversationRead} from './useConversationRead.js'
import {useCommunicationsUnread} from './useCommunicationsUnread.js'
import {useSharedUnreadSummary} from './useSharedUnreadSummary.js'
import {subscribeChatReads,compareReadPositions} from './read-state.js'
const h=React.createElement,params=new URLSearchParams(location.search),mode=params.get('mode')??'device',independentSelection=params.get('selectionLane')==='independent'
const newerCursor=(current,incoming)=>current&&(!incoming||compareReadPositions(current,incoming)>0)?current:incoming
const frame=()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))
window.fixtureSamples=[]
window.fixtureTraffic=[]
const nativeFetch=window.fetch.bind(window)
window.fetch=async(url,options={})=>{
 const record={path:String(url).split('?')[0],method:options.method??'GET',started:performance.now(),requestBytes:new TextEncoder().encode(options.body??'').length}
 window.fixtureTraffic.push(record)
 try{const response=await nativeFetch(url,options);record.response=performance.now();record.status=response.status;return response}catch(error){record.response=performance.now();record.error=String(error);throw error}
}
let controls
function App({run}){
 const userId='fixture-user-'+run, workspaceId='fixture-workspace'
 const [state,setState]=useState({roster:[],previews:{},histories:{},selected:null,active:true,boot:false,error:null,failed:[],loading:[],draft:''})
 const owner=useRef(null), pane=useRef(null),list=useRef(null),stateRef=useRef(state),sharedRef=useRef(null),markRef=useRef({}),switchMeasure=useRef(null)
 stateRef.current=state
 const summary=useCommunicationsUnread(workspaceId,'fixture',userId,true)
 const shared=useSharedUnreadSummary(workspaceId,userId);sharedRef.current=shared
 const selected=state.histories[state.selected], latest=selected?.messages.at(-1)
 const reading=useConversationRead({workspaceId,workspaceSlug:'fixture',userId,kind:state.roster.find(row=>row.id===state.selected)?.kind??'native',conversationId:state.selected,latest,cursor:selected?.cursor??undefined,active:state.active&&selected?.cursorKnown===true,atLatest:true,pane})
 function mark(key){if(markRef.current[key]===undefined)markRef.current[key]=performance.now()}
 useEffect(()=>{
  const controller=new AbortController(),queued=new Set(),inflight=new Set(),confirmedPreviews=new Set(),failedPreviews=new Set(),historyQueue=[],historyPending=new Set()
  let disposed=false,busy=false,historyBusy=false,bootPending=false,visible=new Set(),revision=0,previewGeneration=0
  const cacheKey=`fixture-previews:${mode}:${run}`
  try{const saved=JSON.parse(sessionStorage.getItem(cacheKey)??'null');if(saved)setState(s=>({...s,roster:saved.roster,previews:saved.previews}))}catch{}
  function applyItems(items){if(disposed)return;
   // Admission cannot depend on React having committed the scheduled render.
   // Claim confirmed IDs synchronously before releasing their request slot.
   const acceptedIds=new Set(items.map(item=>item.conversationId??item.id));for(const id of acceptedIds){confirmedPreviews.add(id);failedPreviews.delete(id)}
   setState(s=>{
   const previews={...s.previews},histories={...s.histories}
   for(const item of items){const id=item.conversationId??item.id;const existing=previews[id],incoming=item.deviceCursor??item.cursor??null;const cursor=newerCursor(existing?.cursor,incoming);previews[id]={...item,id,cursor,cursorKnown:true};if(histories[id])histories[id]={...histories[id],cursor:newerCursor(histories[id].cursor,cursor),cursorKnown:true}}
   const next={...s,previews,histories,failed:s.failed.filter(id=>!acceptedIds.has(id))};try{sessionStorage.setItem(cacheKey,JSON.stringify({roster:s.roster,previews:Object.fromEntries(Object.entries(previews).slice(-100))}))}catch{};return next
  })}
  async function json(url,options={}){const response=await fetch(url,{...options,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});const result=await response.json();if(!response.ok)throw Error(result.error??'Request failed');return result}
  function enqueue(ids){if(mode!=='device')return;for(const id of ids){if(!confirmedPreviews.has(id)&&!inflight.has(id)&&!failedPreviews.has(id))queued.add(id)};pump()}
  async function priorityHistory(){if(disposed||historyBusy||!stateRef.current.active||document.visibilityState!=='visible')return;const id=historyQueue.shift();if(!id)return;historyBusy=true;const requestRevision=revision;try{const chat=stateRef.current.roster.find(row=>row.id===id);const result=await json('/fixture/history?id='+encodeURIComponent(id)+'&kind='+chat.kind);if(!disposed&&revision===requestRevision)setState(s=>({...s,histories:{...s.histories,[id]:{...result,id,cursor:newerCursor(s.histories[id]?.cursor,result.cursor),cursorKnown:result.cursorKnown===true}},error:null}))}catch(error){if(!disposed&&revision===requestRevision)setState(s=>({...s,error:String(error),failed:[...new Set([...s.failed,id])]}))}finally{historyBusy=false;historyPending.delete(id);if(!disposed)void priorityHistory()}}
  async function pump(){if(independentSelection)void priorityHistory();if(disposed||busy||!stateRef.current.active||document.visibilityState!=='visible')return
   const historyId=independentSelection?null:historyQueue.shift()
   let ids=[]
   if(!historyId){for(const id of confirmedPreviews)queued.delete(id);const first=[...queued].find(id=>visible.has(id));const kind=stateRef.current.roster.find(row=>row.id===first)?.kind;ids=[...queued].filter(id=>visible.has(id)&&stateRef.current.roster.find(row=>row.id===id)?.kind===kind).slice(0,20);if(!ids.length)return;for(const id of ids){queued.delete(id);inflight.add(id)}}
   busy=true;const requestRevision=revision,requestedPreviewGeneration=previewGeneration
   if(ids.length)setState(s=>({...s,loading:[...new Set([...s.loading,...ids])]}))
   try{
    if(historyId){const chat=stateRef.current.roster.find(row=>row.id===historyId);const result=await json('/fixture/history?id='+encodeURIComponent(historyId)+'&kind='+chat.kind);if(!disposed&&revision===requestRevision)setState(s=>({...s,histories:{...s.histories,[historyId]:{...result,id:historyId,cursor:newerCursor(s.histories[historyId]?.cursor,result.cursor),cursorKnown:result.cursorKnown===true}},error:null}))}
    else{const result=await json('/fixture/previews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,kind:stateRef.current.roster.find(row=>row.id===ids[0])?.kind??'native'})});if(!disposed&&revision===requestRevision&&previewGeneration===requestedPreviewGeneration)applyItems(result.items??result.previews??[])}
   }catch(error){if(!disposed&&revision===requestRevision&&(historyId||previewGeneration===requestedPreviewGeneration)){for(const id of ids)failedPreviews.add(id);setState(s=>({...s,error:String(error),failed:[...new Set([...s.failed,...ids,...(historyId?[historyId]:[])])]}))}}
   finally{busy=false;for(const id of ids)inflight.delete(id);if(ids.length&&!disposed)window.fixturePreviewSettlementChallenge?.(()=>enqueue([...visible]));if(historyId)historyPending.delete(historyId);if(!disposed){setState(s=>({...s,loading:s.loading.filter(id=>!ids.includes(id))}));pump()}}
  }
  function select(id){const s=stateRef.current;if(s.selected===id)return;switchMeasure.current=beginWorkspaceInteraction({operation:'conversation_switch',routeSection:'communications',cacheState:s.histories[id]?'memory':'network'});setState(current=>({...current,selected:id,error:null}));if((s.roster.find(row=>row.id===id)?.kind==='native'||!s.histories[id])&&!historyPending.has(id)){historyPending.add(id);historyQueue.unshift(id);queued.delete(id);pump()}}
  function retry(){if(!stateRef.current.boot){void bootstrap();return}const failed=stateRef.current.failed;failedPreviews.clear();setState(s=>({...s,failed:[],error:null}));for(const id of failed){if(id===stateRef.current.selected&&!stateRef.current.histories[id]&&!historyPending.has(id)){historyPending.add(id);historyQueue.unshift(id)}else queued.add(id)}pump()}
  function refresh(){previewGeneration++;confirmedPreviews.clear();summary.invalidate();setState(s=>({...s,previews:Object.fromEntries(Object.entries(s.previews).map(([id,item])=>[id,{...item,cursorKnown:false}]))}));for(const id of visible)queued.add(id);pump()}
  const recover=()=>pump();document.addEventListener('visibilitychange',recover)
  owner.current={visible(ids){visible=new Set(ids);enqueue(ids)},pump,select,retry,refresh,dispose(){disposed=true;revision++;controller.abort()}}
  async function bootstrap(){if(bootPending||disposed)return;bootPending=true;try{const result=await json('/fixture/bootstrap');if(disposed)return;const selected=result.selected,histories={[selected.id]:selected};if(mode==='baseline'){const groups=new Map();for(const message of result.loadedMessages??[]){const id=message.relationship_id??message.conversation_id;if(id===selected.id)continue;const list=groups.get(id)??[];list.push({id:message.id,createdAt:message.created_at??message.createdAt,body:message.body});groups.set(id,list)}for(const [id,messages]of groups){messages.sort((a,b)=>compareReadPositions({lastReadAt:a.createdAt,lastReadMessageId:a.id},{lastReadAt:b.createdAt,lastReadMessageId:b.id}));const item=result.previews.find(row=>(row.conversationId??row.id)===id);histories[id]={id,messages,cursor:item?.deviceCursor??item?.cursor??null,cursorKnown:item?.cursorKnown===true}}}setState(s=>({...s,roster:result.conversations,selected:selected.id,histories,boot:true,error:null}));applyItems(result.previews??[])}catch(error){if(!disposed)setState(s=>({...s,error:String(error)}))}finally{bootPending=false}}void bootstrap()
  const unsubscribe=subscribeChatReads(workspaceId,userId,read=>{if(disposed)return;setState(s=>{const old=s.histories[read.conversationId];const prev=s.previews[read.conversationId];return {...s,histories:old?{...s.histories,[read.conversationId]:{...old,cursor:newerCursor(old.cursor,read),cursorKnown:true}}:s.histories,previews:prev?{...s.previews,[read.conversationId]:{...prev,cursor:newerCursor(prev.cursor,read)}}:s.previews}});mark('read_ack_event')})
  return()=>{disposed=true;revision++;controller.abort();unsubscribe();document.removeEventListener('visibilitychange',recover);if(owner.current)owner.current=null}
 // Recorded diagnostic owner lifetime is keyed to this immutable run identity.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[run,userId,workspaceId])
 useLayoutEffect(()=>{
  if(!list.current||!state.roster.length)return
  const visibleIds=()=>{const rootRect=list.current.getBoundingClientRect();const ids=[...list.current.querySelectorAll('[data-chat-id]')].filter(node=>{const rect=node.getBoundingClientRect();return rect.bottom>rootRect.top&&rect.top<rootRect.bottom}).map(node=>node.dataset.chatId);owner.current?.visible(ids)}
  const observer=new IntersectionObserver(visibleIds,{root:list.current,threshold:0});list.current.querySelectorAll('[data-chat-id]').forEach(node=>observer.observe(node));visibleIds();return()=>observer.disconnect()
 },[state.roster,state.active])
 // Recorded diagnostic scroll admission depends on message identity, not object refresh.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useLayoutEffect(()=>{if(pane.current&&latest){pane.current.scrollTop=pane.current.scrollHeight;pane.current.dataset.positioned='true'}},[state.selected,latest?.id])
 useEffect(()=>{
  let disposed=false
  void frame().then(()=>{if(disposed)return
   if(state.roster.length)mark('names_meaningful_ready')
   if(selected?.cursorKnown&&latest){mark('selected_meaningful_ready');if(switchMeasure.current){switchMeasure.current.mark('meaningful_ready');switchMeasure.current.finish('completed','meaningful_ready');switchMeasure.current=null}}
   if(shared){mark('summary_data_ready');const rootRect=list.current?.getBoundingClientRect();const ids=[...(list.current?.querySelectorAll('[data-chat-id]')??[])].filter(node=>{const rect=node.getBoundingClientRect();return rect.bottom>rootRect.top&&rect.top<rootRect.bottom}).map(node=>node.dataset.chatId);if(ids.length&&ids.every(id=>state.previews[id]?.cursorKnown))mark('visible_previews_meaningful_ready');if(state.selected&&!shared.rows.some(row=>row.conversationId===state.selected))mark('confirmed_badge_zero')}
  });return()=>{disposed=true}
 },[state,shared,selected,latest])
 useLayoutEffect(()=>{controls={select:id=>owner.current?.select(id),setActive(value){setState(s=>({...s,active:value}));if(value)requestAnimationFrame(()=>owner.current?.pump())},refresh:()=>owner.current?.refresh(),retry:()=>owner.current?.retry(),snapshot:()=>({mode,selectionLane:independentSelection?'independent':'shared',run,marks:{...markRef.current},selected:stateRef.current.selected,roster:stateRef.current.roster,previews:stateRef.current.previews,histories:stateRef.current.histories,failed:stateRef.current.failed,loading:stateRef.current.loading,boot:stateRef.current.boot,error:stateRef.current.error,readError:reading.error,summary:sharedRef.current,samples:window.fixtureSamples,traffic:window.fixtureTraffic})};window.fixture=controls},[state,reading,run])
 return h(Navigation.Provider,{value:{tabId:'fixture-tab',active:state.active}},h('main',{className:'layout'},h('nav',{className:'list',ref:list},h('div',{id:'status'},summary.stale?'Counts unavailable':shared?'Confirmed unread '+summary.count:'Unread counts pending',summary.stale?h('button',{className:'retry',onClick:()=>summary.invalidate()},'Retry counts'):null),state.roster.map(row=>{const item=state.previews[row.id],count=shared?.rows.find(value=>value.conversationId===row.id)?.count;return h('button',{className:'row',key:row.id,'data-chat-id':row.id,'aria-current':state.selected===row.id,onClick:()=>owner.current?.select(row.id)},h('span',{className:'badge'},shared?(count>99?'99+':count||''):'…'),h('span',{className:'name'},row.name),h('span',{className:'preview'},item?.preview?.body??(item?.cursorKnown?'No messages':state.failed.includes(row.id)?'Could not load — Retry':h('span',{className:'pending'},h('span',{className:'spin'}),'Loading messages'))))})),h('section',{className:'chat'},h('header',null,state.roster.find(row=>row.id===state.selected)?.name??'Loading chats'),state.error?h('button',{className:'retry',onClick:()=>owner.current?.retry()},'Retry loading'):null,reading.error?h('div',{className:'error','data-read-error':true},'Read not saved. Reconnect to retry.'):null,h('div',{className:'pane',ref:pane,'data-message-pane':true,'data-positioned':selected?'true':'false'},selected?.messages.map(message=>h('div',{className:'message',key:message.id,'data-message-interaction':message.id},message.body??message.text))),h('div',{className:'composer'},h('input',{'aria-label':'Message',value:state.draft,onChange:event=>{const timing=beginWorkspaceInteraction({operation:'field_edit',routeSection:'communications',cacheState:'memory'});setState(s=>({...s,draft:event.target.value}));requestAnimationFrame(()=>{timing.mark('visual_response');timing.finish('completed','visual_response')})},placeholder:'Message'})))))
}
const root=createRoot(document.getElementById('stage'));document.body.dataset.workspaceActiveTabId='fixture-tab';root.render(h(App,{key:params.get('run')??'one',run:params.get('run')??'one'}));window.fixtureResetScope=run=>root.render(h(App,{key:run,run}));
