// Separate cookie jars model installations; sibling pages share only their installation.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {chromium,webkit} from 'playwright'
const engines=process.argv.slice(2)
if(engines.some(engine=>!['chromium','webkit'].includes(engine)))throw Error('Usage: run-device-unread.mjs [chromium|webkit]')
const reports=[],pageErrors=[],server=spawn(process.execPath,['scripts/serve-device-unread-fixture.mjs'],{stdio:['ignore','pipe','pipe']})
let logs=''
const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Device fixture startup timed out: '+logs.slice(-3000))),90000);server.stdout.on('data',data=>{logs+=data;const match=logs.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0])}});server.stderr.on('data',data=>{logs+=data});server.once('error',error=>{clearTimeout(timer);reject(error)});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Device fixture exited ${code}: ${logs.slice(-4000)}`))})})
const read=page=>page.evaluate(()=>window.deviceUnread.state)
const wait=ms=>new Promise(done=>setTimeout(done,ms))
const until=(page,predicate)=>page.waitForFunction(predicate,null,{timeout:7000})
const badge=(page,count)=>page.waitForFunction(n=>window.deviceUnread?.state.loaded&&window.deviceUnread.state.shell===n&&window.deviceUnread.state.row===n,count,{timeout:7000})
async function control(run,action,values={}){const response=await fetch(url+'fixture/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run,action,...values})});assert.equal(response.status,200);return response.json()}
async function untilServer(run,predicate,label){for(let i=0;i<150;i++){const state=await control(run,'state');if(predicate(state))return state;await wait(30)}throw Error('Timed out: '+label)}
async function scoped(browser,viewport,kind,name,callback){
 const run=`device-${kind}-${randomUUID()}`,contexts=await Promise.all([browser.newContext({viewport}),browser.newContext({viewport})])
 try{
  for(const context of contexts)await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort())
  const pages=[]
  const load=async(index=0,ready=true,query='')=>{const page=await contexts[index].newPage();pages.push(page);page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(`${url}?run=${run}&kind=${kind}${query}`);if(ready)await badge(page,3);else await until(page,()=>Boolean(window.deviceUnread));return page}
  const result=await callback({run,contexts,load})
  reports.push({engine:browser.browserType().name(),viewport,kind,case:name,passed:true,...result})
 }catch(error){console.error(JSON.stringify({case:name,run,server:await control(run,'state')}));for(const context of contexts)for(const page of context.pages())console.error(await read(page).catch(()=>null));throw error}finally{await Promise.all(contexts.map(context=>context.close()))}
}
try{
 for(const engine of engines.length?engines:['chromium','webkit']){
  const browser=await({chromium,webkit})[engine].launch({headless:true})
  try{
   for(const viewport of [{width:390,height:844},{width:1280,height:900}])for(const kind of ['client','native']){
    await scoped(browser,viewport,kind,'HTTP acknowledged read clears A and sibling; B independently reads and reloads',async({run,load})=>{
     const a=await load(),b=await load(1),sibling=await load()
     const deviceA=(await read(a)).deviceId,deviceB=(await read(b)).deviceId
     assert.equal((await read(sibling)).deviceId,deviceA);assert.notEqual(deviceA,deviceB)
     await a.bringToFront();await a.waitForTimeout(150)
     const before=await control(run,'mode',{mode:'hold'})
     await a.evaluate(()=>window.deviceUnread.set({active:true}))
     await untilServer(run,state=>state.pending===1,'held real POST')
     assert.equal((await read(a)).row,3);assert.equal((await read(sibling)).row,3);assert.equal((await read(b)).row,3)
     await control(run,'mode',{mode:'healthy'});await control(run,'release')
     await badge(a,0);await badge(sibling,0);assert.equal((await read(b)).row,3)
     await a.waitForTimeout(180)
     const after=await control(run,'state')
     assert.equal(after.reads.length,1,'One visible read creates exactly one POST')
     assert.equal(after.reads[0].bodyDeviceId,deviceA)
     assert.equal(after.summaries.filter(row=>row.deviceId===deviceA).length-before.summaries.filter(row=>row.deviceId===deviceA).length,2,'One reconciliation for each same-installation owner')
     assert.ok(after.summaries.slice(before.summaries.length).every(row=>!row.cursorsIncluded),'Routine read reconciliation must omit historical cursor metadata')
     assert.ok((await read(a)).deviceCursor,'Counts-only reconciliation retains acknowledged position')
     const ackToBadgeMs=(await read(a)).timings.at(-1)
     assert.ok(Number.isFinite(ackToBadgeMs)&&ackToBadgeMs<2000,'Confirmed ACK commits badge without a long recovery delay')
     await a.reload();await badge(a,0)
     await b.reload();await badge(b,3)
     assert.equal((await read(b)).globalCursor?.lastReadMessageId?.slice(-12),'000000000003','Other installation receives advanced account receipt')
     await b.bringToFront();await b.evaluate(()=>window.deviceUnread.set({active:true}));await badge(b,0)
     const complete=await untilServer(run,state=>state.reads.length===2&&state.reads.every(row=>row.status==='saved'),'independent installation write')
     assert.equal(complete.reads[1].bodyDeviceId,deviceB,'Global receipt never skips this installation read')
     await b.reload();await badge(b,0);await badge(a,0)
     return{ackToBadgeMs,readPosts:2,sameInstallationSummaryRequests:2,routineFullCursorRequests:0,independentCookieJars:true}
    })
    await scoped(browser,viewport,kind,'account receipts and other-device broadcasts never clear local badges',async({run,load})=>{
     const page=await load();await page.bringToFront();await page.waitForTimeout(100)
     const before=await control(run,'state')
     await page.evaluate(()=>{window.deviceUnread.accountRead();window.deviceUnread.deviceRead('different-installation');window.deviceUnread.invalidateOther()})
     await page.waitForTimeout(200);await badge(page,3)
     const after=await control(run,'state');assert.equal(after.reads.length,0);assert.equal(after.summaries.length,before.summaries.length,'Unrelated receipt/device events do not fetch summaries')
     return{readPosts:0,summaryRequests:0}
    })
    await scoped(browser,viewport,kind,'failed acknowledgement preserves count and online recovery saves once',async({run,load})=>{
     const page=await load();await page.bringToFront();await control(run,'mode',{mode:'fail'});await page.evaluate(()=>window.deviceUnread.set({active:true}))
     await until(page,()=>Boolean(window.deviceUnread.state.error));await badge(page,3)
     assert.equal((await control(run,'state')).reads.length,1)
     await control(run,'mode',{mode:'healthy'});await page.evaluate(()=>window.dispatchEvent(new Event('online')));await badge(page,0)
     assert.equal((await control(run,'state')).reads.length,2)
     return{failedReadPosts:1,recoveryReadPosts:1}
    })
    await scoped(browser,viewport,kind,'legacy account read intent never replays into a new device queue',async({run,load,contexts})=>{
     await contexts[0].addInitScript(({run,kind})=>{if(location.protocol==='http:')sessionStorage.setItem(`betelgeze:chat-reads:v1:${run}:fixture-user:${kind}:fixture-tab`,JSON.stringify([{workspaceId:run,userId:'fixture-user',kind,conversationId:'chat',lastReadAt:'2026-10-09T10:00:00.000003Z',lastReadMessageId:'00000000-0000-4000-8000-000000000003'}]))},{run,kind})
     const page=await load();await page.bringToFront();await page.evaluate(()=>{window.deviceUnread.set({active:true,covered:true});window.dispatchEvent(new Event('online'))});await page.waitForTimeout(220);await badge(page,3)
     assert.equal((await control(run,'state')).reads.length,0,'Legacy account intent must not become device evidence')
     await page.evaluate(()=>window.deviceUnread.set({covered:false}));await badge(page,0);assert.equal((await control(run,'state')).reads.length,1)
     return{legacyIntentReadPosts:0,visibleDeviceReadPosts:1}
    })
    await scoped(browser,viewport,kind,'offline intent survives reload only for the same installation',async({run,load,contexts})=>{
     const page=await load();await page.bringToFront();await contexts[0].setOffline(true);await page.evaluate(()=>window.deviceUnread.set({active:true}));await until(page,()=>Boolean(window.deviceUnread.state.error));await badge(page,3)
     assert.equal((await control(run,'state')).reads.length,0,'Offline read cannot reach the server')
     const returnUrl=page.url();await page.goto('about:blank');await contexts[0].setOffline(false);await page.goto(returnUrl);await badge(page,0)
     assert.equal((await control(run,'state')).reads.length,1,'Durable same-device intent replays once')
     return{offlineServerPosts:0,reloadRecoveryPosts:1}
    })
    await scoped(browser,viewport,kind,'sibling acknowledgement during unknown-device bootstrap waits for verified summary',async({run,load})=>{
     const page=await load();await control(run,'summaryMode',{mode:'hold'});const sibling=await load(0,false)
     await untilServer(run,state=>state.pendingSummaries===1,'sibling first summary held')
     await page.bringToFront();await page.evaluate(()=>window.deviceUnread.set({active:true}));await badge(page,0)
     assert.equal((await read(sibling)).loaded,false,'Unknown installation must not import a received cursor')
     assert.equal((await read(sibling)).deviceId,null)
     await control(run,'summaryMode',{mode:'healthy'});await control(run,'releaseSummaries');await badge(sibling,0)
     const state=await control(run,'state');assert.equal(state.reads.length,1);assert.ok(state.summaries.length<=5,'Bootstrap race has bounded summary follow-up')
     return{readPosts:1,summaryRequests:state.summaries.length,verifiedDeviceBeforeImport:true}
    })
    await scoped(browser,viewport,kind,'hidden covered history and inactive views never produce read writes',async({run,load})=>{
     const page=await load();await page.bringToFront()
     for(const blocked of [{active:false},{active:true,hidden:true},{active:true,hidden:false,covered:true},{active:true,covered:false,atLatest:false}]){
      await page.evaluate(state=>window.deviceUnread.set(state),blocked);await page.waitForTimeout(220);await badge(page,3);assert.equal((await control(run,'state')).reads.length,0,'Unseen latest message must remain unread')
     }
     await page.evaluate(()=>window.deviceUnread.set({atLatest:true}));await badge(page,0)
     assert.equal((await control(run,'state')).reads.length,1)
     return{blockedStates:4,readPosts:1}
    })
    await scoped(browser,viewport,kind,'actual device presence recovers a failed first binding on online without focus',async({run,load})=>{
     await control(run,'binding',{required:true,mode:'fail'});const page=await load(0,false,'&presence=1');await page.bringToFront();await until(page,()=>window.deviceUnread.state.stale)
     await page.evaluate(()=>window.deviceUnread.set({active:true}));await page.waitForTimeout(250)
     const failed=await control(run,'state');assert.ok(failed.observations.length>=1&&failed.observations.length<=2,'Initial observation plus at most one coalesced binding recovery');assert.equal(failed.reads.length,0);assert.equal((await read(page)).loaded,false)
     await page.waitForTimeout(150);assert.equal((await control(run,'state')).observations.length,failed.observations.length,'Persistent binding failure cannot poll or loop')
     await control(run,'binding',{mode:'healthy'});await page.evaluate(()=>window.dispatchEvent(new Event('online')));await badge(page,0)
     const recovered=await control(run,'state');assert.equal(recovered.observations.length-failed.observations.length,1,'Online uses exactly one serialized observation');assert.equal(recovered.reads.length,1)
     assert.equal(recovered.observations.at(-1).deviceId,(await read(page)).deviceId)
     return{initialFailedObservations:failed.observations.length,onlineRecoveryObservations:1,readPosts:1,focusRequired:false}
    })
    await scoped(browser,viewport,kind,'actual presence realigns a P0002 cookie binding in the same visible window',async({run,load})=>{
     await control(run,'binding',{required:true});const page=await load(0,true,'&presence=1');await page.bringToFront();await page.locator('#composer').fill('Preserve binding-recovery draft');await page.waitForTimeout(200)
     const oldDevice=(await read(page)).deviceId,before=await control(run,'state')
     await page.evaluate(async run=>{await fetch('/fixture/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run,action:'rotateDevice'})});window.deviceUnread.invalidate()},run)
     await page.waitForFunction(old=>window.deviceUnread.state.loaded&&window.deviceUnread.state.deviceId&&window.deviceUnread.state.deviceId!==old,oldDevice,{timeout:7000});await badge(page,3)
     const rebound=await control(run,'state');assert.equal(rebound.observations.length-before.observations.length,1,'One explicit recovery observation repairs the mapping');assert.ok(rebound.bindingRejections.length>before.bindingRejections.length,'Actual HTTP summary must reject the stale mapping with P0002');assert.equal(rebound.reads.length,0)
     assert.equal(await page.locator('#composer').inputValue(),'Preserve binding-recovery draft')
     await page.evaluate(()=>window.deviceUnread.set({active:true}));await badge(page,0);assert.equal((await control(run,'state')).reads.length,1)
     return{bindingRecoveryObservations:1,readPosts:1,draftPreserved:true,focusRequired:false}
    })
    await scoped(browser,viewport,kind,'temporary device binding failure preserves confirmed count and suspends reads',async({run,load})=>{
     const page=await load();await page.bringToFront();await control(run,'summaryMode',{mode:'unbound'});await page.evaluate(()=>window.deviceUnread.invalidate());await until(page,()=>window.deviceUnread.state.stale&&window.deviceUnread.state.deviceId===null);await badge(page,3)
     await page.evaluate(()=>window.deviceUnread.set({active:true}));await page.waitForTimeout(180);assert.equal((await control(run,'state')).reads.length,0,'Unverified installation cannot write')
     await control(run,'summaryMode',{mode:'healthy'});await page.evaluate(()=>window.deviceUnread.observeDevice());await badge(page,0)
     assert.equal((await control(run,'state')).reads.length,1)
     return{preservedCount:3,unknownDeviceReadPosts:0,recoveryReadPosts:1}
    })
    await scoped(browser,viewport,kind,'first unverified device waits for observation without creating reads',async({run,load})=>{
     await control(run,'summaryMode',{mode:'unbound'});const page=await load(0,false);await page.bringToFront();await until(page,()=>window.deviceUnread.state.stale);assert.equal((await read(page)).loaded,false)
     await page.evaluate(()=>window.deviceUnread.set({active:true}));await page.waitForTimeout(180);assert.equal((await control(run,'state')).reads.length,0)
     await control(run,'summaryMode',{mode:'healthy'});await page.evaluate(()=>window.deviceUnread.observeDevice());await badge(page,0);assert.equal((await control(run,'state')).reads.length,1)
     return{unknownDeviceReadPosts:0,verifiedReadPosts:1}
    })
    await scoped(browser,viewport,kind,'late previous-user acknowledgement cannot change the new account',async({run,load})=>{
     const page=await load();await page.bringToFront();await control(run,'mode',{mode:'hold'});await page.evaluate(()=>window.deviceUnread.set({active:true}));await untilServer(run,state=>state.pending===1,'old account held read')
     await page.evaluate(async run=>{await fetch('/fixture/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run,action:'switchUser',userId:'next-user'})});window.deviceUnread.set({active:false,userId:'next-user'})},run)
     await until(page,()=>window.deviceUnread.state.userId==='next-user'&&window.deviceUnread.state.loaded);await badge(page,3)
     await control(run,'mode',{mode:'healthy'});await control(run,'release');await page.waitForTimeout(150);await badge(page,3)
     const state=await control(run,'state');assert.equal(state.reads.length,1);assert.equal(state.reads[0].userId,'fixture-user');assert.equal((await read(page)).deviceCursor,undefined)
     return{oldReadPosts:1,newAccountReadPosts:0}
    })
    await scoped(browser,viewport,kind,'wrong-device acknowledgement cannot clear badge and valid snapshot recovers',async({run,load})=>{
     const page=await load();await page.bringToFront();await control(run,'mode',{mode:'wrong-ack-device'});await control(run,'summaryMode',{mode:'hold'});await page.evaluate(()=>window.deviceUnread.set({active:true}));await until(page,()=>Boolean(window.deviceUnread.state.error));await badge(page,3)
     await page.evaluate(()=>window.deviceUnread.set({active:false}));await control(run,'mode',{mode:'healthy'});await control(run,'summaryMode',{mode:'healthy'});await control(run,'releaseSummaries');await page.evaluate(()=>window.deviceUnread.invalidate());await badge(page,0)
     assert.equal((await control(run,'state')).reads.length,1)
     return{rejectedAcknowledgements:1,snapshotRecovery:true}
    })
    await scoped(browser,viewport,kind,'cookie rotation rejects stale device body and rebinds the owner',async({run,load})=>{
     const page=await load();await page.bringToFront();const old=(await read(page)).deviceId;await page.waitForTimeout(100);const before=await control(run,'state')
     await page.evaluate(async run=>{await fetch('/fixture/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run,action:'rotateDevice'})});window.deviceUnread.set({active:true})},run)
     await untilServer(run,state=>state.reads.some(row=>row.status==='mismatch'),'stale device rejection')
     await badge(page,0)
     const state=await control(run,'state');assert.notEqual((await read(page)).deviceId,old);assert.equal(state.reads.filter(row=>row.status==='saved').length,1);assert.equal(state.reads.filter(row=>row.status==='mismatch').length,1)
     const summaries=state.summaries.slice(before.summaries.length);assert.equal(summaries.filter(row=>row.cursorsIncluded).length,1,'Changed identity requires exactly one full cursor follow-up');assert.equal(summaries.filter(row=>!row.cursorsIncluded).length,2,'One identity check and one read reconciliation stay counts-only')
     return{identityMismatchPosts:1,currentDeviceReadPosts:1,identityFullCursorRequests:1,countsOnlyRequests:2}
    })
    await scoped(browser,viewport,kind,'older acknowledgement cannot erase a newer arrival or draft',async({run,load})=>{
     const page=await load();await page.bringToFront();await page.locator('#composer').fill('Retain this draft')
     await control(run,'mode',{mode:'hold'});await page.evaluate(()=>window.deviceUnread.set({active:true}));await untilServer(run,state=>state.pending===1,'first read held')
     await control(run,'latest',{latest:4});await page.evaluate(()=>{window.deviceUnread.latest(4);window.deviceUnread.set({active:false});window.deviceUnread.invalidate()});await badge(page,4)
     await control(run,'mode',{mode:'healthy'});await control(run,'release');await badge(page,1)
     assert.equal(await page.locator('#composer').inputValue(),'Retain this draft')
     assert.equal((await read(page)).deviceCursor?.lastReadMessageId?.slice(-12),'000000000003','Counts-only response retains the confirmed device cursor')
     assert.equal((await control(run,'state')).reads.length,1)
     await page.evaluate(()=>window.deviceUnread.set({active:true}));await badge(page,0);assert.equal((await control(run,'state')).reads.length,2)
     return{oldReadRetainedNewerCount:1,readPosts:2,draftPreserved:true}
    })
    await scoped(browser,viewport,kind,'focus during counts-only request preserves one full-cursor follow-up',async({run,load})=>{
     const page=await load();await page.bringToFront();await page.waitForTimeout(100);const deviceId=(await read(page)).deviceId;const before=await control(run,'summaryMode',{mode:'hold'})
     await page.evaluate(()=>window.deviceUnread.invalidate());await untilServer(run,state=>state.pendingSummaries===1,'counts-only summary held')
     await control(run,'serverRead',{deviceId,kind});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(80)
     assert.equal((await control(run,'state')).summaries.length-before.summaries.length,1,'Focus coalesces behind the current HTTP owner')
     await control(run,'summaryMode',{mode:'healthy'});await control(run,'releaseSummaries');await badge(page,0)
     const state=await control(run,'state');assert.deepEqual(state.summaries.slice(before.summaries.length).map(row=>row.cursorsIncluded),[false,true],'Focus must retain the full snapshot request after counts-only completes')
     assert.equal((await read(page)).deviceCursor?.lastReadMessageId?.slice(-12),'000000000003');assert.equal(state.reads.length,0)
     return{countsOnlyRequests:1,fullCursorFollowupRequests:1,readPosts:0}
    })
    await scoped(browser,viewport,kind,'slow failing summary cannot undo a locally acknowledged device read',async({run,load})=>{
     const page=await load();await page.bringToFront();await control(run,'summaryMode',{mode:'hold'});await page.evaluate(()=>window.deviceUnread.invalidate());await untilServer(run,state=>state.pendingSummaries===1,'held old summary')
     await page.evaluate(()=>window.deviceUnread.set({active:true}));await badge(page,0)
     await control(run,'summaryMode',{mode:'fail'});await control(run,'releaseSummaries');await until(page,()=>window.deviceUnread.state.stale);await badge(page,0)
     assert.equal((await control(run,'state')).reads.length,1)
     return{readPosts:1,failedSummaryPreservesAcknowledgement:true}
    })
   }
  }finally{await browser.close()}
 }
 assert.equal(reports.length,(engines.length||2)*68,'Every kind, viewport and device scenario must execute')
 assert.deepEqual(pageErrors,[])
 console.log(JSON.stringify({passed:reports.length,ackToBadgeMs:reports.filter(row=>row.ackToBadgeMs!==undefined).map(({engine,viewport,kind,ackToBadgeMs})=>({engine,width:viewport.width,kind,ackToBadgeMs}))}))
}finally{
 server.kill('SIGTERM');await mkdir('browser-results',{recursive:true});await writeFile('browser-results/device-unread.json',JSON.stringify({observedAt:new Date().toISOString(),reports,pageErrors,limits:'Production React actual reading/summary hooks and device broadcast; real loopback HTTP and independent browser cookie jars with synthetic data. ACK timings begin after the actual response is parsed and validated and end at React layout commit, not verified screen paint. No production/authenticated UI, push-delivery or physical-device claim.'},null,2))
}
