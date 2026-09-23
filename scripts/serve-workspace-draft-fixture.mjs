// Loopback-only mounted runtime fixture. No account, provider or client data.
// Run with --development for real React StrictMode effect replay.
import { createServer } from "node:http"
import { createHash, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import ts from "typescript"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const development = process.argv.includes("--development")
const directory = mkdtempSync(join(tmpdir(), "be-draft-fixture-"))
const sources = [
    "components/work-items/useWorkItemTextDraft.ts",
    "components/work-items/WorkItemTextField.tsx",
    "components/workspace/WorkspaceAutosaveForm.tsx",
    "components/workspace/WorkspaceDraftRecovery.tsx",
    "lib/workspace-draft-journal.ts",
    "lib/workspace-mutations.ts",
    "lib/record-version.js",
]
const aliases = new Map([
    ...sources.map(path => ["@/" + path.replace(/\.(tsx?|js)$/, ""), "./" + path.split("/").at(-1).replace(/\.tsx?$/, ".js")]),
    ["@/components/workspace/WorkspaceNavigation", "./mock-navigation.js"],
    ["@/lib/ui/gantt-sync", "./mock-navigation.js"],
    ["@/components/ui", "./mock-ui.js"],
    ["@/components/detail", "./mock-ui.js"],
    ["@/components/list/List", "./mock-ui.js"],
    ["./WorkspaceDraftRecovery", "./WorkspaceDraftRecovery.js"],
])
const sourceManifest = {}
for (const path of sources) {
    const original = readFileSync(path, "utf8")
    sourceManifest[path] = createHash("sha256").update(original).digest("hex")
    let source = original
    for (const [from, to] of aliases) source = source.replaceAll(`"${from}"`, JSON.stringify(to))
    const compiled = ts.transpileModule(source, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } })
    if (compiled.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw Error(ts.formatDiagnosticsWithColorAndContext(compiled.diagnostics, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: value => value, getNewLine: () => "\n" }))
    writeFileSync(join(directory, path.split("/").at(-1).replace(/\.tsx?$/, ".js")), compiled.outputText)
}
writeFileSync(join(directory, "mock-navigation.js"), `const router={refresh(){if(window.draftFixtureStory)window.draftFixtureStory.refreshes++}}; export const useRouter=()=>router; export function postGanttSync(){if(window.draftFixtureStory)window.draftFixtureStory.ganttSyncs++}`)
writeFileSync(join(directory, "mock-ui.js"), `import React from 'react';import {createPortal} from 'react-dom';const h=React.createElement;export function CenteredDialog({title,onClose,children}){return createPortal(h('div',{role:'dialog','aria-label':title},h('h2',null,title),h('button',{type:'button',onClick:onClose},'Close recovery'),children),document.body)}export function Status({label}){return h('span',null,label)}export function DetailField({children,label}){return h('section',null,h('strong',null,label),children)}export function List({children,ariaLabel}){return h('div',{role:'list','aria-label':ariaLabel},children)}export const ListItem=({children})=>h('div',{role:'listitem'},children);export const ListPrimaryRow=({children})=>h('div',null,children);export const ListSecondaryRow=ListPrimaryRow,ListTitle=ListPrimaryRow,ListTrailing=ListPrimaryRow;`)

