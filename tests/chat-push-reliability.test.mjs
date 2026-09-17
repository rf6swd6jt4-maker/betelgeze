import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { chatActivityIsActive, createChatActivitySequence } from '../lib/push/activity.ts'
import { subscriptionFingerprint } from '../lib/push/subscription-fingerprint.ts'

function load(file, dependencies, globals={}) {
 const compiledModule={exports:{}}
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 runInNewContext(code,{module:compiledModule,exports:compiledModule.exports,require:name=>{if(!(name in dependencies))throw new Error(`Unexpected dependency ${name}`);return dependencies[name]},Response,Request,URL,TextDecoder,Date,AbortSignal,console,...globals})
 return compiledModule.exports
}
const active={workspaceId:'workspace',conversationId:'chat',conversationKind:'native',connectionLive:true,workspaceTabActive:true}
test('exact selected chat requires active workspace tab, visible focused host, and live connection',()=>{
 assert.equal(chatActivityIsActive(active,true,true),true)
 for(const [context,visible,focused] of [[active,false,true],[active,true,false],[{...active,workspaceTabActive:false},true,true],[{...active,connectionLive:false},true,true],[{...active,conversationId:null},true,true]]) assert.equal(chatActivityIsActive(context,visible,focused),false)
 const sequence=createChatActivitySequence('tab')
 const heartbeat=sequence(active,true,false),left=sequence(active,false,true),next=sequence({...active,conversationId:'next'},true,true)
 assert.equal(heartbeat.revision,1);assert.equal(left.revision,2);assert.equal(next.revision,3);assert.equal(left.active,false)
})
test('fingerprint compares actual endpoint and both encryption keys',async()=>{
 const a={endpoint:'https://push.test/a',keys:{p256dh:'key',auth:'auth'}}
 assert.equal(await subscriptionFingerprint(a),await subscriptionFingerprint(JSON.parse(JSON.stringify(a))))
 for(const b of [{...a,endpoint:'https://push.test/b'},{...a,keys:{...a.keys,p256dh:'other'}},{...a,keys:{...a.keys,auth:'other'}}]) assert.notEqual(await subscriptionFingerprint(a),await subscriptionFingerprint(b))
 assert.equal(await subscriptionFingerprint({}),null)
})
test('read attention checks top-level focus rather than an unfocused retained iframe',()=>{
 let focused=true,visible='visible',effect
 const listeners=new Map(),host={document:{hasFocus:()=>focused},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)}
 const window={top:host,addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)}
 const document={get visibilityState(){return visible},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)}
 const changes=[]
 const mod=load('components/communications/useChatDocumentAttention.ts',{react:{useEffect:fn=>{effect=fn},useState:()=>[{visible:false,attentive:false},x=>changes.push(typeof x === "function" ? x(changes.at(-1) ?? {visible:false,attentive:false}) : x)]}},{window,document})
 assert.equal(mod.chatDocumentHasAttention(),true);focused=false;assert.equal(mod.chatDocumentHasAttention(),false)
 mod.useChatDocumentAttention();const cleanup=effect();assert.equal(changes.at(-1).attentive,false)
 focused=true;listeners.get('focus')();assert.equal(changes.at(-1).attentive,true)
 visible='hidden';listeners.get('visibilitychange')();assert.equal(changes.at(-1).attentive,false)
 cleanup();assert.equal(listeners.size,0)
})
function worker(show,fetcher){
 const listeners=new Map()
 runInNewContext(readFileSync('public/sw.js','utf8'),{URL,Response,AbortSignal,fetch:fetcher,caches:{},self:{location:{origin:'https://app.betelgeze.com'},registration:{showNotification:show},addEventListener:(type,fn)=>listeners.set(type,fn)}})
 return payload=>{let result;listeners.get('push')({data:{json:()=>payload},waitUntil:p=>{result=p}});return result}
}
const payload={web_push:8030,mutable:true,notification:{title:'Chat',body:'New message',tag:'chat:one',renotify:true,silent:false,data:{url:'/workspace/communications',conversationId:'one',deliveryId:'delivery',receiptToken:'capability'}}}
test('notification display happens before receipt transport; network failure cannot hide it',async()=>{
 const order=[]
 const push=worker(async(title,options)=>{order.push('display');assert.equal(title,'Chat');assert.equal(options.renotify,true)},async(_url,options)=>{order.push('receipt');assert.equal(JSON.parse(options.body).outcome,'shown');throw new Error('offline')})
 const done=push(payload);assert.deepEqual(order,['display']);await done;assert.deepEqual(order,['display','receipt'])
})
test('failed display is recorded and rejects the event for declarative fallback',async()=>{
 let outcome
 const push=worker(async()=>{throw new Error('display rejected')},async(_url,options)=>{outcome=JSON.parse(options.body).outcome;return new Response(null,{status:204})})
 await assert.rejects(push(payload),/display rejected/);assert.equal(outcome,'failed')
})
test('a legacy notification still displays without requesting a receipt',async()=>{
 let shown=0,requests=0
 const push=worker(async()=>{shown++},async()=>{requests++})
 await push({title:'Legacy',body:'Message',url:'/'});assert.equal(shown,1);assert.equal(requests,0)
})

