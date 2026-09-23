// Loopback-only, mounted React fixture. No app account, provider, or client records.
// Run with --baseline for the exact 7a35b73d comparison; --development adds StrictMode effect replay.
import { createServer } from "node:http"
import { randomUUID, createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import ts from "typescript"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const baseline = process.argv.includes("--baseline")
const development = process.argv.includes("--development")
const directory = mkdtempSync(join(tmpdir(), "be-departure-fixture-"))
const sourceCache = new Map()
const source = (path) => {
    if (!sourceCache.has(path)) sourceCache.set(path, baseline ? execFileSync("git", ["show", `7a35b73d:${path}`], { encoding: "utf8" }) : readFileSync(path, "utf8"))
    return sourceCache.get(path)
}
const transpile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText
function extract(path, name, optional = false) {
    const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let selected
    const visit = (node) => {
        if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name) selected = node
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) selected = node
        ts.forEachChild(node, visit)
    }
    visit(file)
    if (!selected) { if (optional) return null; throw new Error(`Missing actual source declaration: ${name}`) }
    return transpile(ts.isVariableDeclaration(selected) ? `const ${selected.getText(file)};` : selected.getText(file)) + `\nreturn ${name};`
}
const shellPath = "components/workspace/WorkspaceTopBarClient.tsx"
const nativePath = "components/workspace/NativeWorkspaceTab.tsx"
const names = ["prepareNativeLeave", "activateWorkspaceTab", "warmWorkspaceTab", "closeTab", "switchTab", "reopenClosedTab", "retryActiveNavigation", "navigateActiveTab"]
const callbacks = Object.fromEntries(names.map((name) => [name, extract(shellPath, name)]))
for (const name of ["prepareNativeNavigation", "prepareNativePanelNavigation"]) callbacks[name] = extract(shellPath, name, true)
callbacks.nativeNavigate = extract(nativePath, "navigate")
callbacks.PanelBoundary = extract(nativePath, "PanelBoundary")
for (const path of ["lib/workspace-mutations.ts", "lib/workspace-tab-departure.ts", "lib/workspace-tabs.ts", "lib/workspace-frame-navigation.ts", "lib/workspace-navigation-lifecycle.ts"]) {
    writeFileSync(join(directory, path.split("/").at(-1).replace(/\.ts$/, ".js")), transpile(source(path)).replaceAll('"./workspace-tabs.ts"', '"./workspace-tabs.js"').replaceAll('"./workspace-frame-navigation.ts"', '"./workspace-frame-navigation.js"'))
}
writeFileSync(join(directory, "source.js"), `export default ${JSON.stringify(callbacks)};`)
const browser = String.raw`
import React, {useLayoutEffect,useState,Suspense,StrictMode,Component} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import callbacks from './source.js';
import * as mutations from './workspace-mutations.js';
import * as departure from './workspace-tab-departure.js';
import * as tabsHelpers from './workspace-tabs.js';
import {afterVisibleWorkspacePaint} from './workspace-navigation-lifecycle.js';
const h=React.createElement, results=[], delays=[], coldDelays=[], missingPaint=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const ref=current=>({current});
const noop=()=>{};
async function recordPaint(samples,observation){const result=await observation.promise;if(result.painted)samples.push(result.durationMs);else missingPaint.push(result)}
async function until(test,message){const deadline=performance.now()+1500;while(performance.now()<deadline){if(test())return;await wait(10)}if(!test())throw new Error(message)}
function evaluate(name,context){assert(callbacks[name],'Missing source callback '+name);return new Function('scope','with(scope){'+callbacks[name]+'}')(context)}
const PanelBoundary=evaluate('PanelBoundary',{React,Component});
function deferred(){let release;const promise=new Promise(resolve=>{release=resolve});return{promise,release}}
async function fixture(options={}){
 const story={owners:new Map(),lost:[],flushes:0,errors:[],messages:[],injections:0,lateAttempted:0,recordLoss:true,synchronousCommits:0,sideEffects:{storage:0,save:0,activate:0},gate:options.slow?deferred():null,boundary:null,suspension:options.suspend?deferred():null,throwing:Boolean(options.error),...options};
 const initial=(options.ids??['a','b','c','d']).map(id=>({id,url:'/fixture/native/'+id,title:id,history:['/fixture/native/'+id],historyIndex:0,seenRevision:0}));
 const residents=options.residents??['a','b','c'];
 const element=document.createElement('section');document.querySelector('#stage').append(element);const root=createRoot(element);
 const editorNodes=new Map(),lossObserver=new MutationObserver(()=>{for(const [node,record] of editorNodes){if(node.isConnected)continue;editorNodes.delete(node);if(story.recordLoss&&node.value!==record.owner.saved)story.lost.push({id:record.id,draft:node.value,saved:record.owner.saved})}});lossObserver.observe(element,{childList:true,subtree:true});
 let context,setEpoch;
 function ownerFor(id){if(!story.owners.has(id))story.owners.set(id,{draft:'unsaved '+id,saved:'saved '+id,node:null,mounts:0});return story.owners.get(id)}
 function inject(owner){story.lateAttempted++;if(owner?.node?.isConnected){owner.draft='late edit';owner.node.value=owner.draft;owner.node.dispatchEvent(new Event('input',{bubbles:true}));story.injections++}}
 function capture(){const check=mutations.captureWorkspaceAutosaveDepartureCheck();return{...check,validate(){const safe=check.validate();if(safe&&story.late==='aftercheck')queueMicrotask(()=>inject(ownerFor(story.lateId??'a')));return safe}}}
 const modes=Object.fromEntries(initial.map(tab=>[tab.id,options.frames?.includes(tab.id)?'frame':'native']));
 function NativeEditor({id,url}){
  const owner=ownerFor(id);
  useLayoutEffect(()=>{owner.mounts++;owner.node=element.querySelector('[data-editor="'+id+'"]');editorNodes.set(owner.node,{id,owner});
   const unregister=mutations.registerWorkspaceAutosaveFlusher(async()=>{story.flushes++;const value=owner.draft;window.dispatchEvent(new Event(mutations.WORKSPACE_MUTATION_INTENT_START));if(story.gate)await story.gate.promise;if(story.fail)return false;owner.saved=value;return true},story.checkpoint?{checkpoint:()=>{owner.saved=owner.draft;return true}}:{});
   return()=>{unregister();owner.node=null};
  },[id,url]);
  return h('input',{'data-editor':id,'data-route':url,defaultValue:owner.draft,onInput:event=>{owner.draft=event.currentTarget.value},'aria-label':'Synthetic editor '+id});
 }
 function FrameEditor({id}){return h('iframe',{'data-frame':id,title:'Synthetic frame '+id,src:'/frame?id='+id,ref:frame=>{if(frame)context.iframeRefs.current.set(id,frame);else{const previous=context.iframeRefs.current.get(id),state=previous?.contentWindow?.story;const dirty=state&&state.draft!==state.saved;queueMicrotask(()=>{if(story.recordLoss&&dirty&&!previous?.isConnected){story.frameLost??=[];story.frameLost.push(id)}});context.iframeRefs.current.delete(id)}}})}
 function Body({tabs,residentIds,epoch,active}){
  useLayoutEffect(()=>{story.paintCheckpoint?.({active,tabs})});
  if(story.throwing)throw new Error('Intentional fixture boundary failure');
  if(story.suspension&&!story.suspension.done)throw story.suspension.promise;
  return h('div',{'data-active':active},...tabs.filter(tab=>residentIds.includes(tab.id)).map(tab=>modes[tab.id]==='frame'?h(FrameEditor,{key:tab.id+':'+epoch,id:tab.id}):h(NativeEditor,{key:tab.id+':'+tab.url+':'+epoch,id:tab.id,url:tab.url})));
 }
 function Host(){
  const [tabs,setTabsReact]=useState(initial),[residentIds,setResidents]=useState(residents),[epoch,setEpochReact]=useState(0),[active,setActive]=useState('a');setEpoch=setEpochReact;
  if(!context){
   const makeMap=()=>ref(new Map());
   context={...departure,...mutations,...tabsHelpers,React,flushSync:callback=>{story.synchronousCommits++;return flushSync(callback)},useCallback:fn=>fn,window,document,AbortController,MAX_RESIDENT_WORKSPACE_FRAMES:3,
    workspace:{slug:'fixture',id:'fixture-workspace'},currentUserId:'fixture-user',nativePanelsEnabled:true,nativeAccountScope:'fixture-user:fixture-workspace',nativeAccountScopeRef:ref('fixture-user:fixture-workspace'),clearedNativeAccount:null,
    nativeNavigationSequence:ref(0),warmAbortRef:ref(null),departureAbortRef:ref(null),residentTabIdsRef:ref(residents),activeTabIdRef:ref('a'),tabsRef:ref(initial),nativeRefs:makeMap(),iframeRefs:makeMap(),canAddTabRef:ref(true),
    closedTabsRef:ref([{tab:{...initial[3]},index:3,contextOpen:true}]),tabFrameOrderRef:ref(initial.map(t=>t.id)),mutationRevisionRef:ref(0),loadedTabIdsRef:ref(new Set(initial.map(t=>t.id))),readyTabIdsRef:ref(new Set()),
    pendingNavigationRef:makeMap(),navigationTimeoutRef:makeMap(),softNavigationFallbackRef:makeMap(),navigationFallbackRef:makeMap(),navigationErrorRef:makeMap(),mutationIdsByTabRef:makeMap(),contextStatusByTabRef:ref({}),contextManualClosedByTabRef:ref({}),contextObstructedByTabRef:ref({}),
    contextOpenByTab:{},routeLoadingTabId:null,activeNavigation:{requestedUrl:'/fixture/native/retry'},activeTabId:'a',
    setBackgroundMutationState:noop,setBackgroundMutationError:error=>story.errors.push(error),setMobileContextKey:noop,setTabFrameOrder:noop,setLoadedTabIds:noop,setRefreshingTabIds:noop,setNavigationStateByTab:noop,setBackgroundMutationCounts:noop,setContextStatusByTab:noop,setContextObstructedByTab:noop,setContextOpenByTab:noop,setRouteLoadingTabId:noop,
    shellStorage:{set:()=>{story.sideEffects.storage++},remove:noop},workspaceTabContextStorageKey:(_slug,id)=>id,saveTabsState:()=>{story.sideEffects.save++},
    nativeNavigationPerformance:{begin:noop,cancel:noop,finish:noop,activate:()=>{story.sideEffects.activate++},bind:noop,finishSource:noop},startNativeNavigation:noop,publishWorkspaceTabActivity:noop,
    nativeWorkspaceRoute:url=>url.includes('/native/')?{key:url}:null,usesNativeCommunications:url=>tabsHelpers.workspaceTabIsCommunications(url,'fixture',window.location.origin),workspaceFrameHasNavigationReceiver:()=>false,normalizeWorkspaceUrl:url=>url,normalizeWorkspaceRoute:url=>url,
    titleForUrl:url=>url,routeCanShowRelationshipContext:()=>false,setTabContextStatus:noop,setTabContextOpen:noop,
    openCreate:noop,scheduleSoftNavigationFallback:noop,captureWorkspaceAutosaveDepartureCheck:capture,beginTabNavigation:noop,ensureTabFrameLocation:()=>setEpoch(value=>value+1),requestTabFrameNavigation:noop,
    postToTab:(id,message)=>{story.messages.push({id,...message});if(message.type==='retry'){story.throwing=false;story.boundary?.retry();setEpoch(value=>value+1)}},
   };
   context.updateTabForShellNavigation=(id,url)=>{modes[id]=url.includes('/native/')?'native':'frame';const next=context.tabsRef.current.map(tab=>tab.id===id?{...tab,url}:tab);context.tabsRef.current=next;context.setTabs(next)};
   context.setTabs=update=>setTabsReact(previous=>{const next=typeof update==='function'?update(previous):update;context.tabsRef.current=next;return next});context.setResidentTabIds=setResidents;context.setActiveTabId=setActive;
   for(const name of ['activateWorkspaceTab','prepareNativeLeave','warmWorkspaceTab','closeTab','switchTab','reopenClosedTab','retryActiveNavigation','navigateActiveTab'])context[name]=evaluate(name,context);
   for(const name of ['prepareNativeNavigation','prepareNativePanelNavigation'])if(callbacks[name])context[name]=evaluate(name,context);
  }
  context.activeTabId=active;context.tabsRef.current=tabs;
  context.nativeRefs.current=new Map(tabs.filter(tab=>residentIds.includes(tab.id)&&modes[tab.id]==='native').map(tab=>[tab.id,{owner:ownerFor(tab.id)}]));
  return h(PanelBoundary,{ref:value=>{story.boundary=value},onFailure:()=>story.errors.push('boundary failure'),onRetry:noop},h(Suspense,{fallback:h('p',{'data-loading':true},'Synthetic route loading')},h(Body,{tabs,residentIds,epoch,active})));
 }
 flushSync(()=>root.render(h(StrictMode,null,h(Host))));
 if(!story.suspend&&!story.error)await until(()=>residents.every(id=>modes[id]==='frame'?context.iframeRefs.current.get(id)?.contentWindow?.fixtureReady:ownerFor(id).node?.isConnected),'fixture editor mount deadline');
 for(const id of options.frames??[]){const frame=context.iframeRefs.current.get(id);if(frame){frame.contentWindow.story.fail=story.fail;frame.contentWindow.story.late=story.late;frame.contentWindow.story.checkpoint=story.checkpoint;}}
 function sourceNativeNavigate(){
  const state=ref({active:true,accountCleared:false,tab:context.tabsRef.current.find(tab=>tab.id==='a'),userId:'fixture-user',workspaceId:'fixture-workspace'});
  const nativeContext={...context,mounted:ref(true),current:state,navigationSequence:ref(0),workspaceSlug:'fixture',userId:'fixture-user',workspaceId:'fixture-workspace',tab:state.current.tab,
   prepareNavigation:context.prepareNativeNavigation??context.prepareNativePanelNavigation,
   setNavigationError:error=>{if(error)story.errors.push(error)},
   post:message=>{story.messages.push(message);if(['navigation-start','location-replace'].includes(message.type)){if(story.late==='aftercheck')queueMicrotask(()=>inject(ownerFor('a')));context.updateTabForShellNavigation('a',message.url)}},
  };
  const callback=evaluate('nativeNavigate',nativeContext);callback.fixtureState=nativeContext;return callback;
 }
 return{story,context,element,navigate:sourceNativeNavigate,ownerFor,inject,
  armPaint(label,predicate){const started=performance.now();let committedAt=null,settled=false,cancelPaint=noop,resolveResult;const promise=new Promise(resolve=>{resolveResult=resolve});
   const finish=painted=>{if(settled)return;settled=true;clearTimeout(timeout);cancelPaint();story.paintCheckpoint=null;story.paintCleanup=null;const ended=performance.now();painted=painted&&ended-started<=2000;resolveResult({label,painted,durationMs:ended-started,commitDurationMs:committedAt===null?null:committedAt-started,visibility:document.visibilityState,hasFocus:document.hasFocus(),...(!painted?{error:'No committed visible two-frame paint within 2000ms'}:{})})};
   const timeout=setTimeout(()=>finish(false),2000);story.paintCleanup=()=>finish(false);
   story.paintCheckpoint=state=>{if(committedAt!==null||!predicate(state))return;committedAt=performance.now();cancelPaint=afterVisibleWorkspacePaint(()=>finish(true),{visible:()=>document.visibilityState==='visible',requestFrame:callback=>requestAnimationFrame(callback),cancelFrame:frame=>cancelAnimationFrame(frame),subscribe:update=>{document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update)}})};
   return{promise};
  },
  async settle(){await wait(35);await until(()=>{if(story.throwing)return Boolean(element.querySelector('[role="alert"]'));if(story.suspension&&!story.suspension.done)return Boolean(element.querySelector('[data-loading]'));const expected=context.tabsRef.current.filter(tab=>context.residentTabIdsRef.current.includes(tab.id));return expected.every(tab=>modes[tab.id]==='frame'?context.iframeRefs.current.get(tab.id)?.isConnected:Boolean(element.querySelector('[data-editor="'+tab.id+'"][data-route="'+tab.url+'"]')))&&element.querySelectorAll('input[data-editor],iframe[data-frame]').length===expected.length},'React DOM did not settle within 1500ms')},
  assertNoLoss(){const frameLoss=[...context.iframeRefs.current.values()].flatMap(frame=>frame.contentWindow?.story?.lost??[]);assert(!story.lost.length&&!frameLoss.length,'accepted editor input lost: '+JSON.stringify([...story.lost,...frameLoss]));assert(!story.frameLost?.length,'frame late input lost: '+JSON.stringify(story.frameLost))},
  close(){story.recordLoss=false;story.paintCleanup?.();lossObserver.disconnect();for(const frame of context.iframeRefs.current.values())if(frame.contentWindow?.story)frame.contentWindow.story.recordLoss=false;flushSync(()=>root.unmount());element.remove()},
 };
}
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.kind==='fixture-frame-loss'){if(window.activeFixture){window.activeFixture.story.frameLost??=[];window.activeFixture.story.frameLost.push(event.data.id)}}});
async function run(name,options,action){let f;const started=performance.now();try{f=await fixture(options);window.activeFixture=f;await action(f);await f.settle();f.assertNoLoss();results.push({name,passed:true,lateAttempts:f.story.lateAttempted,acceptedLateInputs:f.story.injections,flushes:f.story.flushes,durationMs:Math.round(performance.now()-started)})}catch(error){results.push({name,passed:false,error:error.message,durationMs:Math.round(performance.now()-started)})}finally{f?.close();window.activeFixture=null;document.querySelector('#result').textContent=JSON.stringify({status:'running',cases:results},null,2)}}
await run('host close commits before late native input',{late:'aftercheck'},async f=>{await f.context.closeTab('a');assert(!f.context.tabsRef.current.some(t=>t.id==='a'),'close did not update tabs')});
await run('host close commits before late iframe input',{frames:['a'],late:'aftercheck'},async f=>{await f.context.closeTab('a');assert(!f.context.tabsRef.current.some(t=>t.id==='a'),'iframe close refused')});
await run('failed iframe save retains mounted editor',{frames:['a'],fail:true},async f=>{await f.context.closeTab('a');assert(f.context.iframeRefs.current.get('a')?.isConnected,'failed frame removed');assert(f.story.errors.length,'missing iframe save error')});
await run('host Retry commits before late native input',{late:'aftercheck'},async f=>{await f.context.retryActiveNavigation();assert(f.story.messages.some(m=>m.type==='retry'),'Retry command missing')});
await run('native to iframe owner replacement',{late:'aftercheck'},async f=>{await f.context.navigateActiveTab('/fixture/frame/destination')});
await run('iframe to native owner replacement',{frames:['a'],late:'aftercheck'},async f=>{await f.context.navigateActiveTab('/fixture/native/destination');assert(f.context.tabsRef.current.find(t=>t.id==='a').url==='/fixture/native/destination','frame replacement refused')});
await run('full resident pool switch evicts acknowledged frame',{frames:['c'],late:'aftercheck'},async f=>{await f.context.switchTab(f.context.tabsRef.current.find(t=>t.id==='d'));assert(f.context.activeTabIdRef.current==='d','switch refused');assert(f.context.residentTabIdsRef.current.length===3,'resident bound changed')});
await run('reopen evicts only safe resident frame',{ids:['a','b','c','d'],frames:['c'],late:'aftercheck'},async f=>{f.context.tabsRef.current=f.context.tabsRef.current.filter(t=>t.id!=='d');const ok=await f.context.reopenClosedTab();assert(ok,'reopen refused')});
await run('native in-panel push commits before late input',{late:'aftercheck'},async f=>{await f.navigate()('/fixture/native/push');assert(f.context.tabsRef.current.find(t=>t.id==='a').url==='/fixture/native/push','push was not committed')});
await run('native in-panel replace commits before late input',{late:'aftercheck'},async f=>{await f.navigate()('/fixture/native/replace',true);assert(f.context.tabsRef.current.find(t=>t.id==='a').url==='/fixture/native/replace','replace was not committed')});
await run('failed save retains mounted editor',{fail:true},async f=>{await f.context.closeTab('a');assert(f.ownerFor('a').node?.isConnected,'failed editor removed');assert(f.story.errors.length,'no save error shown');for(const owner of f.story.owners.values())owner.saved=owner.draft});
await run('input during pending save refuses departure',{slow:true},async f=>{const pending=f.context.closeTab('a');f.inject(f.ownerFor('a'));f.story.gate.release();await pending;assert(f.ownerFor('a').node?.isConnected,'late edited owner removed');assert(f.story.errors.length,'missing late edit refusal');for(const owner of f.story.owners.values())owner.saved=owner.draft});
await run('A to B to A cancels stale continuation',{slow:true},async f=>{const pending=f.context.switchTab(f.context.tabsRef.current.find(t=>t.id==='b'));await f.context.switchTab(f.context.tabsRef.current.find(t=>t.id==='a'));f.story.gate.release();await pending;assert(f.context.activeTabIdRef.current==='a','older navigation won')});
await run('full pool speculative warm checkpoints without network',{frames:['c'],checkpoint:true},async f=>{await f.context.warmWorkspaceTab('d');assert(f.story.flushes===0,'speculative network flush occurred');assert(f.context.residentTabIdsRef.current.join(',')==='a,d,b','unexpected residency');for(const owner of f.story.owners.values())owner.saved=owner.draft});
await run('Suspense pending native panel Retry settles',{suspend:true},async f=>{await f.context.retryActiveNavigation();f.story.suspension.done=true;f.story.suspension.release();await until(()=>f.element.querySelector('[data-editor="a"]'),'suspended editor did not mount within 1500ms');for(const owner of f.story.owners.values())owner.saved=owner.draft});
await run('error boundary explicit Retry restores native editor',{error:true},async f=>{assert(f.element.querySelector('[role="alert"]'),'missing error boundary');await f.context.retryActiveNavigation();await f.settle();assert(f.element.querySelector('[data-editor="a"]'),'boundary Retry did not mount editor');for(const owner of f.story.owners.values())owner.saved=owner.draft});
await run('reopen has one activation save and storage effect',{frames:['c']},async f=>{f.context.tabsRef.current=f.context.tabsRef.current.filter(t=>t.id!=='d');assert(await f.context.reopenClosedTab(),'reopen refused');await f.settle();assert(f.story.sideEffects.activate===1&&f.story.sideEffects.save===1&&f.story.sideEffects.storage===1,'replayed reopen side effects '+JSON.stringify(f.story.sideEffects))});
await run('owner-free resident frame switch stays asynchronous',{frames:['a','b','c']},async f=>{await f.context.switchTab(f.context.tabsRef.current.find(t=>t.id==='b'));assert(f.context.activeTabIdRef.current==='b','frame resident switch failed');assert(f.story.synchronousCommits===0,'owner-free switch unnecessarily forced React commit');assert(f.story.flushes===0,'owner-free frame switch started shell save')});
await run('native input during pending save is retained',{slow:true},async f=>{const pending=f.navigate()('/fixture/native/push');f.inject(f.ownerFor('a'));f.story.gate.release();await pending;assert(f.context.tabsRef.current.find(t=>t.id==='a').url==='/fixture/native/a','late native edit lost to navigation');for(const owner of f.story.owners.values())owner.saved=owner.draft});
await run('native account change aborts pending navigation',{slow:true},async f=>{const navigate=f.navigate(),pending=navigate('/fixture/native/push');navigate.fixtureState.current.current.accountCleared=true;f.story.gate.release();await pending;assert(f.context.tabsRef.current.find(t=>t.id==='a').url==='/fixture/native/a','cleared account navigated')});
await run('native owner replacement fences pending navigation',{slow:true},async f=>{const pending=f.navigate()('/fixture/native/push');f.context.nativeRefs.current.set('a',{owner:{}});f.story.gate.release();await pending;assert(f.context.tabsRef.current.find(t=>t.id==='a').url==='/fixture/native/a','replacement native owner accepted stale navigation')});
await run('Suspense destination cannot accept late departed editor input',{late:'aftercheck'},async f=>{f.story.suspension=deferred();await f.context.navigateActiveTab('/fixture/native/suspense');f.story.suspension.done=true;f.story.suspension.release();await until(()=>f.element.querySelector('[data-route="/fixture/native/suspense"]'),'Suspense destination did not settle');});
for(let index=0;index<5;index++)await run('synthetic warm native switch painted sample '+(index+1),{},async f=>{for(const owner of f.story.owners.values())owner.saved=owner.draft;const observation=f.armPaint('warm '+(index+1),state=>state.active==='b');await f.context.switchTab(f.context.tabsRef.current.find(t=>t.id==='b'));await until(()=>f.element.querySelector('[data-active="b"]'),'warm target did not commit');assert(f.context.activeTabIdRef.current==='b','wrong active tab');assert(f.element.querySelector('[data-editor="b"]'),'missing usable destination');await recordPaint(delays,observation)});
for(let index=0;index<5;index++)await run('synthetic gated destination painted sample '+(index+1),{},async f=>{f.story.suspension=deferred();const observation=f.armPaint('gated destination '+(index+1),state=>state.tabs.find(tab=>tab.id==='a')?.url==='/fixture/native/cold');await f.context.navigateActiveTab('/fixture/native/cold');await wait(10);f.story.suspension.done=true;f.story.suspension.release();await until(()=>f.element.querySelector('[data-route="/fixture/native/cold"]'),'gated destination missing within 1500ms');await recordPaint(coldDelays,observation);for(const owner of f.story.owners.values())owner.saved=owner.draft});
const report={status:'complete',sourceManifest:SOURCE_MANIFEST,variant:VARIANT,reactVersion:React.version,buildMode:BUILD_MODE,userAgent:navigator.userAgent,passed:results.filter(item=>item.passed).length,total:results.length,missingPaintSamples:missingPaint.length,missingPaint,paintDefinition:'Action start to matching committed Body layout effect plus the actual afterVisibleWorkspacePaint helper; both animation frame opportunities must be visible. Bounded at 2000ms with missing samples explicit.',cases:results,paintedWarmSwitchSamplesMs:delays.map(value=>Math.round(value*10)/10),paintedGatedDestinationSamplesMs:coldDelays.map(value=>Math.round(value*10)/10),limits:'Real React tree and extracted application callbacks, synthetic editors and mock shell dependencies. Synthetic frame receiver, no full app/auth/provider/physical-device evidence. Small timing samples are observations, not production speed.'};
window.departureFixtureResult=report;document.querySelector('#result').textContent=JSON.stringify(report,null,2);document.title='Departure '+report.passed+'/'+report.total+' '+VARIANT;
try{const response=await fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});if(!response.ok)throw new Error('Result persistence HTTP '+response.status);document.querySelector('#result').textContent+='\nEvidence: '+(await response.json()).path}catch(error){document.querySelector('#result').textContent+='\nEvidence persistence failed: '+error.message}
`;
const frameBrowser = String.raw`
import * as mutations from './workspace-mutations.js';
import {WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE,WORKSPACE_FRAME_PAGE_ATTRIBUTE,WORKSPACE_FRAME_DEPARTURE_CONFIRM_EVENT} from './workspace-tab-departure.js';
import {WORKSPACE_TAB_MESSAGE_SOURCE} from './workspace-tabs.js';
const id=new URL(location.href).searchParams.get('id'),documentId=crypto.randomUUID(),input=document.querySelector('input');
const story=window.story={draft:'unsaved '+id,saved:'saved '+id,lost:[],recordLoss:true};
document.documentElement.setAttribute(WORKSPACE_FRAME_DOCUMENT_ATTRIBUTE,documentId);document.documentElement.setAttribute(WORKSPACE_FRAME_PAGE_ATTRIBUTE,'true');
input.value=story.draft;input.addEventListener('input',()=>{story.draft=input.value});
mutations.registerWorkspaceAutosaveFlusher(async()=>{if(story.fail)return false;story.saved=story.draft;return true},{checkpoint:()=>{if(story.checkpoint)story.saved=story.draft;return story.saved===story.draft}});
let pending;
window.addEventListener('message',async event=>{const message=event.data;if(event.origin!==location.origin||event.source!==parent||message?.source!==WORKSPACE_TAB_MESSAGE_SOURCE||message.type!=='prepare-departure'||message.tabId!==id)return;pending?.check.dispose();const check=mutations.captureWorkspaceAutosaveDepartureCheck();pending={requestId:message.requestId,check};const safe=message.checkpointOnly?mutations.checkpointWorkspaceAutosaves():await mutations.flushWorkspaceAutosaves(1500,{navigation:true});check.acknowledge();parent.postMessage({...message,target:'host',type:'departure-ready',safe},location.origin)});
window.addEventListener(WORKSPACE_FRAME_DEPARTURE_CONFIRM_EVENT,event=>{if(!pending||event.detail.requestId!==pending.requestId)return;event.detail.safe=pending.check.validate();pending.check.dispose();pending=null;if(event.detail.safe&&story.late==='aftercheck')queueMicrotask(()=>{if(frameElement?.isConnected){story.draft='late frame edit';input.value=story.draft;input.dispatchEvent(new Event('input',{bubbles:true}))}})});
window.addEventListener('pagehide',()=>{if(story.recordLoss&&story.draft!==story.saved)parent.postMessage({kind:'fixture-frame-loss',id},location.origin)});
window.fixtureReady=true;
`;
const sourceManifest = Object.fromEntries([...sourceCache].map(([path, text]) => [path, createHash("sha256").update(text).digest("hex")]))
writeFileSync(join(directory, "runner.js"), browser.replaceAll("SOURCE_MANIFEST", JSON.stringify(sourceManifest)).replaceAll("VARIANT", JSON.stringify(baseline ? "baseline 7a35b73d" : "candidate")).replaceAll("BUILD_MODE", JSON.stringify(development ? "development StrictMode replay" : "production")))
writeFileSync(join(directory, "frame.js"), frameBrowser)
await new Promise((resolveBuild, reject) => webpack({ mode: development ? "development" : "production", devtool: false, entry: { runner: join(directory, "runner.js"), frame: join(directory, "frame.js") }, output: { path: directory, filename: "[name].bundle.js" }, resolve: { modules: [resolve("node_modules"), "node_modules"] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolveBuild()))
const html = `<!doctype html><meta charset="utf-8"><title>Departure fixture running</title><style>body{font:14px system-ui;background:#171717;color:#eee}#stage{border:1px solid #888;padding:8px}input{display:block;margin:8px}iframe{width:320px;height:70px}pre{white-space:pre-wrap}</style><h1>Workspace departure: ${baseline ? "baseline 7a35b73d" : "candidate"}</h1><p>Local mounted React fixture. Synthetic editors; no client data or remote requests.</p><div id="stage"></div><pre id="result">Running…</pre><script src="/runner.bundle.js"></script>`
const routes = new Map([["/", ["text/html", html]], ["/frame", ["text/html", '<!doctype html><meta charset="utf-8"><input aria-label="Synthetic frame editor"><script src="/frame.bundle.js"></script>']], ...["runner", "frame"].map(name => [`/${name}.bundle.js`, ["text/javascript", readFileSync(join(directory, `${name}.bundle.js`))]])])
const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname
    if (pathname === "/results") {
        if (request.method !== "POST" || request.headers.origin !== `http://127.0.0.1:${server.address().port}` || request.headers["content-type"] !== "application/json") { response.writeHead(403); response.end(); return }
        const chunks = []
        let bytes = 0
        request.on("data", (chunk) => { bytes += chunk.length; if (bytes > 262144) { response.writeHead(413); response.end(); request.destroy(); return }; chunks.push(chunk) })
        request.on("end", () => {
            try {
                const result = JSON.parse(Buffer.concat(chunks).toString("utf8"))
                if (result.status !== "complete" || !Array.isArray(result.cases) || result.cases.length > 100) throw new Error("Invalid fixture report")
                const path = join(directory, `results-${randomUUID()}.json`)
                writeFileSync(path, JSON.stringify(result, null, 2))
                response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ path }))
                console.log(JSON.stringify({ resultPath: path, passed: result.passed, total: result.total, userAgent: result.userAgent }))
            } catch { response.writeHead(400); response.end() }
        })
        return
    }
    const route = routes.get(pathname)
    if (!route) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { "Content-Type": route[0], "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'" })
    response.end(route[1])
})
server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, variant: baseline ? "baseline 7a35b73d" : "candidate", buildMode: development ? "development" : "production", bundleDirectory: directory, sourceManifest })))
