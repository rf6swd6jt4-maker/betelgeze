import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
import {chromium,webkit} from 'playwright'
const requestedEngine=process.argv[2]
assert.ok(!requestedEngine||['chromium','webkit'].includes(requestedEngine),'Expected chromium or webkit')
const server=spawn(process.execPath,['scripts/serve-client-connections-fixture.mjs'],{stdio:['ignore','pipe','inherit']})
try {
 const url=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match)resolve(match[0])});server.on('exit',code=>reject(Error(`Fixture exited ${code}`)))})
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!requestedEngine||name===requestedEngine)) {
  const browser=await engine.launch()
  try {for(const width of [1280,390]) {
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
   let resolveInitial,reads=0,mode='ok'
   const initial=new Promise(resolve=>{resolveInitial=resolve})
   const base={relationshipId:'00000000-0000-4000-8000-000000000001',clientName:'Synthetic Client',businessName:'Fixture Business',archived:false,status:'connected',accountId:'1234567890',accountName:'Advertising account',connectedAt:'2026-10-27T12:00:00Z',verifiedAt:'2026-10-27T12:00:00Z'}
   const accounts=[{...base,provider:'google_ads'},{...base,provider:'meta_ads'},{...base,provider:'windsor',status:'needs_attention'},{...base,provider:'google_ads',relationshipId:'archived-advertiser',clientName:'Archived advertiser',archived:true}]
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fallback():route.abort())
   await page.route('**/client-connections/advertising?*',async route=>{
    reads++;if(reads===1)await initial
    if(mode==='denied')return route.fulfill({status:403,json:{error:'Client connection access changed.'}})
    if(mode==='fail')return route.fulfill({status:503,json:{error:'Fixture offline'}})
    const q=new URL(route.request().url()).searchParams
    return route.fulfill({json:q.has('relationship')?{accounts:[accounts[0]],nextCursor:null}:q.has('after')?{accounts:[{...base,provider:'google_ads',relationshipId:'00000000-0000-4000-8000-000000000002',clientName:'Second Google client',businessName:null}],nextCursor:null}:{accounts,nextCursor:{relationshipId:base.relationshipId,provider:'windsor'}}})
   })
   await page.goto(url);await page.getByRole('button',{name:'Actions for Synthetic Client – Fixture Business',exact:true}).waitFor()
   await page.getByRole('button',{name:'Actions for Synthetic Client – Fixture Business',exact:true}).click()
   await page.getByRole('button',{name:'Manual connection and retirement',exact:true}).waitFor()
   await page.getByRole('button',{name:'Close popup',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});resolveInitial()
   await page.getByRole('button',{name:'Google Ads details for Synthetic Client – Fixture Business',exact:true}).waitFor();assert.equal(reads,1)
   assert.equal(await page.getByRole('listitem').count(),5)
   assert.equal(await page.getByText(/Archived advertiser|Archived Client|Unconfigured Client|Retired Client/).count(),0)
   const rows=await page.getByRole('listitem').evaluateAll(rows=>rows.map(row=>({height:row.getBoundingClientRect().height,bands:row.children.length})))
   assert.ok(rows.every(row=>row.height<=96&&row.bands===2),JSON.stringify(rows))
   await page.getByRole('button',{name:'Google Ads details for Synthetic Client – Fixture Business',exact:true}).click()
   await page.getByRole('dialog',{name:'Google Ads',exact:true}).getByText('1234567890',{exact:true}).waitFor()
   await page.keyboard.press('Escape')
   mode='fail';await page.getByRole('button',{name:'Load more advertising connections',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Fixture offline'}).waitFor();assert.equal(await page.getByRole('listitem').count(),5)
   mode='ok';await page.getByRole('button',{name:'Retry advertising connections',exact:true}).click()
   await page.getByText('Google Ads · Second Google client',{exact:true}).waitFor();assert.equal(await page.getByRole('listitem').count(),6)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.screenshot({path:`/tmp/client-advertising-${name}-${width}.png`,fullPage:true})
   await page.getByRole('button',{name:'Google Ads details for Synthetic Client – Fixture Business',exact:true}).click()
   mode='denied';await page.getByRole('button',{name:'Refresh saved status',exact:true}).click()
   await page.getByRole('dialog',{name:'Google Ads',exact:true}).waitFor({state:'hidden'})
   assert.equal(await page.getByRole('listitem').count(),2,'Access loss clears advertising data but preserves the independently authorized HighLevel owner')
   assert.deepEqual(errors,[]);console.log(`${name} ${width}: independent load, all providers, paging, failure/retry, access loss and row geometry passed`)
   await page.close()
  }}finally{await browser.close()}
 }
}finally{server.kill('SIGTERM')}
