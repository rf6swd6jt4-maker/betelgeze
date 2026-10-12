import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, webkit } from 'playwright'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
mkdirSync('browser-results/service-pricing',{recursive:true})
const server=spawn(process.execPath,['scripts/serve-service-pricing-fixture.mjs'],{stdio:['ignore','pipe','pipe']})
try{
 const origin=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error(log)),60000);const read=chunk=>{log+=chunk;const match=log.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0])}};server.stdout.on('data',read);server.stderr.on('data',read);server.on('exit',()=>{clearTimeout(timer);reject(Error(log))})})
 for(const name of ['chromium','webkit']){
  const browser=await ({chromium,webkit})[name].launch()
  try{for(const scenario of ['pos','yearly','legacy-draft','paid-recovery','public','correction','recover','stale'])for(const width of [320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],requests=[]
   page.on('pageerror',e=>errors.push(e.message))
   await page.addInitScript(scenario=>{window.calls=[];window.fixtureSell=async input=>{window.calls.push(input);return{ok:true,notice:'Saved synthetic sale'}};window.fixtureCorrect=async input=>{window.calls.push(input);if(scenario==='recover'&&!sessionStorage.getItem('attempted')){sessionStorage.setItem('attempted',JSON.stringify(input));throw Error('Lost response')}if(scenario==='stale')return{ok:false,uncertain:false,error:'Prices changed. Reload the saved prices.'};return{ok:true}}},scenario)
   await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());requests.push(`${request.method()} ${url.pathname}${url.search}`)
    if(url.pathname.endsWith('/prices'))return route.fulfill({json:{saleId:id(5),version:0,currency:'USD',terms:{lines:[{id:id(6),upfrontCents:50000,recurringCents:150000}],upfrontTotal:50000,recurringTotal:150000,billingInterval:'month',billingIntervalCount:1},lines:[{id:id(6),name:'Growth service',recurringAllowed:true}],pending:null}})
    if(url.searchParams.get('kind')==='assignees')return route.fulfill({json:[{id:id(3),name:'Alex'}]})
    if(request.method()==='POST'){const input=request.postDataJSON();return route.fulfill({json:{userId:id(3),relationshipId:id(4),quote:{hash:'a'.repeat(64),currency:'USD',upfrontTotal:input.lines.reduce((s,l)=>s+l.upfrontCents,0),recurringTotal:input.lines.reduce((s,l)=>s+l.recurringCents,0),billingInterval:input.billingInterval,billingIntervalCount:input.billingIntervalCount,lines:input.lines,modules:[]}}})}
    if(url.pathname.endsWith('/pos'))return route.fulfill({json:await page.evaluate(()=>window.fixturePage)})
    return route.fulfill({status:500,json:{error:'Unexpected request'}})
   })
   if(scenario==='legacy-draft') await page.addInitScript(({key})=>sessionStorage.setItem(key,JSON.stringify({managerId:'old-manager',billingInterval:'month',lines:[]})),{key:`be:service-pos:draft:${id(3)}:fixture:${id(4)}`})
   if(scenario==='paid-recovery') await page.addInitScript(({key,request})=>sessionStorage.setItem(key,JSON.stringify(request)),{key:`be:price-correction:${id(3)}:fixture:${id(4)}:${id(5)}`,request:{requestId:id(90),saleId:id(5),expectedVersion:0,reason:'Correct the agreed additional fee',terms:{lines:[{id:id(6),upfrontCents:0,recurringCents:150000}],upfrontTotal:0,recurringTotal:150000,billingInterval:'month',billingIntervalCount:1}}})
   await page.goto(`${origin}?${scenario==='yearly'?'yearly=1':`mode=${['correction','recover','stale'].includes(scenario)?'correction':scenario}`}`)
   const breakdown=page.getByRole('region',{name:'Payment breakdown',exact:true})
   if(scenario==='paid-recovery'){
    await page.getByRole('button',{name:'Resume price correction'}).click()
    await page.getByRole('button',{name:'Retry same correction'}).click()
    await page.getByRole('status').filter({hasText:'Prices corrected'}).waitFor()
    assert.equal(await page.evaluate(()=>window.calls.length),1)
    assert.equal(await page.getByRole('button',{name:'Resume price correction'}).count(),0)
   }else if(['pos','yearly','legacy-draft'].includes(scenario)){
    if(scenario==='legacy-draft'){
     await page.getByRole('status').filter({hasText:'previous pricing display'}).waitFor()
     assert(await page.evaluate(key=>sessionStorage.getItem(key),`be:service-pos:draft:${id(3)}:fixture:${id(4)}`))
    }
    await page.getByRole('button',{name:/Growth service/}).click()
    await breakdown.getByText('$2,000.00 USD',{exact:true}).waitFor()
    const fee=page.getByRole('textbox',{name:'Additional one-time fee for Growth service'})
    await fee.fill('500.25');await fee.blur();assert.equal(await fee.inputValue(),'500.25')
    await breakdown.getByText('$2,000.25 USD',{exact:true}).waitFor()
    await fee.fill('0');await fee.blur();await breakdown.getByText('$1,500.00 USD',{exact:true}).waitFor()
    await fee.fill('500');await fee.blur()
    if(scenario==='yearly'){
     await breakdown.getByText('$1,500.00 every year',{exact:true}).waitFor()
     const recurring=page.getByRole('textbox',{name:'Recurring payment for Growth service'})
     await recurring.fill('0');await recurring.blur()
     await page.getByRole('button',{name:/^Weekly service/}).click()
     await recurring.fill('1500');await recurring.blur()
     await page.getByRole('alert').filter({hasText:'different billing schedules'}).waitFor()
     assert.equal(await recurring.inputValue(),'0.00')
     await page.getByRole('button',{name:/^Weekly service/}).click()
     await recurring.fill('1500');await recurring.blur()
     await breakdown.getByText('$1,500.00 every year',{exact:true}).waitFor()
    }
    await page.getByRole('button',{name:/^Weekly service/}).click();await page.getByRole('alert').filter({hasText:'different billing schedules'}).waitFor()
    assert.equal(await page.getByRole('textbox',{name:'Recurring payment for Weekly service'}).count(),0)
    await page.getByRole('button',{name:'Review onboarding',exact:true}).click()
    await page.getByRole('button',{name:'Choose contact methods'}).click()
    await page.getByRole('button',{name:/SMS/}).click()
    const sell=page.getByRole('button',{name:'Sell service & send link'})
    assert.equal(await sell.isEnabled(),false)
    await page.getByRole('checkbox',{name:/I reviewed/}).check();assert.equal(await sell.isEnabled(),true)
    await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('button',{name:'Back',exact:true}).click()
    await fee.fill('501');await fee.blur();await page.getByRole('button',{name:'Review onboarding',exact:true}).click();await page.getByRole('button',{name:'Choose contact methods'}).click()
    assert.equal(await page.getByRole('checkbox',{name:/I reviewed/}).isChecked(),false);assert.equal(await sell.isEnabled(),false)
    await page.getByRole('checkbox',{name:/I reviewed/}).check()
    await page.screenshot({path:`browser-results/service-pricing/${name}-${scenario}-${width}.png`})
    await sell.click();await page.getByRole('status').filter({hasText:'Saved synthetic sale'}).waitFor()
    const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,1);assert.equal(calls[0].pricingAcceptedHash,calls[0].quoteHash);assert.equal(calls[0].input.billingInterval,scenario==='yearly'?'year':'month');assert.equal(calls[0].input.lines[0].recurringCents,150000)
    assert(!requests.some(r=>r.includes('/prices')));assert.equal(requests.filter(r=>r.startsWith('POST')).length,2)
   }else if(scenario==='public'){
    await breakdown.getByText('$2,000.00 USD',{exact:true}).waitFor();await breakdown.getByText('$1,500.00 every month',{exact:true}).waitFor()
    assert.equal(requests.length,0)
    await page.screenshot({path:`browser-results/service-pricing/${name}-public-${width}.png`})
   }else{
    await breakdown.getByText('$2,000.00 USD',{exact:true}).waitFor()
    const save=page.getByRole('button',{name:'Save corrected prices',exact:true})
    assert.equal(await save.isEnabled(),false)
    await page.getByRole('textbox',{name:'Additional one-time fee for Growth service'}).fill('0')
    await page.getByRole('textbox',{name:'Reason for correction'}).fill('Correct the agreed additional fee')
    await page.getByRole('checkbox',{name:/I reviewed/}).check();assert.equal(await save.isEnabled(),true)
    await page.screenshot({path:`browser-results/service-pricing/${name}-${scenario}-${width}.png`})
    await save.click()
    if(scenario==='recover'){
     await page.getByRole('button',{name:'Retry same correction'}).waitFor();const first=await page.evaluate(()=>window.calls[0]);await page.reload()
     await page.getByRole('button',{name:'Retry same correction'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Additional one-time fee for Growth service'}).isEnabled(),false)
     assert(requests.some(r=>r.includes(`recovery=${first.requestId}`)))
     await page.getByRole('button',{name:'Retry same correction'}).click();await page.waitForFunction(()=>window.fixtureDone)
     assert.deepEqual(await page.evaluate(()=>window.calls[0]),first)
    }else if(scenario==='stale'){
     await page.getByRole('alert').filter({hasText:'Prices changed'}).waitFor();assert.equal(await save.isEnabled(),false)
     await page.getByRole('button',{name:'Retry loading'}).click();await breakdown.getByText('$2,000.00 USD',{exact:true}).waitFor()
     assert.equal(await page.getByRole('checkbox',{name:/I reviewed/}).isChecked(),false)
    }else await page.waitForFunction(()=>window.fixtureDone)
   }
   assert.deepEqual(errors,[])
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}/${scenario}/${width} overflow`)
   await context.close();console.log(`PASS ${name} ${scenario} ${width}`)
  }}finally{await browser.close()}
 }
}finally{server.kill()}
