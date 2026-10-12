// Complete production Next shell/routes + actual encrypted candidate SQL.
// Synthetic Auth, REST metadata, activity/telemetry and Realtime transport only.
// Does not contact production or providers. Each run owns a fresh in-memory DB.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startFixture,sessionCookie,ids} from './fixture.mjs'
const require=createRequire(resolve(process.env.BE_BROWSER_TEST_ROOT??resolve('scripts/browser'),'package.json'))
const {chromium,webkit}=require('playwright')
const build=process.argv[2],mode=process.argv[3]??'device'
if(!build||!['device','baseline'].includes(mode))throw Error('run.mjs BUILT_CHECKOUT [device|baseline]')
const output=process.argv[4]??`/private/tmp/be-full-app-${mode}.json`
const report={mode,observedAt:new Date().toISOString(),buildId:(await readFile(resolve(build,'.next/BUILD_ID'),'utf8')).trim(),limits:'Complete local production Next app and actual encrypted SQL. Synthetic identity/Auth, surrounding REST metadata, Realtime and activity transport. PGlite serial connection, loopback network. No production deployment, provider delivery, physical device or sustained-session claim.',checks:[],samples:[],errors:[]}
const f=await startFixture({chats:Number(process.env.BE_FULL_APP_CHATS??48),backlog:100}),origin='http://127.0.0.1:45678'
const server=spawn(process.execPath,['scripts/full-app-device-unread/app-server.mjs',resolve(build)],{env:{PATH:process.env.PATH,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:45679',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-only',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',NEXT_PUBLIC_SITE_URL:origin,WORKSPACE_NATIVE_PANELS:'all',WORKSPACE_COMMUNICATIONS_BOUNDED_READS:'all',WORKSPACE_COMMUNICATIONS_DEVICE_UNREAD:mode==='device'?'all':''},stdio:['ignore','pipe','pipe']})
let serverLog='';server.stdout.on('data',d=>serverLog=(serverLog+d).slice(-50000));server.stderr.on('data',d=>serverLog=(serverLog+d).slice(-50000))
const save=async()=>{await writeFile(output,JSON.stringify(report,null,2));await writeFile(output+'.server.log',serverLog)}
async function ready(){for(let i=0;i<100;i++){if(serverLog.includes('Full app fixture:'))return;await new Promise(r=>setTimeout(r,100));if(server.exitCode!==null)throw Error(serverLog)}throw Error('App startup timed out')}
async function reset(){await f.idle();await f.sql.db.exec(`update communication_read_cursors c set last_read_message_id=b.last_read_message_id,last_read_at=b.last_read_at from communication_read_cutover_baselines b where b.kind='client' and b.conversation_id=c.relationship_id;update workspace_native_read_cursors c set last_read_message_id=b.last_read_message_id,last_read_at=b.last_read_at from communication_read_cutover_baselines b where b.kind='native' and b.conversation_id=c.conversation_id;delete from communication_device_read_cursors;delete from communication_device_read_scopes;`);f.calls.length=0;f.unexpected.length=0;f.realtimeEvents.length=0;Object.assign(f.control,{readDelayMs:0,previewDelayMs:0,previewGate:null,readGate:null,failRead:false})}
async function contextFor(browser,viewport,device=ids.deviceA){const context=await browser.newContext({...viewport,serviceWorkers:'block'});context.setDefaultTimeout(20000);await context.addCookies([{name:'betelgeze-auth',value:sessionCookie(device===ids.deviceB?ids.sessionB:ids.sessionA).value,url:origin},{name:'betelgeze_push_device',value:device,url:origin,httpOnly:true}]);await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();report.errors.push({type:'external-request',origin:u.origin});return route.abort()});return context}
async function surface(page){for(let i=0;i<150;i++){for(const frame of page.frames()){if(await frame.locator('[data-conversation-list]').count())return frame}await new Promise(r=>setTimeout(r,40))}throw Error('Conversation list never mounted: '+await page.locator('body').innerText())}
async function painted(frame,selector){await frame.locator(selector).first().waitFor({state:'visible',timeout:30000});await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
async function paintedMessage(frame,id){
 const row=frame.locator(`[data-message-interaction="${id}"]`).first();await waitFor(()=>row.isVisible(),'Latest message row never became visible')
 await waitFor(()=>row.evaluate(node=>{const r=node.getBoundingClientRect();let top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right);for(let p=node.parentElement;p;p=p.parentElement){const style=getComputedStyle(p),box=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom)}if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,box.left);right=Math.min(right,box.right)}}return bottom>top&&right>left}),'Latest message never entered its visible scroll pane')
 await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
}
async function cursorCount(device,cid){return Number((await f.sql.db.query('select count(*)::int n from communication_device_read_cursors where device_id=$1 and conversation_id=$2 and last_read_at > $3',[device,cid,'2026-10-01 00:00:00.123456+00'])).rows[0].n)}
async function waitFor(fn,message,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,40))}throw Error(message)}
async function check(name,body,scope){await body();report.checks.push({...scope,name,passed:true});console.log(`${scope.engine}/${scope.viewport}/${scope.kind}: ${name}`)}
// A deterministic held response proves history has its own lane; no elapsed-time
// threshold is used. These fault-injection checks are excluded from timing samples.
async function loadingProbe(browser,viewport,scope){
 await reset();let release,releaseRead;f.control.previewGate=new Promise(resolve=>{release=resolve});f.control.readGate=new Promise(resolve=>{releaseRead=resolve})
 const context=await contextFor(browser,viewport),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 try{
  await page.goto(`${origin}/fixture/communications?mode=${scope.kind==='native'?'team':'clients'}`,{waitUntil:'domcontentloaded'});await page.bringToFront();const frame=await surface(page)
  const list=frame.locator(`section[aria-label="${scope.kind==='native'?'Team':'Client'} communications"] [data-conversation-list]`),row=list.locator('button.grid').filter({hasText:scope.kind==='native'?'Team ':'Client '}).first();await row.waitFor()
  await waitFor(()=>f.calls.some(c=>c.path.endsWith('/communication_device_preview_batch')),'Preview did not enter held lane')
  await check('Missing preview displays Loading messages and a spinner',async()=>{assert.ok((await row.innerText()).includes('Loading messages'));assert.equal(await row.locator('[role=status] .animate-spin').count(),1)},scope)
  if(process.env.BE_FULL_APP_SCREENSHOTS==='1')await page.screenshot({path:output.replace('.json',`-loading-${scope.engine}-${scope.viewport}-${scope.kind}.png`)})
  const title=(await row.innerText()).split('\n').find(t=>t.startsWith(scope.kind==='native'?'Team ':'Client ')),conversation=f.conversations.find(c=>c.name===title),latest=f.sql.conversations.find(c=>c.id===conversation.id).latestMessageId
  await row.click();await paintedMessage(frame,latest)
  await check('Selected history paints while preview response remains held',async()=>{assert.ok(f.calls.some(c=>c.path.endsWith('/communication_device_preview_batch')&&!c.completedAt));assert.ok(f.calls.filter(c=>c.path.endsWith('/communication_device_preview_batch')).every(c=>c.body.p_ids.length<=20))},scope)
  await waitFor(()=>f.calls.some(c=>c.path.endsWith('/advance_communication_device_read')),'Read never entered held response');await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  await check('Rendered badge stays unread while server read is held',async()=>{assert.equal(await cursorCount(ids.deviceA,conversation.id),0);assert.equal(await row.locator('[aria-label="99+ unread messages"]').count(),1)},scope)
  releaseRead();f.control.readGate=null;await waitFor(()=>cursorCount(ids.deviceA,conversation.id),'Read blocked behind preview lane');await waitFor(async()=>await row.locator('[aria-label$="unread messages"], [aria-label="Unread count loading"]').count()===0,'Badge failed to clear after released read')
  await check('Server-confirmed read completes independently of previews',async()=>assert.equal(await cursorCount(ids.deviceA,conversation.id),1),scope)
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(f.unexpected.length,0,f.unexpected.join('\n'))
 }catch(error){report.errors.push({...scope,phase:'held-preview-and-read',error:String(error),pageErrors:errors,unexpected:[...f.unexpected]});throw error}finally{release();releaseRead();f.control.previewGate=null;f.control.readGate=null;await context.close();await f.idle();await save()}
}
try{await ready();for(const engine of(process.env.BE_FULL_APP_ENGINES??'chromium,webkit').split(',')){const browser=await({chromium,webkit})[engine].launch();try{for(const [viewportName,viewport]of Object.entries({desktop:{viewport:{width:1280,height:900}},mobile:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}).filter(([name])=>(process.env.BE_FULL_APP_VIEWPORTS??'desktop,mobile').split(',').includes(name))){for(const kind of(process.env.BE_FULL_APP_KINDS??'native,client').split(',')){for(let trial=0;trial<Number(process.env.BE_FULL_APP_SAMPLES??3);trial++){
 await reset();const scope={engine,viewport:viewportName,kind,trial},context=await contextFor(browser,viewport),page=await context.newPage(),pageErrors=[],http=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/'))http.push({url:new URL(r.url()).pathname,method:r.request().method(),status:r.status()})});let frame
 try{
 const start=performance.now();await page.goto(`${origin}/fixture/communications?mode=${kind==='native'?'team':'clients'}`,{waitUntil:'domcontentloaded'});await page.bringToFront();frame=await surface(page)
 const list=frame.locator(`section[aria-label="${kind==='native'?'Team':'Client'} communications"] [data-conversation-list]`),row=list.locator('button.grid').filter({hasText:kind==='native'?'Team ':'Client '}).first();await waitFor(()=>row.isVisible(),'Conversation row never became visible');const metadataMs=performance.now()-start
 const countsReady=waitFor(async()=>await row.locator('[aria-label="99+ unread messages"]').count()===1,'Initial unread count never became visible').then(()=>({countMs:performance.now()-start}),error=>({error}))
 await waitFor(async()=>!(await row.innerText()).includes('Loading messages')&&(await row.innerText()).includes('Encrypted latest preview'),'Visible preview never loaded');await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const previewMs=performance.now()-start
 await waitFor(async()=>await list.locator('span[class~="h-2.5"][title]').count()===0,'Messages never reached live after Realtime join and reconciliation');const liveMs=performance.now()-start
 const countsOutcome=await countsReady;if(countsOutcome.error)throw countsOutcome.error;const countMs=countsOutcome.countMs
 const title=(await row.innerText()).split('\n').find(t=>t.startsWith(kind==='native'?'Team ':'Client ')),conversation=f.conversations.find(c=>c.name===title);assert(conversation,'Unknown selected title '+title)
 if(mode==='device')assert.equal(await cursorCount(ids.deviceA,conversation.id),0,'Preview alone marked a read')
 const latest=f.sql.conversations.find(c=>c.id===conversation.id).latestMessageId
 const readResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/read')&&r.request().postDataJSON()?.messageId===latest&&r.ok()).then(async response=>{try{await response.finished();return {response,completedAt:performance.now()}}catch(error){return {error}}},error=>({error}))
 const selectAt=performance.now();await row.click();await paintedMessage(frame,latest);const selectedMs=performance.now()-selectAt
 const readOutcome=await readResponse;if(readOutcome.error)throw readOutcome.error;const httpAckMs=readOutcome.completedAt-selectAt
 await waitFor(async()=>{const table=kind==='native'?'workspace_native_read_cursors':'communication_read_cursors',column=kind==='native'?'conversation_id':'relationship_id';return (await f.sql.db.query(`select last_read_message_id id from ${table} where ${column}=$1`,[conversation.id])).rows[0]?.id===latest},'Actual server-confirmed read never advanced')
 if(mode==='device')assert.equal(await cursorCount(ids.deviceA,conversation.id),1)
 await waitFor(async()=>await row.locator('[aria-label$="unread messages"], [aria-label="Unread count loading"]').count()===0,'Rendered unread badge never cleared after ACK');await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const ackMs=performance.now()-selectAt
 const resourceEntries=(await Promise.all(page.frames().map(frame=>frame.evaluate(()=>performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,encodedBodySize:r.encodedBodySize,transferSize:r.transferSize,duration:r.duration})))))).flat()
 report.samples.push({...scope,metadataMs,countMs,previewMs,liveMs,selectedMs,httpAckMs,ackMs,realtimeJoins:f.realtimeEvents.filter(e=>e.event==='phx_join').length,resourceBoundary:'Completed browser resource entries through confirmed badge paint; excludes later background work',apiRequests:http.length,apiStatuses:http.slice(),encodedBytes:resourceEntries.reduce((n,r)=>n+r.encodedBodySize,0),resourceEntries,backendRequests:f.calls.length})
 {
 if(trial===0)await check('Actual shell, live Realtime, selected history and server read acknowledgement',async()=>{assert.ok(f.realtimeEvents.some(e=>e.event==='phx_join'),'No Realtime subscription joined');assert.equal(pageErrors.length,0,pageErrors.join('\n'));assert.equal(f.unexpected.length,0,f.unexpected.join('\n'))},scope)
 if(mode==='device'&&trial===0&&process.env.BE_FULL_APP_FAULT_PROBES!=='0')await check('Another installation retains its unread count after account read',async()=>{const remote=await contextFor(browser,viewport,ids.deviceB);try{const response=await remote.request.get(`${origin}/api/workspaces/fixture/communications/unread?readProtocol=device-v1`);assert.equal(response.status(),200,await response.text());const value=await response.json();assert.equal(value.conversations.find(c=>c.conversationId===conversation.id)?.count,100)}finally{await remote.close()}},scope)
 if(viewportName==='mobile'){await frame.locator('[data-mobile-conversation-back]').click();await frame.waitForFunction(()=>document.documentElement.dataset.mobileConversationOpen!=='true');await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))}
 const previewed=new Set(f.calls.filter(c=>c.path.endsWith('/communication_device_preview_batch')).flatMap(c=>c.body.p_ids))
 const target=f.conversations.find(c=>c.kind===kind&&!previewed.has(c.id)&&c.id!==conversation.id);assert.ok(target,'No uncached search target')
 const search=list.locator('input[type=search]'),bodyQuery=`Encrypted latest preview for Conversation ${target.name.split(' ').at(-1)}`
 const searchFinished=mode==='device'?page.waitForResponse(async r=>{const u=new URL(r.url());return u.pathname.endsWith('/communications/search')&&u.searchParams.get('search')===bodyQuery.toLowerCase()&&r.ok()&&(await r.json()).nextCursor===null},{timeout:30000}).then(response=>({response}),error=>({error})):null
 const searchAt=performance.now();await search.fill(bodyQuery);assert.equal(await search.inputValue(),bodyQuery,'Search input did not accept typing after Back')
 if(mode==='device')await waitFor(()=>list.getByText('Searching messages…',{exact:true}).isVisible(),'Search pending state never became visible')
 if(searchFinished){const outcome=await searchFinished;if(outcome.error)throw outcome.error}
 await waitFor(async()=>{const text=await list.innerText();return !text.includes('Searching messages')&&!text.includes('Could not search messages')&&await list.getByText(target.name,{exact:true}).count()>0},'Latest-body search did not find uncached chat');await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));report.samples.at(-1).searchMs=performance.now()-searchAt
 await check('On-demand latest body search finds an uncached chat after final page',async()=>assert.equal(await list.getByText(target.name,{exact:true}).count(),1),scope);await search.fill('');
 if(mode==='device'&&trial===0&&process.env.BE_FULL_APP_FAULT_PROBES!=='0'){
  const nextRow=list.locator('button.grid').filter({hasText:kind==='native'?'Team ':'Client '}).filter({hasNotText:title}).first();const nextTitle=(await nextRow.innerText()).split('\n').find(t=>t.startsWith(kind==='native'?'Team ':'Client ')),nextConversation=f.conversations.find(c=>c.name===nextTitle)
  const rejectedResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/read')&&!r.ok()).then(response=>({response}),error=>({error}));Object.assign(f.control,{failRead:true});await nextRow.click();await painted(frame,'[data-message-interaction]');await waitFor(()=>f.calls.some(c=>c.path.endsWith('/advance_communication_device_read')&&c.body.p_conversation_id===nextConversation.id),'Failed-read case did not submit')
  const rejectedOutcome=await rejectedResponse;if(rejectedOutcome.error)throw rejectedOutcome.error;await rejectedOutcome.response.finished();await check('Rejected save preserves private cursor and rendered unread badge',async()=>{assert.equal(await cursorCount(ids.deviceA,nextConversation.id),0);assert.equal(await nextRow.locator('[aria-label="99+ unread messages"]').count(),1)},scope)
  Object.assign(f.control,{failRead:false});await frame.evaluate(()=>window.dispatchEvent(new Event('online')));await waitFor(()=>cursorCount(ids.deviceA,nextConversation.id),'Queued read did not recover online')
  await check('Pending read recovers through the same queue after reconnect',async()=>assert.equal(await cursorCount(ids.deviceA,nextConversation.id),1),scope)
 }
 }
 assert.equal(pageErrors.length,0,pageErrors.join('\n'));assert.equal(f.unexpected.length,0,f.unexpected.join('\n'))
 }catch(error){report.errors.push({...scope,error:String(error),pageErrors,unexpected:[...f.unexpected],body:frame?await frame.locator('body').innerText().catch(()=>null):null});await save();console.error(error);await page.screenshot({path:output.replace('.json',`-${engine}-${viewportName}-${kind}.png`)}).catch(()=>{});throw error}finally{await context.close();await f.idle();await save()}
 if(mode==='device'&&trial===0&&process.env.BE_FULL_APP_FAULT_PROBES!=='0')await loadingProbe(browser,viewport,scope)
 }}}}finally{await browser.close()}}
 assert.equal(report.errors.length,0,'Validation captured external requests or errors')
}finally{server.kill('SIGTERM');await f.close();await save()}
console.log(JSON.stringify({output,checks:report.checks.length,samples:report.samples.length,errors:report.errors.length}))
