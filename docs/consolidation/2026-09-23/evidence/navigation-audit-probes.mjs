// Read-only diagnostics. These assertions confirm defects in the audited baseline,
// so a later repair is expected to make them fail. No app source or data is changed.
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON navigation-audit-probes.mjs [repository]
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const repo=resolve(process.argv[2] ?? '/private/tmp/betelgeze-platform-consolidation');
const {createWorkspaceFrameNavigator}=await import(pathToFileURL(resolve(repo,'lib/workspace-frame-navigation.ts')).href);
const {nativeWorkspaceRoute}=await import(pathToFileURL(resolve(repo,'lib/workspace-native.ts')).href);
const source=readFileSync(resolve(repo,'components/workspace/WorkspaceTopBarClient.tsx'),'utf8');
console.log(`repository=${repo}`);
console.log(`WorkspaceTopBarClient.tsx.sha256=${createHash('sha256').update(source).digest('hex')}`);
function evaluate(start,end,context,result){
    const startIndex=source.indexOf(start);
    const endIndex=source.indexOf(end,startIndex);
    assert.ok(startIndex>=0 && endIndex>startIndex,`Source markers must match: ${start}`);
    const code=source.slice(startIndex,endIndex);
    return new Function(...Object.keys(context),stripTypeScriptTypes(code)+`; return ${result};`)(...Object.values(context));
}

// Exact original probe 1: a rejected real frame navigator is followed by the
// shell's actual Retry callback. The latter must not be interpreted as a safe
// retry: it never asks the frame to re-check its failed persistence.
let flushes=0,hardNavigations=[];
const navigator=createWorkspaceFrameNavigator({currentUrl:()=>'/fixture/sops/one',flush:async()=>{flushes++;return false},push:()=>assert.fail('unsafe push'),replace:()=>assert.fail('unsafe replace')});
await assert.rejects(navigator.navigate('/fixture/assets'),/not safely saved/);
const retry=evaluate('function retryActiveNavigation()','function viewCreatedRecord()',{
    activeNavigation:{requestedUrl:'/fixture/assets'},activeTabId:'tab',beginTabNavigation(){},updateTabForShellNavigation(){},pendingNavigationRef:{current:new Map()},nativeRefs:{current:new Map()},postToTab(){},ensureTabFrameLocation:(...args)=>hardNavigations.push(args)
},'retryActiveNavigation');
retry();assert.equal(flushes,1);assert.deepEqual(hardNavigations,[['tab','/fixture/assets','replace',true]]);
console.log('CONFIRMED: failed draft flush followed by shell Retry force-replaces the frame, without another flush.');

// Exact original probe 2: evaluate the production native-leave and host
// navigation callbacks. This proves ordering/absence of a frame acknowledgement;
// it does not simulate React unmount timing or claim authenticated browser proof.
let flushResolved=false,selectedRenderer='frame';
const prepare=evaluate('const prepareNativeLeave = useCallback','const defaultWorkspaceUrl',{
    useCallback:fn=>fn,nativeNavigationSequence:{current:0},nativeRefs:{current:new Map()},activeTabIdRef:{current:'tab'},flushWorkspaceAutosaves:async()=>{assert.fail('native flush must not be reached from iframe')},setBackgroundMutationState(){},setBackgroundMutationError(){}
},'prepareNativeLeave');
const navigate=evaluate('async function navigateActiveTab(href: string)','function isStandaloneBuilderHref',{
    startNativeNavigation:()=>null,nativeNavigationPerformance:{finish(){}},prepareNativeLeave:prepare,setMobileContextKey(){},activeTabIdRef:{current:'tab'},normalizeWorkspaceUrl:x=>x,tabsRef:{current:[{id:'tab',url:'/fixture/sops'}]},loadedTabIdsRef:{current:new Set(['tab'])},pendingNavigationRef:{current:new Map()},beginTabNavigation(){},updateTabForShellNavigation:(_id,url)=>{selectedRenderer=nativeWorkspaceRoute(url,'fixture')?'native':'frame'},routeCanShowRelationshipContext:()=>false,setTabContextStatus(){},setTabContextOpen(){},requestTabFrameNavigation(){assert.equal(flushResolved,false)}
},'navigateActiveTab');
await navigate('/fixture/assets');assert.equal(selectedRenderer,'native');assert.equal(flushResolved,false);
console.log('CONFIRMED CONTROL FLOW: iframe-to-native tab URL/renderer selection proceeds before any iframe draft acknowledgement.');

// Exact original probe 3: optional shell-state persistence can throw through
// initialization/navigation; durable draft persistence is deliberately separate.
const save=evaluate('const saveTabsState = useCallback','useEffect(() => {\n        if (!nativePanelsEnabled) return',{
    useCallback:fn=>fn,sessionStorage:{setItem(){throw new DOMException('Quota exhausted','QuotaExceededError')}},tabsStorageKey:'fixture',workspace:{slug:'fixture'},nativePanelsEnabled:false,window:{},workspaceLaunchUrlForRestore(){},persistWorkspaceLaunchHint(){}
},'saveTabsState');
assert.throws(()=>save([{id:'tab',url:'/fixture/assets'}],'tab'),{name:'QuotaExceededError'});
console.log('CONFIRMED: tab persistence propagates storage exceptions; bootstrap calls it before setTabsHydrated and navigation calls it before later acknowledgements.');
