import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { createUnreadSummaryResource } from '../lib/communications/unread-summary.ts'
import { createWorkspacePerformanceMeasurement } from '../lib/workspace-performance-contract.ts'

function load(path, deps, globals = {}) {
    const compiled = { exports: {} }
    const js = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(js, { module: compiled, exports: compiled.exports, require: name => { assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name] }, Response, performance, ...globals })
    return compiled.exports
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no }); return { promise, resolve, reject } }

test('unread starts immediately, coalesces a burst, and rejects a pre-event response', async () => {
    const requests = [], received = []
    const resource = createUnreadSummaryResource(() => { const request=deferred();requests.push(request);return request.promise }, rows => received.push(rows), () => assert.fail('unexpected failure'))
    resource.invalidate(); const first = resource.refresh()
    assert.equal(requests.length,1,'no timer before first fetch')
    for(let n=0;n<50;n++){resource.invalidate();assert.equal(resource.refresh(),first)}
    requests[0].resolve([{count:99}]);await new Promise(resolve=>setImmediate(resolve))
    assert.equal(requests.length,2);assert.equal(received.length,0)
    requests[1].resolve([{count:1}]);await first
    assert.deepEqual(received,[[{count:1}]]);assert.equal(requests.length,2)
})
test('an event during a failed unread request retains a refresh; disposed responses stay silent', async () => {
    const requests=[],received=[],failures=[]
    const resource=createUnreadSummaryResource(()=>{const d=deferred();requests.push(d);return d.promise},rows=>received.push(rows),()=>failures.push(true))
    const first=resource.refresh();resource.invalidate();resource.refresh();requests[0].reject(Error('offline'))
    await new Promise(resolve=>setImmediate(resolve));assert.equal(requests.length,2)
    resource.dispose();requests[1].resolve([]);await first;await resource.refresh()
    assert.deepEqual(received,[]);assert.deepEqual(failures,[]);assert.equal(requests.length,2)
})
test('chat guard preserves workspace authentication failures and the panel gate without service reads', async () => {
    let fail=false,allowed=true,calls=0,marks=0
    const expected={workspace:{id:'fixture'},user:{id:'fixture'},role:'staff'}
    const {requireCommunicationsWorkspace}=load('lib/communications/workspace-access.ts',{
        'server-only':{},'next/navigation':{notFound:()=>{throw Error('denied')}},
        '@/lib/workspaces':{requireWorkspace:async()=>{calls++;if(fail)throw Error('MFA or membership denied');return expected}},
        '@/lib/workspace-panels':{workspacePanelByKey:key=>{assert.equal(key,'communications');return {}},canAccessWorkspacePanel:(_panel,role,capabilities)=>{assert.equal(role,'staff');assert.equal(capabilities.length,0);return allowed}},
        './performance-server':{markChatBoundary:()=>marks++},
    })
    assert.equal(await requireCommunicationsWorkspace('fixture'),expected);assert.equal(calls,1);assert.equal(marks,1)
    fail=true;await assert.rejects(requireCommunicationsWorkspace('fixture'),/MFA or membership/)
    fail=false;allowed=false;await assert.rejects(requireCommunicationsWorkspace('fixture'),/denied/);assert.equal(marks,1)
})
test('server stages stay isolated across requests and publish only content-free measurements', async () => {
    const callbacks=[],logs=[]
    const timing=load('lib/communications/performance-server.ts',{
        'server-only':{},'node:async_hooks':{AsyncLocalStorage},'node:crypto':{randomUUID},'next/server':{after:fn=>callbacks.push(fn)},
        '@/lib/workspace-performance-contract':{createWorkspacePerformanceMeasurement},
    },{console:{info:(_label,sample)=>logs.push(sample)}})
    const gate=deferred()
    const first=timing.withChatPerformance('message.send',async()=>{timing.markChatBoundary('message_saved');await gate.promise;return Response.json({private:'business body'})})
    const second=timing.withChatPerformance('message.unread',async()=>{timing.markChatBoundary('access_ready');return Response.json({conversations:[]})})
    const a=first();const b=await second();gate.resolve();const response=await a
    assert.match(response.headers.get('Server-Timing'),/message_saved/);assert.doesNotMatch(response.headers.get('Server-Timing'),/access_ready/)
    assert.match(b.headers.get('Server-Timing'),/access_ready/);assert.doesNotMatch(b.headers.get('Server-Timing'),/message_saved/)
    assert.equal(logs.length,0,'logging is deferred past the response');callbacks.forEach(fn=>fn())
    assert.equal(logs.length,2);assert.ok(logs.every(x=>x.schemaVersion===1));assert.ok(!JSON.stringify(logs).includes('business body'))
    assert.notEqual(logs[0].sampleId,logs[1].sampleId)
})
