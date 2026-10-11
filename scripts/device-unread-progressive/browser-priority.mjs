import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
const require=createRequire('/Users/jedryszczyk/Developer/betelgeze/scripts/browser/package.json'),{chromium,webkit}=require('playwright')
const url=process.argv[2],output=process.argv[3]??'/private/tmp/device-progressive-browser-priority.json'
const bundle=Buffer.from(await(await fetch(new URL('/bundle.js',url))).arrayBuffer())
const report={observedAt:new Date().toISOString(),bundleSha256:createHash('sha256').update(bundle).digest('hex'),limits:'3 observations per browser/viewport/lane; synthetic150ms API RTT plus shared1Mbps gzip-body throughput and deliberately delayed500ms preview response. Plaintext PGlite fixture, not production or physical devices.',trials:[]}
const assert=(ok,message)=>{if(!ok)throw Error(message)}
for(const engine of ['chromium','webkit']){const browser=await({chromium,webkit})[engine].launch({headless:true});try{for(const [name,viewport]of Object.entries({desktop:{width:1280,height:900},mobile:{width:390,height:844}})){for(let i=0;i<3;i++){for(const selectionLane of i%2?['independent','shared']:['shared','independent']){const context=await browser.newContext({viewport}),page=await context.newPage(),run=`priority-${engine}-${name}-${i}-${selectionLane}`;try{
 await context.request.post(new URL('/fixture/reset',url).href,{data:{mode:'device',run,kind:'native',latencyMs:150,bytesPerSecond:125000}})
 await page.goto(new URL(`?mode=device&run=${run}&selectionLane=${selectionLane}`,url).href);await page.bringToFront();await page.waitForFunction(()=>{const s=window.fixture?.snapshot();return s?.marks.confirmed_badge_zero&&s.marks.visible_previews_meaningful_ready&&!s.loading.length&&s.traffic.every(t=>t.response)})
 await context.request.post(new URL('/fixture/control',url).href,{data:{holdPreviewMs:500}})
 const previous=await page.evaluate(()=>window.fixtureTraffic.length);await page.locator('.list').evaluate(node=>node.scrollTop=node.scrollHeight/2)
 await page.waitForFunction(previous=>window.fixtureTraffic.slice(previous).some(t=>t.path==='/fixture/previews'),previous)
 const id=await page.evaluate(()=>window.fixture.snapshot().roster.at(-1).id);await page.evaluate(id=>window.fixture.select(id),id)
 await page.waitForFunction(id=>window.fixture.snapshot().selected===id&&window.fixtureSamples.some(s=>s.operation==='conversation_switch'&&s.outcome==='completed'),id)
 const selected=await page.evaluate(()=>window.fixtureSamples.filter(s=>s.operation==='conversation_switch').at(-1));await page.waitForFunction(()=>{const s=window.fixture.snapshot();return !s.summary.rows.some(row=>row.conversationId===s.selected)})
 const state=await page.evaluate(()=>window.fixture.snapshot()),traffic=state.traffic.slice(previous),data=traffic.filter(t=>['/fixture/previews','/fixture/history'].includes(t.path))
 const events=data.flatMap(t=>[{time:t.started,delta:1},...(t.response?[{time:t.response,delta:-1}]:[])]).sort((a,b)=>a.time-b.time||a.delta-b.delta);let active=0,max=0;for(const event of events){active+=event.delta;max=Math.max(active,max)}
 assert(traffic.filter(t=>t.path==='/fixture/history').length===1,'Duplicate selected history');assert(max<=(selectionLane==='independent'?2:1),'Data concurrency bound exceeded')
 report.trials.push({engine,viewport:name,iteration:i,selectionLane,selectedPaintMs:selected.durationMs,maxDataConcurrent:max,traffic});console.log(engine,name,i,selectionLane,selected.durationMs)
 }finally{await context.close();await writeFile(output,JSON.stringify(report,null,2))}}}}}finally{await browser.close()}}
console.log(JSON.stringify({trials:report.trials.length,output}))