function deliveryHarness({states={},providerFailures={}}={}) {
 const jobs=['a','b'].map((id)=>({id,user_id:'recipient',subscription_id:id,workspace_id:'workspace',conversation_kind:'native',conversation_id:'chat',message_id:'message',message_created_at:new Date().toISOString(),lease_token:`lease-${id}`,receipt_token:`receipt-${id}`}))
 const sent=[],outcomes=[],deleted=[]
 class WebPushError extends Error {constructor(statusCode){super('provider failure');this.statusCode=statusCode}}
 const db={
  rpc:async(name,input)=>{
   if(name==='claim_chat_push_deliveries')return {data:jobs,error:null}
   if(name==='prepare_chat_push_delivery'){const sequence=states[input.p_id]??['send','send'];const state=sequence.shift()??'send';return {data:{state,unreadCount:2},error:null}}
   if(name==='finish_chat_push_delivery'){outcomes.push(input);return {data:true,error:null}}
   if(name==='increment_web_push_failure')return {error:null}
   throw new Error(`Unexpected RPC ${name}`)
  },
  from:table=>{
   assert.equal(table,'web_push_subscriptions')
   let id,operation='select'
   const q={select:()=>q,eq:(key,value)=>{if(key==='id')id=value;return q},maybeSingle:async()=>({data:{endpoint:`https://push.test/${id}`,p256dh:`key-${id}`,auth:`auth-${id}`},error:null}),update:()=>{operation='update';return q},delete:()=>{operation='delete';return q},then:resolve=>{if(operation==='delete')deleted.push(id);return Promise.resolve({error:null}).then(resolve)}}
   return q
  },
 }
 const mod=load('lib/push/delivery.ts',{
  'server-only':{},'node:crypto':{createHash:()=>({update:()=>({digest:()=> 'topic'})})},
  'web-push':{__esModule:true,WebPushError,default:{sendNotification:async(sub,body,options)=>{sent.push({sub,payload:JSON.parse(body),options});const id=sub.endpoint.split('/').at(-1);if(providerFailures[id])throw new WebPushError(providerFailures[id])}}},
  '@/lib/supabase/admin':{supabaseAdmin:db},'@/lib/push/declarative-notification':{declarativeChatPushPayload:JSON.stringify},'@/lib/push/recipients':{chatPushSchemaMissing:()=>false},
 },{process:{env:{WEB_PUSH_VAPID_PUBLIC_KEY:'public',WEB_PUSH_VAPID_PRIVATE_KEY:'private'}},console:{warn:()=>undefined}})
 const run=()=>mod.processChatPushDeliveries({messageId:'message',push:{messageId:'message',conversationId:'chat',workspaceId:'workspace',conversationKind:'native',title:'Chat',body:'Hello',url:'/workspace/communications'}})
 return {run,sent,outcomes,deleted}
}
test('worker sends to every eligible device and encrypts for each separate subscription',async()=>{
 const h=deliveryHarness();const result=await h.run();assert.equal(result.accepted,2);assert.equal(h.sent.length,2)
 assert.deepEqual(h.sent.map(s=>s.sub.keys.p256dh).sort(),['key-a','key-b'])
 assert.ok(h.sent.every(s=>s.payload.body==='2 new messages · Hello'))
 assert.equal(new Set(h.sent.map(s=>s.payload.receiptToken)).size,2)
 assert.ok(h.outcomes.every(o=>o.p_outcome==='accepted'))
})
test('a permanently dead device cannot block another device; temporary provider errors remain retryable',async()=>{
 const h=deliveryHarness({providerFailures:{a:410}});const result=await h.run();assert.equal(result.accepted,1);assert.deepEqual(h.deleted,['a'])
 assert.equal(h.outcomes.find(x=>x.p_id==='a').p_outcome,'revoked')
 const retry=deliveryHarness({providerFailures:{a:503}});await retry.run();assert.equal(retry.outcomes.find(x=>x.p_id==='a').p_outcome,'retry');assert.equal(retry.deleted.length,0)
})
test('worker defers active users and rechecks revocation immediately before external delivery',async()=>{
 const h=deliveryHarness({states:{a:['deferred'],b:['send','revoked']}});await h.run();assert.equal(h.sent.length,0);assert.equal(h.outcomes.length,0)
})
test('a saved message schedules delivery even if loading its encrypted confirmation fails',async()=>{
 const source=readFileSync('app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts','utf8')
 const ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 const fn=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='POST')
 const callbacks=[]
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null,error:null}),insert:()=>q,single:async()=>({data:{id:'saved-message'},error:null})}
 const deps={Response,UUID_PATTERN:/^[0-9a-f-]{36}$/,requireWorkspacePanel:async()=>({workspace:{id:'workspace',slug:'workspace'},user:{id:'sender'}}),nativeAttachmentFromInput:()=>null,messageQuoteFromValue:()=>null,assertNativeConversationAccess:async()=>true,supabaseAdmin:{from:()=>q},attachmentBatch:()=>[],packAttachments:()=>null,after:fn=>callbacks.push(fn),notifyNativeChatMessage:async input=>input,loadNativeMessageForCurrentUser:async()=>{throw new Error('decrypt unavailable')}}
 const code=ts.transpileModule(fn.getText(ast).replace('export async','async'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 const post=new Function(...Object.keys(deps),`${code};return POST`)(...Object.values(deps))
 const response=await post(new Request('https://app.test',{method:'POST',body:JSON.stringify({conversationId:'00000000-0000-4000-8000-000000000001',clientRequestId:'00000000-0000-4000-8000-000000000002',body:'Hello'})}),{params:Promise.resolve({workspaceSlug:'workspace'})})
 assert.equal(response.status,503);assert.equal(callbacks.length,1);assert.equal((await callbacks[0]()).messageId,'saved-message')
})

