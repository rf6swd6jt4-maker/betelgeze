import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
const require=createRequire('/Users/jedryszczyk/Developer/betelgeze/scripts/browser/package.json'),{webkit}=require('playwright')
const url=process.argv[2],output=process.argv[3]??'/private/tmp/device-progressive-browser-dedup.json',samples=Number(process.env.BE_DEDUP_SAMPLES??40),expectDuplicate=process.env.BE_EXPECT_DUPLICATE==='1'
const bundle=Buffer.from(await(await fetch(new URL('/bundle.js',url))).arrayBuffer())
const report={observedAt:new Date().toISOString(),bundleSha256:createHash('sha256').update(bundle).digest('hex'),expected:expectDuplicate?'reproduce previous admission race':'one batch, no duplicates',limits:'WebKit mobile390x844 loopback Client cold data; synthetic SQL/HTTP. Each run explicitly rechecks visible IDs20times synchronously after first preview request relinquishes its in-flight slot and before React can commit the queued result. Alternates shared/independent lane. This verifies admission, not production latency.',trials:[]}
const browser=await webkit.launch({headless:true})
try{for(let i=0;i<samples;i++){const selectionLane=i%2?'independent':'shared',context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),run=`dedup-${i}-${selectionLane}`,requests=[];try{
 await context.addInitScript(()=>{window.fixtureSettlementChallengeCalls=0;window.fixturePreviewSettlementChallenge=recheck=>{if(window.fixtureSettlementChallengeCalls++)return;for(let i=0;i<20;i++)recheck()}})
 page.on('request',request=>{if(request.url().endsWith('/fixture/previews'))requests.push(JSON.parse(request.postData()))})
 await context.request.post(new URL('/fixture/reset',url).href,{data:{mode:'device',run,kind:'client'}})
 await page.goto(new URL(`?mode=device&run=${run}&selectionLane=${selectionLane}`,url).href);await page.bringToFront();await page.waitForFunction(()=>{const s=window.fixture?.snapshot();return s?.marks.confirmed_badge_zero&&s.marks.visible_previews_meaningful_ready&&!s.loading.length&&s.traffic.every(t=>t.response)})
 await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
 const stats=await(await context.request.get(new URL('/fixture/metrics',url).href)).json(),calls=await page.evaluate(()=>window.fixtureSettlementChallengeCalls)
 const seen=new Set(),duplicates=[];for(const r of requests)for(const id of r.ids){if(seen.has(id))duplicates.push(id);seen.add(id)}
 const passed=expectDuplicate?stats.batches>1&&duplicates.length>0:stats.batches===1&&duplicates.length===0
 report.trials.push({iteration:i,selectionLane,passed,batches:stats.batches,requests:stats.requests.length,compressedBytes:stats.compressedBytes,challengeCalls:calls,duplicateIds:duplicates,batchBodies:requests})
 if(!passed)throw Error(`Unexpected batch admission: ${JSON.stringify(report.trials.at(-1))}`)
 console.log(i,selectionLane,'batches',stats.batches,'duplicates',duplicates.length)
 }finally{await context.close();await writeFile(output,JSON.stringify(report,null,2))}}}finally{await browser.close()}
console.log(JSON.stringify({trials:report.trials.length,passed:report.trials.filter(t=>t.passed).length,output}))
