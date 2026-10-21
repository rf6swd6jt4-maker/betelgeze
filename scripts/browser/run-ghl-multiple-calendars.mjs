// Actual portal component, isolated synthetic provider boundary; no live records.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {chromium,webkit} from 'playwright'
const server=spawn(process.execPath,['scripts/serve-client-connections-fixture.mjs'],{stdio:['ignore','pipe','inherit']})
try {
 const url=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match)resolve(match[0])});server.on('exit',code=>reject(Error(`Fixture exited ${code}`)))})
 const selected=process.argv.slice(2);assert.ok(selected.every(name=>['chromium','webkit'].includes(name)))
 await mkdir('browser-results/ghl-multiple-calendars',{recursive:true})
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!selected.length||selected.includes(name))) {
  const browser=await engine.launch()
  try {for(const width of [320,390,1280]) {
   const page=await browser.newPage({viewport:{width,height:844}}),errors=[],calls=[]
   page.on('pageerror',error=>errors.push(String(error)))
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
   const calendars=[{id:'calendar123456789',name:'Visits'},{id:'secondcalendar123',name:'Estimates'}],month=new Date().toISOString().slice(0,7)
   let revision='revision1',allowed=calendars,fail=false,revoked=false
   const state=(id,includeNames=false)=>({revision,calendars:allowed,refreshedAt:new Date().toISOString(),error:null,busy:false,snapshot:{source:'booking-calendar',calendarId:id,owner:{id,name:calendars.find(c=>c.id===id)?.name},month,timezone:'UTC',snapshotId:'snapshot-'+id,namesStatus:includeNames?'complete':'pending',events:[{id:'appointment-'+id,kind:'appointment',title:id===calendars[0].id?'FIRST CALENDAR APPOINTMENT':'SECOND CALENDAR APPOINTMENT',start:month+'-15T09:00:00Z',end:month+'-15T10:00:00Z',allDay:false,status:'confirmed'}]}})
   await page.route('**/connections/ghl/calendar**',async route=>{
    const request=route.request(),body=request.postDataJSON(),target=new URL(request.url())
    calls.push({method:request.method(),path:target.pathname,body})
    if(target.pathname.endsWith('/names')){const id=body.snapshotId.replace('snapshot-','');const result=state(id,true);delete result.calendars;return route.fulfill({json:result})}
    if(revoked)return route.fulfill({status:404,json:{error:'Synthetic access revoked'}})
    const id=body?.calendarId??target.searchParams.get('calendarId')??calendars[0].id
    if(fail&&request.method()==='POST'){fail=false;return route.fulfill({status:503,json:{error:'Synthetic provider unavailable'}})}
    await route.fulfill({json:allowed.some(c=>c.id===id)?state(id):{revision,calendars:allowed,snapshot:null,refreshedAt:null,error:null,busy:false}})
   })
   await page.goto(url+'portal')
   await page.getByRole('button',{name:'Portal calendar',exact:true}).waitFor()
   assert.equal(calls.length,1,'Initial read is one stored snapshot, not a provider fanout')
   await page.getByRole('button',{name:'Refresh',exact:true}).click()
   await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'))
   await page.getByRole('button',{name:'Portal calendar',exact:true}).waitFor()
   await page.getByRole('button',{name:'Portal calendar',exact:true}).click()
   await page.getByRole('option',{name:'Estimates',exact:true}).click()
   await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'))
   await page.getByText('SECOND CALENDAR APPOINTMENT',{exact:true}).first().waitFor({state:'attached'})
   assert.equal(await page.getByText('FIRST CALENDAR APPOINTMENT',{exact:true}).count(),0,'Do not mix calendars')
   const selectedCalls=calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/names'))
   assert.deepEqual(selectedCalls.map(c=>c.body.calendarId),calendars.map(c=>c.id))
   const before=calls.length
   await page.getByRole('button',{name:'Portal calendar',exact:true}).click()
   await page.getByRole('option',{name:'Visits',exact:true}).click()
   assert.equal(await page.getByText('SECOND CALENDAR APPOINTMENT',{exact:true}).count(),0)
   assert.ok(await page.getByText('FIRST CALENDAR APPOINTMENT',{exact:true}).count()>0)
   assert.equal(calls.length,before,'Returning to a cached calendar causes no provider request')
   fail=true
   await page.getByRole('button',{name:'Refresh',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Synthetic provider unavailable'}).waitFor()
   assert.ok(await page.getByText('FIRST CALENDAR APPOINTMENT',{exact:true}).count()>0,'A transient refresh failure retains the correct calendar')
   await page.getByRole('button',{name:'Portal calendar',exact:true}).click()
   await page.getByRole('option',{name:'Estimates',exact:true}).click()
   revision='revision2';allowed=[calendars[0]]
   await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+61000;window.dispatchEvent(new Event('focus'))})
   await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'))
   await page.getByRole('button',{name:'Portal calendar',exact:true}).waitFor({state:'detached'})
   assert.equal(await page.getByText('SECOND CALENDAR APPOINTMENT',{exact:true}).count(),0,'Removed calendar cache is fenced by connection revision')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.screenshot({path:`browser-results/ghl-multiple-calendars/${engineName}-${width}.png`,fullPage:true})
   await page.getByRole('button',{name:'Load calendar',exact:true}).click()
   await page.getByText('FIRST CALENDAR APPOINTMENT',{exact:true}).first().waitFor({state:'attached'})
   revoked=true
   await page.getByRole('button',{name:'Refresh',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Synthetic access revoked'}).waitFor()
   assert.equal(await page.getByText('FIRST CALENDAR APPOINTMENT',{exact:true}).count(),0,'Explicit access loss clears all calendar caches')
   assert.deepEqual(errors,[])
   console.log(`${engineName} ${width}: calendar selection, one-calendar refresh, name enrichment, bounded cache reuse, failure and revision recovery passed`)
   await page.close()
  }} finally {await browser.close()}
 }
} finally {server.kill('SIGTERM')}
