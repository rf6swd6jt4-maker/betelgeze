import React,{useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AccountDevicePresence} from './AccountDevicePresence.js'
import {useConversationRead} from './useConversationRead.js'
import {useCommunicationsUnread} from './useCommunicationsUnread.js'
import {useSharedUnreadSummary} from './useSharedUnreadSummary.js'
import {publishChatRead} from './read-state.js'
import {publishDeviceChatRead} from './device-read-state.js'
import {invalidateUnreadSummary} from './unread-broadcast.js'
const bootstrap=JSON.parse(document.body.dataset.bootstrap)
let controls,state={loaded:false},timings=[]
const message=n=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,createdAt:`2026-10-09T10:00:00.${String(n).padStart(6,'0')}Z`})
function App(){
 const [input,setInput]=useState({active:false,atLatest:true,positioned:true,covered:false,hidden:false,userId:bootstrap.userId,latest:bootstrap.latest}),[draft,setDraft]=useState('')
 const pane=useRef(null),previous=useRef(null)
 const shell=useCommunicationsUnread(bootstrap.workspaceId,bootstrap.workspaceSlug,input.userId,true)
 const shared=useSharedUnreadSummary(bootstrap.workspaceId,input.userId)
 const deviceCursor=shared?.readCursors.find(row=>row.kind===bootstrap.kind&&row.conversationId==='chat')
 const reading=useConversationRead({workspaceId:bootstrap.workspaceId,workspaceSlug:bootstrap.workspaceSlug,userId:input.userId,kind:bootstrap.kind,conversationId:'chat',latest:input.latest,cursor:deviceCursor,deviceId:shared?.deviceId??null,active:input.active,atLatest:input.atLatest,pane})
 const row=shared?.rows.find(row=>row.kind===bootstrap.kind&&row.conversationId==='chat')?.count??0
 React.useLayoutEffect(()=>{
  if(shared&&row===0&&previous.current>0&&window.deviceUnreadAckAt){timings.push(performance.now()-window.deviceUnreadAckAt);window.deviceUnreadAckAt=0}
  previous.current=row
  state={loaded:Boolean(shared),shell:shell.count,row,deviceId:shared?.deviceId??null,userId:input.userId,error:reading.error,stale:shell.stale,deviceCursor,globalCursor:bootstrap.globalCursor,draft,timings:[...timings]}
  controls={setInput,flush:reading.flush,invalidate:shell.invalidate}
 },[shared,row,shell,input,reading,draft,deviceCursor])
 return React.createElement('main',null,bootstrap.presence?React.createElement(AccountDevicePresence):null,React.createElement('header',null,'Device badge ',React.createElement('output',{id:'shell-count'},shell.count),' Chat ',React.createElement('output',{id:'row-count'},row)),React.createElement('div',{id:'pane',ref:pane,'data-message-pane':true,'data-positioned':String(input.positioned),hidden:input.hidden},React.createElement('div',{className:'message','data-message-interaction':input.latest.id},'Synthetic latest message')),React.createElement('input',{id:'composer','aria-label':'Draft',value:draft,onChange:event=>setDraft(event.target.value)}),input.covered?React.createElement('div',{className:'cover'},'Synthetic overlay'):null)
}
window.deviceUnread={get state(){return state},set(next){controls.setInput(current=>({...current,...next}))},latest(n){controls.setInput(current=>({...current,latest:message(n)}))},flush(){return controls.flush()},invalidate(){controls.invalidate()},accountRead(n=3){publishChatRead({workspaceId:bootstrap.workspaceId,userId:state.userId,kind:bootstrap.kind,conversationId:'chat',lastReadAt:message(n).createdAt,lastReadMessageId:message(n).id})},deviceRead(deviceId,n=3){publishDeviceChatRead({workspaceId:bootstrap.workspaceId,userId:state.userId,kind:bootstrap.kind,conversationId:'chat',deviceId,lastReadAt:message(n).createdAt,lastReadMessageId:message(n).id})},observeDevice(){window.dispatchEvent(new Event('betelgeze:device-observed'))},invalidateOther(){invalidateUnreadSummary('other',state.userId)}}
createRoot(document.getElementById('root')).render(React.createElement(App))
