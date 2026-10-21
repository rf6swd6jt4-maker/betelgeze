// Actual hydrated portal and shared detail components. Synthetic endpoints only.
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
   const page=await browser.newPage({viewport:{width,height:844},locale:'en-US',timezoneId:'UTC'}),errors=[],calls=[]
   page.on('pageerror',error=>errors.push(String(error)))
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
   const calendars=[{id:'calendar123456789',name:'Visits'},{id:'secondcalendar123',name:'Estimates'}],month=new Date().toISOString().slice(0,7)
   const firstTitle='FIRST CALENDAR APPOINTMENT',secondTitle='SECOND CALENDAR APPOINTMENT'
   let revision='revision1',allowed=calendars,fail=false,revoked=false,detailFailure=null,offset=0,stale=false,queued=false,revokeBackground=false,empty=false
   const state=(id,rangeMonth=month,includeNames=false)=>({revision,calendars:allowed,refreshedAt:new Date(Date.now()+offset-(stale?6*60_000:0)).toISOString(),error:null,busy:queued,complete:true,queued,detailsPending:queued,snapshot:{source:'booking-calendar',calendarId:id,owner:{id,name:calendars.find(c=>c.id===id)?.name},month:rangeMonth,timezone:id===calendars[0].id?'UTC':'America/Chicago',snapshotId:'snapshot-'+id,namesStatus:includeNames?'complete':'pending',events:empty?[]:[{id:'appointment-'+id,kind:'appointment',title:id===calendars[0].id?firstTitle:secondTitle,start:rangeMonth+'-15T09:00:00Z',end:rangeMonth+'-15T10:00:00Z',allDay:false,status:'confirmed',version:4,detailsRetained:true}]}})
   await page.route('**/connections/ghl/calendar**',async route=>{
    const request=route.request(),body=request.postDataJSON(),target=new URL(request.url())
    calls.push({method:request.method(),path:target.pathname,body,query:target.search})
    if(revoked)return route.fulfill({status:404,json:{error:'Synthetic access revoked'}})
    if(target.pathname.endsWith('/names')){const id=body.snapshotId.replace('snapshot-','');const result=state(id,month,true);result.snapshot.events=result.snapshot.events.map(event=>({...event,originalTitle:event.title,contactCity:'Synthetic label city',start:month+'-14T08:00:00Z',end:month+'-14T08:30:00Z',version:1,status:'cancelled',detailsRetained:false}));delete result.calendars;return route.fulfill({json:result})}
    const id=body?.calendarId??target.searchParams.get('calendarId')??calendars[0].id,rangeMonth=body?.month??target.searchParams.get('month')??month
    if(fail&&request.method()==='POST'&&!body?.background){fail=false;return route.fulfill({status:503,json:{error:'Synthetic provider unavailable'}})}
    if(body?.background&&revokeBackground)return route.fulfill({status:404,json:{error:'Synthetic background access revoked'}})
    if(body?.background)queued=true
    await route.fulfill({status:body?.background?202:200,json:allowed.some(c=>c.id===id)?state(id,rangeMonth):{revision,calendars:allowed,snapshot:null,refreshedAt:null,error:null,busy:false}})
   })
   await page.route('**/connections/ghl/appointments/**',async route=>{
    calls.push({method:'GET',path:new URL(route.request().url()).pathname,detail:true})
    if(detailFailure)return route.fulfill({status:detailFailure==='unavailable'?503:404,json:{error:detailFailure==='access'?'Synthetic access revoked':'Synthetic detail failure',code:detailFailure}})
    await route.fulfill({json:{summary:{reference:'appointment-calendar123456789',title:firstTitle,calendarName:'Visits',contactName:'SYNTHETIC SHARED CONTACT',startTime:month+'-15T09:00:00Z',endTime:month+'-15T10:00:00Z',timezone:'UTC',timezoneKnown:true,status:'confirmed',contactDetails:'synthetic@example.test',meetingDetails:'Synthetic office',bookingDetails:'Six windows',removed:false,observedAt:new Date().toISOString(),version:4}}})
   })
   const switchCalendar=async name=>{await page.getByRole('button',{name:'Portal calendar',exact:true}).click();await page.getByRole('option',{name,exact:true}).click()}
   const dayLabel=new Intl.DateTimeFormat('en-US',{dateStyle:'full',timeZone:'UTC'}).format(new Date(month+'-15T12:00:00Z'))
   const selectDay=()=>page.getByRole('button',{name:new RegExp(`${dayLabel},`)}).click()
   const focusRead=async()=>{offset+=61_000;await page.evaluate(value=>{window.fixtureOffset=value;window.fixtureNow??=Date.now;Date.now=()=>window.fixtureNow()+window.fixtureOffset;window.dispatchEvent(new Event('focus'))},offset)}
   await page.goto(url+'portal')
   await page.getByRole('button',{name:'Portal calendar',exact:true}).waitFor()
   assert.equal(calls.length,1,'Initial fresh cache is one GET without provider fanout')
   await page.getByRole('button',{name:'Refresh',exact:true}).click()
   await page.waitForFunction(()=>!document.querySelector('[aria-busy="true"]'))
   await selectDay()
   await page.getByText('Contact location: Synthetic label city',{exact:true}).waitFor({state:'attached'})
   await page.getByRole('button',{name:firstTitle,exact:true}).waitFor({state:'attached'})
   assert.equal(await page.getByText('Cancelled',{exact:true}).count(),0,'Legacy name enrichment cannot roll back canonical status')
   assert.match(await page.getByRole('list',{name:'Schedule on selected day'}).locator('time').textContent(),/9:00/,'Legacy labels cannot roll back appointment day or time')
   await switchCalendar('Estimates')
   await page.getByText(secondTitle,{exact:true}).first().waitFor({state:'attached'})
   assert.equal(await page.getByText(firstTitle,{exact:true}).count(),0)
   assert.equal(calls.filter(c=>c.method==='POST'&&!c.path.endsWith('/names')&&!c.body?.background).length,1,'Calendar selection uses stored GET, not provider POST')
   assert.equal(calls.filter(c=>c.body?.background).length,0,'Fresh stored calendar read does not race redundant background admission')
   const before=calls.length
   await switchCalendar('Visits')
   assert.ok(await page.getByText(firstTitle,{exact:true}).count()>0)
   assert.equal(calls.length,before,'Returning to a fresh cached calendar does not fetch')
   await selectDay()
   await page.getByRole('button',{name:firstTitle,exact:true}).click()
   await page.locator('[data-appointment-details]').waitFor()
   await page.getByText('SYNTHETIC SHARED CONTACT',{exact:true}).waitFor()
   const callsWhileDetailOpen=calls.length
   await focusRead()
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   assert.equal(calls.length,callsWhileDetailOpen,'Hidden calendar does not read or queue refresh while appointment details are open')
   offset=0;await page.evaluate(()=>{window.fixtureOffset=0})
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Shared detail remains within the mobile viewport')
   const fieldGeometry=await page.locator('[data-appointment-details] > section[data-surface="light"]').evaluate(fields=>{
    const parent=fields.getBoundingClientRect()
    return {columns:getComputedStyle(fields).gridTemplateColumns.trim().split(/\s+/),width:parent.width,rows:[...fields.children].map(row=>{
     const box=row.getBoundingClientRect(),label=row.querySelector('p'),value=row.querySelector(':scope > div')
     return {top:box.top,bottom:box.bottom,width:box.width,labelWidth:label.getBoundingClientRect().width,labelHeight:label.getBoundingClientRect().height,labelLineHeight:parseFloat(getComputedStyle(label).lineHeight),valueWidth:value.getBoundingClientRect().width}
    })}
   })
   assert.equal(fieldGeometry.columns.length,1,'Shared detail fields must have one column, isolated from the seven-column calendar module')
   assert.ok(fieldGeometry.rows.length>=8)
   fieldGeometry.rows.forEach((row,index)=>{
    assert.ok(row.width>=fieldGeometry.width-2,'Each field spans the available detail width')
    if(index)assert.ok(row.top>=fieldGeometry.rows[index-1].bottom-1,'Detail field rows never overlap')
    assert.ok(row.labelWidth>=90&&row.valueWidth>=80,'Field labels and values retain readable widths')
    assert.ok(row.labelHeight<=row.labelLineHeight*2+1,'Field labels do not collapse into vertical letters')
   })
   if(width===390)await page.screenshot({path:`browser-results/ghl-multiple-calendars/${engineName}-detail-390.png`,fullPage:true})
   assert.equal(calls.filter(c=>c.detail).length,1)
   await page.getByRole('button',{name:'Back to calendar',exact:false}).click()
   assert.equal(await page.getByRole('button',{name:new RegExp(`${dayLabel},`)}).getAttribute('aria-pressed'),'true','Detail back preserves selected day')
   assert.equal(calls.filter(c=>c.detail).length,1,'Back does not reload details or calendar')
   const cachedCalls=calls.length
   await switchCalendar('Estimates');await selectDay()
   const expectedChicago=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(month+'-15T09:00:00Z'))
   await page.getByRole('list',{name:'Schedule on selected day'}).scrollIntoViewIfNeeded()
   const actualChicago=await page.getByRole('list',{name:'Schedule on selected day'}).locator('time').textContent()
   assert.ok(actualChicago.replace(/\s/g,' ').startsWith(expectedChicago.replace(/\s/g,' ')),`Cached calendar uses its own timezone: ${actualChicago} expected ${expectedChicago}`)
   await switchCalendar('Visits');await selectDay()
   assert.equal(calls.length,cachedCalls,'Both cached calendar navigations stay local')
   detailFailure='not_retained'
   await page.getByRole('button',{name:firstTitle,exact:true}).click()
   await page.getByRole('alert').filter({hasText:'still syncing'}).waitFor()
   detailFailure=null;await page.getByRole('button',{name:'Retry details',exact:true}).click()
   await page.getByText('SYNTHETIC SHARED CONTACT',{exact:true}).waitFor()
   await page.getByRole('button',{name:'Back to calendar',exact:false}).click()
   fail=true
   await page.getByRole('button',{name:'Refresh',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Synthetic provider unavailable'}).waitFor()
   assert.ok(await page.getByText(firstTitle,{exact:true}).count()>0,'Failed provider refresh retains saved content')
   // An old complete range queues bounded work, while useful saved content stays visible.
   stale=true;await focusRead()
   await page.getByText('Checking GHL for calendar updates…',{exact:true}).waitFor()
   assert.ok(await page.getByText(firstTitle,{exact:true}).count()>0)
   assert.equal(calls.filter(c=>c.body?.background).length,1,'Stale range queues once')
   stale=false;queued=false;await focusRead()
   await page.getByText('Checking GHL for calendar updates…',{exact:true}).waitFor({state:'detached'})
   await switchCalendar('Estimates')
   revision='revision2';allowed=[calendars[0]]
   await focusRead()
   await page.getByRole('button',{name:'Portal calendar',exact:true}).waitFor({state:'detached'})
   assert.equal(await page.getByText(secondTitle,{exact:true}).count(),0,'Revision change clears removed-calendar cache')
   await page.getByText(firstTitle,{exact:true}).first().waitFor({state:'attached'})
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.screenshot({path:`browser-results/ghl-multiple-calendars/${engineName}-${width}.png`,fullPage:true})
   revoked=true
   await page.getByRole('button',{name:'Refresh',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Synthetic access revoked'}).waitFor()
   assert.equal(await page.getByText(firstTitle,{exact:true}).count(),0,'Explicit revocation clears saved content')
   // Access loss from background admission is as authoritative as manual refresh.
   revoked=false;revision='revision3';allowed=calendars;stale=true;queued=false;revokeBackground=true;offset=0
   await page.goto(url+'portal?scenario=background-revocation')
   await page.getByRole('alert').filter({hasText:'Synthetic background access revoked'}).waitFor()
   assert.equal(await page.getByText(firstTitle,{exact:true}).count(),0)
   revokeBackground=false;stale=false;queued=false;detailFailure='access'
   await page.goto(url+'portal?scenario=detail-revocation');await selectDay()
   await page.getByRole('button',{name:firstTitle,exact:true}).click()
   await page.getByRole('alert').filter({hasText:'Synthetic access revoked'}).waitFor()
   assert.equal(await page.getByText(firstTitle,{exact:true}).count(),0,'Detail access loss clears underlying cached calendar')
   detailFailure=null;empty=true;stale=true;queued=false
   await page.goto(url+'portal?scenario=stale-empty')
   await page.getByText('Checking GHL for calendar updates…',{exact:true}).waitFor()
   assert.equal(await page.getByText('Nothing scheduled on this day.',{exact:true}).count(),0,'Stale empty cache is never reported as authoritative empty')
   assert.deepEqual(errors,[])
   console.log(`${engineName} ${width}: shared details/back/retry, cached selection, queued stale refresh, provider failure, revision, background/detail revoked scope and stale-empty truthfulness passed`)
   await page.close()
  }} finally {await browser.close()}
 }
} finally {server.kill('SIGTERM')}
