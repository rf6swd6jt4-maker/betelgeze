// Isolated production React + HTTP + PGlite observations; not a Next/auth/device claim.
import {createHash} from 'node:crypto'
import { createRequire } from 'node:module'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
const require=createRequire('/Users/jedryszczyk/Developer/betelgeze/scripts/browser/package.json')
const {chromium,webkit}=require('playwright')
const url=process.argv[2];if(!url)throw Error('Usage: node browser-measure.mjs http://127.0.0.1:PORT/ [output.json]')
const output=process.argv[3]??'/private/tmp/device-progressive-browser-results.json'
const bundleBytes=Buffer.from(await (await fetch(new URL('/bundle.js',url))).arrayBuffer())
const selectionLane=process.env.BE_BROWSER_SELECTION_LANE??'shared'
const kind=process.env.BE_BROWSER_KIND??'native'
const accountAhead=process.env.BE_BROWSER_ACCOUNT_AHEAD==='1'
const samples=Number(process.env.BE_BROWSER_SAMPLES??10)
const engines=(process.env.BE_BROWSER_ENGINES??'chromium,webkit').split(',')
const networks=JSON.parse(process.env.BE_BROWSER_NETWORKS??'[{"name":"loopback","rttMs":0,"bytesPerSecond":0},{"name":"emulated150ms-1Mbps","rttMs":150,"bytesPerSecond":125000}]')
const report={observedAt:new Date().toISOString(),build:{bundleSha256:createHash('sha256').update(bundleBytes).digest('hex'),bundleBytes:bundleBytes.length},selectionLane,sampleCountPerCell:samples,limits:'Production React helper fixture; identical unminified bundle. HTTP loopback with PGlite; synthetic data and access identity; plaintext fixture bodies omit production encryption, Supabase, auth, deployment and physical devices. Artificial RTT and aggregate compressed-response bandwidth are server shaping, not TCP or cellular emulation. Browser baseline pipeline uses canonical Team compact SQL/Client bounded2000 projection plus selected60/500. Shell context, notification dismissal and telemetry transport are adapters.',trials:[],checks:[],errors:[]}
const assert=(value,message)=>{if(!value)throw Error(message)}
async function post(context,path,data){const response=await context.request.post(new URL(path,url).href,{data});if(!response.ok())throw Error(path+' '+response.status()+' '+await response.text());return response.json()}
async function settled(page){await page.waitForFunction(()=>{const s=window.fixture?.snapshot();return s?.marks.visible_previews_meaningful_ready&&s.marks.selected_meaningful_ready&&s.marks.confirmed_badge_zero&&!s.loading.length&&s.traffic.every(t=>t.response)},null,{timeout:30000})}
async function snapshot(page){return page.evaluate(()=>window.fixture.snapshot())}
async function switchTo(page,id){const before=await page.evaluate(()=>window.fixtureSamples.filter(s=>s.operation==='conversation_switch').length);await page.locator(`[data-chat-id="${id}"]`).click();await page.waitForFunction(({id,before})=>window.fixture.snapshot().selected===id&&window.fixtureSamples.filter(s=>s.operation==='conversation_switch').length>before,{id,before},{timeout:15000});return (await page.evaluate(()=>window.fixtureSamples.filter(s=>s.operation==='conversation_switch'))).at(-1)}
for(const engine of engines){const browser=await ({chromium,webkit})[engine].launch({headless:true});try{for(const [viewportName,viewport]of Object.entries({desktop:{width:1280,height:900},mobile:{width:390,height:844}})){for(const network of networks){for(let iteration=0;iteration<samples;iteration++){for(const mode of iteration%2?['device','baseline']:['baseline','device']){
 const context=await browser.newContext({viewport}),run=`${engine}-${viewportName}-${network.name}-${iteration}-${mode}`,page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)))
 try{
  await post(context,'/fixture/reset',{mode,run,kind,accountAhead,latencyMs:network.rttMs,bytesPerSecond:network.bytesPerSecond});await page.goto(new URL(`?mode=${mode}&run=${run}&selectionLane=${selectionLane}`,url).href);await page.bringToFront();await settled(page)
  const cold=await snapshot(page),serverCold=await (await context.request.get(new URL('/fixture/metrics',url).href)).json()
  const first=cold.selected,second=cold.roster.find(c=>c.id!==first).id
  const uncached=await switchTo(page,second);await page.waitForFunction(()=>{const s=window.fixture.snapshot();return !s.summary.rows.some(r=>r.conversationId===s.selected)&&s.traffic.every(t=>t.response)})
  const warm=[];warm.push(await switchTo(page,first));warm.push(await switchTo(page,second))
  const input=page.getByRole('textbox',{name:'Message'});await input.fill('diagnostic typing');await page.waitForFunction(()=>window.fixtureSamples.some(s=>s.operation==='field_edit'))
  const offscreenId=cold.roster.at(-1).id
  async function scrollPreview(){const started=await page.evaluate(()=>performance.now());await page.locator('.list').evaluate(node=>node.scrollTop=node.scrollHeight);await page.waitForFunction(id=>window.fixture.snapshot().previews[id]?.cursorKnown,offscreenId);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));return (await page.evaluate(()=>performance.now()))-started}
  const offscreenPreviewMs=await scrollPreview();await page.locator('.list').evaluate(node=>node.scrollTop=0);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));const warmOffscreenPreviewMs=await scrollPreview()
  await page.waitForFunction(()=>{const s=window.fixture.snapshot();return !s.loading.length&&s.traffic.every(t=>t.response)})
  const final=await snapshot(page),serverFinal=await(await context.request.get(new URL('/fixture/metrics',url).href)).json()
  assert(!pageErrors.length,'Browser errors '+pageErrors.join(';'));assert(!final.readError,'Read error '+final.readError)
  report.trials.push({engine,viewport:viewportName,network:network.name,iteration,mode,kind,accountAhead,selectionLane,initialLoadedChats:Object.keys(cold.histories).length,alternateWasResident:Boolean(cold.histories[second]),alternateMessageCountBefore:cold.histories[second]?.messages.length??0,alternateMessageCountAfter:final.histories[second]?.messages.length??0,serverFinal,cold:{marks:cold.marks,traffic:cold.traffic,samples:cold.samples,server:serverCold},uncachedSwitch:uncached,warmSwitches:warm,offscreenPreviewMs,warmOffscreenPreviewMs,typing:final.samples.filter(s=>s.operation==='field_edit'),readPosts:final.traffic.filter(t=>t.method==='POST'&&t.path.endsWith('/read')).length})
 }catch(error){report.errors.push({engine,viewport:viewportName,network:network.name,mode,iteration,error:String(error),state:await snapshot(page).catch(()=>null),pageErrors});throw error}finally{await context.close();await writeFile(output,JSON.stringify(report,null,2))}
}console.log(`${engine} ${viewportName} ${network.name} repetition ${iteration+1}/${samples}`)}}
 // A diagnostic account-ahead case explicitly counts the new request when global state needed none.
 for(const mode of ['baseline','device']){const context=await browser.newContext({viewport}),run=`ahead-${engine}-${viewportName}-${mode}`,page=await context.newPage();try{await post(context,'/fixture/reset',{mode,run,kind,accountAhead:true,network:{rttMs:0,bytesPerSecond:0}});await page.goto(new URL(`?mode=${mode}&run=${run}&selectionLane=${selectionLane}`,url).href);await page.bringToFront();await settled(page);const s=await snapshot(page),posts=s.traffic.filter(t=>t.method==='POST'&&t.path.endsWith('/read'));assert(posts.length===(mode==='baseline'?0:1),'Account-ahead unexpected reads '+posts.length);report.checks.push({engine,viewport:viewportName,case:'account-ahead',mode,passed:true,readPosts:posts.length,marks:s.marks})}finally{await context.close()}}
 }}finally{await browser.close();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2))}}
console.log(JSON.stringify({trials:report.trials.length,checks:report.checks.length,errors:report.errors.length,output}))