test('tracker publishes ordered departures for tab hiding, window blur, pagehide and unmount',async()=>{
 const hooks=[],pendingEffects=[],listeners=new Map(),requests=[],beacons=[]
 let hook=0,focused=true,workspaceTabActive=true
 const react={
  useState:initialize=>{const i=hook++;if(!(i in hooks))hooks[i]=typeof initialize==='function'?initialize():initialize;return [hooks[i],()=>undefined]},
  useRef:initial=>{const i=hook++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i]},
  useEffect:(effect,deps)=>{const i=hook++;if(!hooks[i]||deps.some((d,n)=>d!==hooks[i].deps[n])){pendingEffects.push(()=>{hooks[i]?.cleanup?.();hooks[i]={deps,cleanup:effect()}})}},
 }
 const host={document:{hasFocus:()=>focused},addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)}
 const window={top:host,setInterval:()=>1,clearInterval:()=>undefined,addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)}
 const document={visibilityState:'visible',addEventListener:(n,fn)=>listeners.set(n,fn),removeEventListener:n=>listeners.delete(n)}
 const {CommunicationsActivityTracker}=load('components/communications/CommunicationsActivityTracker.tsx',{
  react,'@/components/workspace/useWorkspaceTabActive':{useWorkspaceTabActive:()=>workspaceTabActive},'@/lib/push/activity':{chatActivityIsActive,createChatActivitySequence},
  '@/lib/workspace-tab-activity':{workspaceDocumentIsActive:()=>workspaceTabActive},'@/lib/workspace-tabs':{WORKSPACE_TAB_VISIBILITY_EVENT:'tab-visibility'},
 },{window,document,Blob,crypto:{randomUUID:()=> 'tab'},navigator:{sendBeacon:(_url,blob)=>{beacons.push(blob);return true}},fetch:async(_url,init)=>{requests.push(JSON.parse(init.body));return new Response()}})
 const render=()=>{hook=0;CommunicationsActivityTracker({workspaceId:'workspace',conversationId:'chat',conversationKind:'native',connectionState:'live'});pendingEffects.splice(0).forEach(fn=>fn())}
 render();assert.equal(requests.length,1);assert.equal(requests[0].active,true)
 // Focusing an iframe may blur its host window, while its document stays focused.
 listeners.get('blur')();assert.equal(requests.at(-1).active,true);assert.equal(beacons.length,0)
 focused=false;listeners.get('blur')();assert.equal(JSON.parse(await beacons.at(-1).text()).active,false)
 focused=true;listeners.get('focus')();assert.equal(requests.at(-1).active,true)
 workspaceTabActive=false;listeners.get('tab-visibility')();assert.equal(JSON.parse(await beacons.at(-1).text()).active,false);render();assert.equal(requests.at(-1).active,false)
 workspaceTabActive=true;render();assert.equal(requests.at(-1).active,true)
 listeners.get('pagehide')();assert.equal(JSON.parse(await beacons.at(-1).text()).active,false)
 hooks.forEach(h=>h?.cleanup?.());assert.equal(listeners.size,0)
 const all=[...requests,...await Promise.all(beacons.map(async b=>JSON.parse(await b.text())))].sort((a,b)=>a.revision-b.revision)
 assert.deepEqual(all.map(p=>p.revision),all.map((_,n)=>n+1));assert.equal(all.at(-1).active,false)
})