const browser = String.raw`
import React,{useCallback,useLayoutEffect,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useWorkItemTextDraft} from './useWorkItemTextDraft.js';
import {workItemTextField} from './WorkItemTextField.js';
import {WorkspaceAutosaveForm} from './WorkspaceAutosaveForm.js';
import {createWorkspaceDraftJournal,workspaceDraftJournalPrefix} from './workspace-draft-journal.js';
import {checkpointWorkspaceAutosaves,flushWorkspaceAutosaves} from './workspace-mutations.js';
const h=React.createElement,version1='2026-09-23T10:00:00.000001Z',version2='2026-09-23T10:00:00.000002Z';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(ok,message)=>{if(!ok)throw Error(message)};
async function until(test,message){const end=performance.now()+1800;while(performance.now()<end){if(test())return;await wait(10)}if(!test())throw Error(message)}
const original={set:Storage.prototype.setItem,get:Storage.prototype.getItem,remove:Storage.prototype.removeItem,key:Storage.prototype.key,length:Object.getOwnPropertyDescriptor(Storage.prototype,'length')};
const instrumentation={writes:[],removes:[],reads:0,deniedEnumerations:0,deny:null,unexpectedRequests:[]};
const owned=key=>typeof key==='string'&&key.startsWith('betelgeze:record-draft:v1:fixture-');
Storage.prototype.setItem=function(key,value){if(this===localStorage&&owned(key)){instrumentation.writes.push({key,bytes:value.length});if(instrumentation.deny)throw new DOMException('Synthetic storage failure',instrumentation.deny==='quota'?'QuotaExceededError':'SecurityError')}return original.set.call(this,key,value)};
Storage.prototype.getItem=function(key){if(this===localStorage&&owned(key)){instrumentation.reads++;if(instrumentation.deny==='unavailable')throw new DOMException('Synthetic storage unavailable','SecurityError')}return original.get.call(this,key)};
Storage.prototype.removeItem=function(key){if(this===localStorage&&owned(key)){instrumentation.removes.push(key);if(instrumentation.deny)throw new DOMException('Synthetic storage failure','SecurityError')}return original.remove.call(this,key)};
Object.defineProperty(Storage.prototype,'length',{...original.length,get(){if(this===localStorage&&instrumentation.deny==='unavailable'){instrumentation.deniedEnumerations++;throw new DOMException('Synthetic storage enumeration unavailable','SecurityError')}return original.length.get.call(this)}});
const originalFetch=window.fetch.bind(window);
window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.origin!==location.origin||url.pathname!=='/results'){instrumentation.unexpectedRequests.push(url.pathname);return Promise.reject(Error('Fixture refused unexpected network request'))}return originalFetch(input,options)};
const cases=[];
const define=(name,kind,action)=>cases.push({name,kind,action});
function TextOwner({state,story}){
 const save=useCallback((value,version,baseline)=>story.request({value,version,baseline,userId:state.scope.userId,workspaceSlug:state.scope.workspaceSlug}),[story,state.scope.userId,state.scope.workspaceSlug]);
 const onSaved=useCallback(()=>{story.savedCallbacks++},[story]);
 const draft=useWorkItemTextDraft({userId:state.scope.userId,workspaceSlug:state.scope.workspaceSlug,recordType:state.scope.recordType,workItemId:state.scope.recordId,field:state.scope.field,updatedAt:state.version,description:state.value,label:'Description',save,onSaved});
 useLayoutEffect(()=>{story.draft=draft});
 return h('div',{'data-kind':'text'},workItemTextField('Description',draft));
}
function FormOwner({state,story}){
 const action=useCallback(data=>story.request({value:data.get('title'),expectedUser:data.get('__workspace_expected_user'),userId:state.scope.userId,workspaceSlug:state.scope.workspaceSlug}),[story,state.scope.userId,state.scope.workspaceSlug]);
 return h(WorkspaceAutosaveForm,{action,recoveryScope:state.scope,recoveryFields:['title'],debounceMs:800},h('input',{name:'title','aria-label':'Form title',defaultValue:state.value}),h('button',{type:'submit'},'Save form'));
}
async function fixture(kind,runId,index){
 const element=document.createElement('div');document.querySelector('#stage').append(element);const root=createRoot(element);
 let state={scope:{userId:'fixture-'+runId,workspaceSlug:'synthetic-workspace',recordType:kind==='text'?'work-item':'settings',recordId:'case-'+index,field:kind==='text'?'description':'form'},value:'Original server',version:version1},mounted=false,closed=false,keyOwner=true;
 const story={calls:[],draft:null,savedCallbacks:0,refreshes:0,ganttSyncs:0,request:null};
 // A simple controlled promise records the exact server seam; it never fetches.
 story.request=input=>new Promise(resolve=>{const call={...input,settled:false,resolve(result){call.settled=true;resolve(result)}};story.calls.push(call)});
 window.draftFixtureStory=story;
 function render(patch={},options={}){assert(!closed,'Fixture is closed');state={...state,...patch};if(options.keyOwner!==undefined)keyOwner=options.keyOwner;const component=kind==='text'?TextOwner:FormOwner;const body=h(component,{state,story,key:keyOwner?JSON.stringify(state.scope):'fixed-owner'});flushSync(()=>root.render(STRICT_MODE?h(StrictMode,null,body):body));mounted=true}
 function unmount(){if(mounted){flushSync(()=>root.render(null));mounted=false}}
 const input=()=>element.querySelector(kind==='text'?'textarea[aria-label="Description"]':'input[name="title"]');
 function type(value){assert(input(),'Editor missing');const node=input();const prototype=kind==='text'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;flushSync(()=>{Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))});assert(input().value===value,'Typed value was not rendered')}
 function click(text){const button=[...document.querySelectorAll('button')].find(node=>node.textContent===text);assert(button,'Missing button: '+text);flushSync(()=>button.click())}
 const journal=(scope=state.scope)=>createWorkspaceDraftJournal(scope);
 const read=async(scope=state.scope)=>(await journal(scope).review()).drafts;
 const seed=value=>{const draft=kind==='text'?value:JSON.stringify([['title',value]]);assert(journal().checkpoint({value:draft,baseline:kind==='text'?'Seed baseline':JSON.stringify([['title','Seed baseline']]),version:version1}),'Seed checkpoint failed')};
 const save=()=>flushWorkspaceAutosaves(2500);
 const settle=()=>wait(20);
 async function recover(){await until(()=>[...document.querySelectorAll('button')].some(node=>node.textContent==='Review saved drafts'),'Recovery prompt missing');click('Review saved drafts');await until(()=>[...document.querySelectorAll('[role="dialog"] button')].some(node=>node.textContent==='Review'),'Recovery list missing');click('Review');assert(document.querySelector('[role="dialog"] textarea[readonly]'),'Current/saved comparison missing');click('Use this draft');await settle()}
 function cleanup(){instrumentation.deny=null;unmount();for(const call of story.calls)if(!call.settled)call.resolve({ok:false,error:'Fixture ended'});root.unmount();element.remove();closed=true;window.draftFixtureStory=null;for(let index=localStorage.length-1;index>=0;index--){const key=original.key.call(localStorage,index);if(key?.startsWith(workspaceDraftJournalPrefix(state.scope))||key?.includes('fixture-'+runId))original.remove.call(localStorage,key)}}
 render();await settle();return{kind,story,element,input,type,click,render,unmount,read,seed,save,settle,recover,cleanup,get state(){return state},get scope(){return state.scope}};
}
for(const kind of ['text','form']){
 define(kind+': ordinary typing writes zero localStorage records',kind,async f=>{const count=instrumentation.writes.length;for(const value of ['a','ab','abc','Synthetic final'])f.type(value);await f.settle();assert(instrumentation.writes.length===count,'Typing performed a storage write');assert(f.story.calls.length===0,'Typing immediately submitted a save');return{typingWrites:0,typedInputs:4}});
 define(kind+': late input survives pending save and owner unmount',kind,async f=>{f.type('Submitted first');const pending=f.save();await until(()=>f.story.calls.length===1,'Save did not start');f.type('Late input must survive');const oldScope=f.scope;f.unmount();f.story.calls[0].resolve({ok:true,version:version2});assert(await pending===false,'Destroyed owner accepted stale acknowledgement');const drafts=await f.read(oldScope);assert(drafts.some(row=>row.value.includes('Late input must survive')),'Late text was lost at unmount');assert(f.story.calls.length===1,'Destroyed owner submitted later text');assert(f.story.savedCallbacks===0,'Destroyed text owner published saved callback');f.render({value:'Submitted first',version:version2});await f.settle();assert(f.input().value==='Submitted first','Recovery overwrote server text automatically');assert(f.story.calls.length===1,'Remount auto-saved recovered text');return{saveCalls:1,recoveredLateInput:true}});
 define(kind+': explicit review restores and waits for Save reviewed draft',kind,async f=>{f.unmount();f.seed('Saved recovery copy');f.render({value:'Current server',version:version2});await f.settle();assert(f.input().value==='Current server','Mount silently recovered');assert(f.story.calls.length===0,'Mount submitted recovery');await f.recover();assert(f.input().value==='Saved recovery copy','Reviewed copy not restored');assert(await f.save()===false,'Ordinary flush bypassed explicit recovery confirmation');await wait(900);assert(f.story.calls.length===0,'Recovery debounce submitted without confirmation');f.click('Save reviewed draft');await until(()=>f.story.calls.length===1,'Explicit reviewed save did not start');assert(f.story.calls[0].value==='Saved recovery copy','Wrong recovered payload');if(kind==='form')assert(f.story.calls[0].expectedUser===f.scope.userId,'Expected actor missing from form command');f.story.calls[0].resolve({ok:true,version:version2});await f.settle();return{automaticSaveCalls:0,explicitSaveCalls:1}});
 define(kind+': choosing recovery during a pending save cannot auto-submit it',kind,async f=>{f.unmount();f.seed('Recovered while saving');f.render();await f.settle();f.type('Earlier request');const pending=f.save();await until(()=>f.story.calls.length===1,'Earlier save missing');await f.recover();assert(f.input().value==='Recovered while saving','Recovered value absent');f.story.calls[0].resolve({ok:true,version:version2});await pending;await f.settle();assert(f.story.calls.length===1,'Old acknowledgement auto-submitted recovered text');assert(f.input().value==='Recovered while saving','Old acknowledgement replaced recovered text');assert([...document.querySelectorAll('button')].some(node=>node.textContent==='Save reviewed draft'),'Explicit recovery gate disappeared');f.click('Save reviewed draft');await until(()=>f.story.calls.length===2,'Reviewed recovery did not submit');f.story.calls[1].resolve({ok:true,version:version2});await f.settle();return{callsBeforeConfirmation:1,callsAfterConfirmation:2}});
 define(kind+': quota failure refuses checkpoint and retains latest draft in this document',kind,async f=>{f.type('Quota retained copy');instrumentation.deny='quota';let safe;flushSync(()=>{safe=checkpointWorkspaceAutosaves()});assert(safe===false,'Quota checkpoint claimed durable success');await f.settle();assert(f.element.textContent.includes('Device storage is unavailable'),'Storage failure is not visible');const scope=f.scope;f.unmount();const drafts=await f.read(scope);assert(drafts.some(row=>row.value.includes('Quota retained copy')&&!row.durable),'Memory-retained draft missing');instrumentation.deny=null;f.render();await f.recover();assert(f.input().value==='Quota retained copy','New owner could not explicitly recover retained draft');assert(f.story.calls.length===0,'Quota recovery submitted without confirmation');return{durable:false,retainedInDocument:true}});
 define(kind+': unavailable storage is disclosed during explicit recovery',kind,async f=>{f.type('Blocked storage copy');const before=instrumentation.deniedEnumerations;instrumentation.deny='unavailable';flushSync(()=>checkpointWorkspaceAutosaves());f.unmount();f.render();await f.settle();f.click('Review saved drafts');await until(()=>document.querySelector('[role="dialog"] [role="alert"]'),'Unreadable storage warning absent');assert(instrumentation.deniedEnumerations>before,'Storage read failure was never injected');assert(document.querySelector('[role="dialog"]').textContent.includes('Open page only'),'In-memory recovery was labeled durable');assert(f.story.calls.length===0,'Reading recovery submitted a save');return{warningVisible:true,deniedEnumerationCalls:instrumentation.deniedEnumerations-before}});
 define(kind+': actor/workspace replacement fences stale acknowledgement',kind,async f=>{f.type('Actor A unfinished');const pending=f.save();await until(()=>f.story.calls.length===1,'Actor A save missing');const oldScope=f.scope;const nextScope={...oldScope,userId:oldScope.userId+'-other',workspaceSlug:'other-workspace'};f.render({scope:nextScope,value:'Actor B server',version:version2});await f.settle();f.story.calls[0].resolve({ok:true,version:version2});await pending;await f.settle();assert(f.input().value==='Actor B server','Stale actor acknowledgement overwrote new owner');assert(f.story.calls.length===1,'Old owner submitted in new scope');assert(!(await f.read(nextScope)).length,'New actor can review old actor draft');assert((await f.read(oldScope)).some(row=>row.value.includes('Actor A unfinished')),'Old actor draft was not retained');return{oldActorRetained:true,newActorIsolated:true}});
 define(kind+': account clearing closes recovery and fences pending work',kind,async f=>{f.unmount();f.seed('Account private copy');f.render();await f.settle();f.type('Account pending copy');const pending=f.save();await until(()=>f.story.calls.length===1,'Pending account save missing');f.click('Review saved drafts');await until(()=>document.querySelector('[role="dialog"]'),'Recovery dialog missing');flushSync(()=>window.dispatchEvent(new Event('betelgeze:offline-account-clearing')));assert(!document.querySelector('[role="dialog"]'),'Account clearing left private recovery dialog open');f.story.calls[0].resolve({ok:true,version:version2});assert(await pending===false,'Cleared account accepted stale save');assert(await f.save()===false,'Cleared owner accepted new save');return{dialogClosed:true,staleAcknowledgementRefused:true}});
 define(kind+': matching preserved account keeps recovery and pending owner active',kind,async f=>{f.unmount();f.seed('Preserved account copy');f.render();await f.settle();f.type('Preserved pending copy');const pending=f.save();await until(()=>f.story.calls.length===1,'Preserved account save missing');f.click('Review saved drafts');await until(()=>document.querySelector('[role="dialog"]'),'Preserved account dialog missing');flushSync(()=>window.dispatchEvent(new CustomEvent('betelgeze:offline-account-clearing',{detail:{preservedUserId:f.scope.userId}})));assert(document.querySelector('[role="dialog"]'),'Matching account recovery was closed');f.click('Close recovery');f.story.calls[0].resolve({ok:true,version:version2});assert(await pending===true,'Matching account pending save was stopped');f.type('Preserved owner still editable');const newer=f.save();await until(()=>f.story.calls.length===2,'Matching account owner no longer saves');f.story.calls[1].resolve({ok:true,version:version2});assert(await newer===true,'Matching account second save failed');return{preservedAccountActive:true}});
 define(kind+': displaced preserved account closes recovery and stops old owner',kind,async f=>{f.unmount();f.seed('Displaced account copy');f.render();await f.settle();f.type('Displaced pending copy');const pending=f.save();await until(()=>f.story.calls.length===1,'Displaced account save missing');f.click('Review saved drafts');await until(()=>document.querySelector('[role="dialog"]'),'Displaced account dialog missing');flushSync(()=>window.dispatchEvent(new CustomEvent('betelgeze:offline-account-clearing',{detail:{preservedUserId:'another-fixture-actor'}})));assert(!document.querySelector('[role="dialog"]'),'Displaced account private recovery stayed open');f.story.calls[0].resolve({ok:true,version:version2});assert(await pending===false,'Displaced account accepted stale save');assert(await f.save()===false,'Displaced account can still save');assert((await f.read()).some(row=>row.value.includes('Displaced pending copy')),'Displaced owner lost draft');return{displacedOwnerStopped:true,draftRetained:true}});
 define(kind+': pagehide checkpoint captures text without a server request',kind,async f=>{f.type('Pagehide recovery copy');flushSync(()=>window.dispatchEvent(new Event('pagehide')));const rows=await f.read();assert(rows.some(row=>row.value.includes('Pagehide recovery copy')&&row.durable),'Pagehide checkpoint missing');assert(f.story.calls.length===0,'Pagehide initiated save request');return{syntheticPagehide:true,durable:true}});
}
define('text: concurrent server version preserves local conflict and archives before use-latest','text',async f=>{f.type('Local conflicted text');f.render({value:'Remote newer text',version:version2});await until(()=>f.story.draft.conflict,'Conflict was not surfaced');assert(f.input().value==='Local conflicted text','Incoming snapshot overwrote dirty text');assert(await f.save()===false,'Conflict was silently saved');f.click('Use latest version');await f.settle();assert(f.input().value==='Remote newer text','Use latest did not adopt server text');assert((await f.read()).some(row=>row.value==='Local conflicted text'),'Use latest discarded local conflict');assert(f.story.calls.length===0,'Conflict resolution submitted without editing');return{localConflictRetained:true}});
define('form: rejected save retains current fields and supports explicit retry','form',async f=>{f.type('Rejected form text');const pending=f.save();await until(()=>f.story.calls.length===1,'Form save missing');f.story.calls[0].resolve({ok:false,error:'Synthetic version conflict',conflict:true});assert(await pending===false,'Rejected form save claimed success');await f.settle();assert(f.input().value==='Rejected form text','Rejected fields discarded');assert(f.element.textContent.includes('Synthetic version conflict'),'Rejected result not visible');f.click('Retry');await until(()=>f.story.calls.length===2,'Explicit retry missing');assert(f.story.calls[1].value==='Rejected form text','Retry changed payload');f.story.calls[1].resolve({ok:true,version:version2});await f.settle();return{rejectedDraftRetained:true,retryCalls:1}});
define('text: prop-only scope change resets owner and rejects old async continuation','text',async f=>{f.unmount();f.render({}, {keyOwner:false});await f.settle();f.type('Old prop scope');const pending=f.save();await until(()=>f.story.calls.length===1,'Old prop scope save missing');const old=f.scope;f.render({scope:{...old,recordId:'new-record',userId:old.userId+'-new'},value:'New prop owner',version:version2});await until(()=>f.input()?.value==='New prop owner','Prop-only identity failed to reset editor');f.type('New owner local');const newer=f.save();await until(()=>f.story.calls.length===2,'New owner save blocked by old promise');f.story.calls[0].resolve({ok:true,version:version2});await pending;assert(f.input().value==='New owner local','Old scope acknowledgement altered new editor');f.story.calls[1].resolve({ok:true,version:version2});assert(await newer===true,'New scope save failed');assert((await f.read(old)).some(row=>row.value==='Old prop scope'),'Prop switch lost old draft');return{newOwnerSubmittedIndependently:true}});
let running=false;
async function runAll(){if(running)return;running=true;document.querySelector('#run').disabled=true;document.querySelector('#result').textContent='Starting';const runId=crypto.randomUUID(),results=[];let interrupted=false;
for(let index=0;index<cases.length;index++){const definition=cases[index];let f,timer;const started=performance.now(),startWrites=instrumentation.writes.length;document.querySelector('#progress').textContent=(index+1)+'/'+cases.length+' '+definition.name;try{const observations=await Promise.race([new Promise((_,reject)=>{timer=setTimeout(()=>{interrupted=true;reject(Error('Case exceeded 6500ms; remaining cases not run'))},6500)}),(async()=>{f=await fixture(definition.kind,runId,index);if(interrupted){f.cleanup();throw Error('Fixture mount completed after deadline')}return definition.action(f)})()]);assert(instrumentation.unexpectedRequests.length===0,'Unexpected network request');results.push({name:definition.name,passed:true,observations,storageWrites:instrumentation.writes.length-startWrites,durationMs:Math.round(performance.now()-started)})}catch(error){results.push({name:definition.name,passed:false,error:error.message,storageWrites:instrumentation.writes.length-startWrites,durationMs:Math.round(performance.now()-started)})}finally{clearTimeout(timer);f?.cleanup();instrumentation.deny=null;document.querySelector('#result').textContent=JSON.stringify({status:'running',cases:results},null,2)}if(interrupted)break}
const report={status:'complete',sourceManifest:SOURCE_MANIFEST,reactVersion:React.version,buildMode:BUILD_MODE,userAgent:navigator.userAgent,observedAt:new Date().toISOString(),documentVisibility:document.visibilityState,hasFocus:document.hasFocus(),passed:results.filter(row=>row.passed).length,total:cases.length,completed:results.length,missing:cases.slice(results.length).map(row=>row.name),unexpectedRequests:instrumentation.unexpectedRequests,cases:results,limits:'Actual complete draft hook/form/recovery/journal/mutation runtime and text-field rendering, real React DOM/localStorage. Router/Gantt and presentation primitives mocked; server saves are controlled promises. Synthetic input/pagehide/quota errors, not authenticated app, real termination, OS quota, provider or physical-device evidence. No paint or production speed claim.'};
window.workspaceDraftFixtureResult=report;document.querySelector('#result').textContent=JSON.stringify(report,null,2);document.querySelector('#progress').textContent=report.passed+'/'+report.total+' passed; '+report.missing.length+' missing';document.title='Draft fixture '+report.passed+'/'+report.total;
try{const response=await fetch('/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report),signal:AbortSignal.timeout(4000)});if(!response.ok)throw Error('HTTP '+response.status);document.querySelector('#result').textContent+='\nEvidence: '+(await response.json()).path}catch(error){document.querySelector('#result').textContent+='\nEvidence persistence failed: '+error.message}finally{running=false;document.querySelector('#run').disabled=false}}
document.querySelector('#run').addEventListener('click',()=>void runAll());
if(new URL(location.href).searchParams.has('autorun'))void runAll();
`;
writeFileSync(join(directory, "runner.js"), browser.replaceAll("SOURCE_MANIFEST", JSON.stringify(sourceManifest)).replaceAll("STRICT_MODE", String(development)).replaceAll("BUILD_MODE", JSON.stringify(development ? "development StrictMode replay" : "production")))
await new Promise((resolveBuild, reject) => webpack({ mode: development ? "development" : "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "runner.bundle.js" }, resolve: { modules: [resolve("node_modules"), "node_modules"] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString({ all: false, errors: true }))) : resolveBuild()))
const html = `<!doctype html><meta charset="utf-8"><title>Workspace draft recovery fixture</title><style>body{font:14px system-ui;margin:24px;background:#181818;color:#eee}button{margin:5px;padding:8px}input,textarea{display:block;margin:8px;padding:8px;min-width:300px}#stage{border:1px solid #777;padding:12px}[role=dialog]{position:fixed;inset:5%;padding:20px;background:#303030;overflow:auto;border:2px solid #aaa}pre{white-space:pre-wrap;overflow-wrap:anywhere}#progress{padding:12px}</style><h1>Workspace draft recovery: ${development ? "development StrictMode" : "production React"}</h1><p>Local synthetic data. Actual draft runtime; controlled saves and presentation seams. No live account or provider requests.</p><button id="run">Run regression checks</button><div id="progress">Ready</div><div id="stage"></div><pre id="result">Press Run regression checks. Background browser timers may delay completion; every case has a bounded wait.</pre><script src="/runner.bundle.js"></script>`
const bundle = readFileSync(join(directory, "runner.bundle.js"))
const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname
    if (pathname === "/results") {
        if (request.method !== "POST" || request.headers.origin !== `http://127.0.0.1:${server.address().port}` || request.headers["content-type"] !== "application/json") { response.writeHead(403); response.end(); return }
        let bytes = 0, rejected = false
        const chunks = []
        request.on("data", chunk => { bytes += chunk.length; if (bytes > 262144) { rejected = true; response.writeHead(413); response.end(); request.destroy(); return }; chunks.push(chunk) })
        request.on("end", () => {
            if (rejected) return
            try {
                const report = JSON.parse(Buffer.concat(chunks).toString("utf8"))
                if (report.status !== "complete" || !Array.isArray(report.cases) || report.cases.length > 64 || JSON.stringify(report.sourceManifest) !== JSON.stringify(sourceManifest)) throw Error("Invalid fixture result")
                const path = join(directory, `results-${randomUUID()}.json`)
                writeFileSync(path, JSON.stringify(report, null, 2))
                console.log(JSON.stringify({ resultPath: path, passed: report.passed, total: report.total, missing: report.missing, userAgent: report.userAgent }))
                response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ path }))
            } catch { response.writeHead(400); response.end() }
        })
        return
    }
    if (request.method !== "GET" || !["/", "/runner.bundle.js"].includes(pathname)) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { "Content-Type": pathname === "/" ? "text/html" : "text/javascript", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'" })
    response.end(pathname === "/" ? html : bundle)
})
server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, autorunUrl: `http://127.0.0.1:${server.address().port}/?autorun`, buildMode: development ? "development" : "production", bundleDirectory: directory, sourceManifest })))
