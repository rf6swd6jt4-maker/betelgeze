// Matched local component observations, not production latency or physical-device claims.
// The previous calendar is read via git show into the fixture's temporary build directory.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
const baseline = process.env.BE_CALENDAR_PERF_BASE ?? 'e196186707ec7ddc8acf0e241d64df4e222f1656'
const selected = process.argv.slice(2)
assert.ok(selected.every(name => ['chromium', 'webkit'].includes(name)))
const servers = [], rows = []
async function startServer(base) {
 const child = spawn(process.execPath, ['scripts/serve-client-connections-fixture.mjs'], { env: { ...process.env, BE_CALENDAR_FIXTURE_BASE: base ?? '' }, stdio: ['ignore', 'pipe', 'inherit'] })
 servers.push(child)
 return await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error('Fixture startup timed out')), 60_000)
  let output = ''
  child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) { clearTimeout(timer); resolve(match[0]) } })
  child.on('exit', code => { clearTimeout(timer); reject(Error(`Fixture exited ${code}`)) })
 })
}
const stats = values => { const sorted = [...values].sort((a,b) => a-b); return { n: sorted.length, medianMs: +sorted[Math.floor(sorted.length/2)].toFixed(2), p95Ms: +sorted[Math.ceil(sorted.length*.95)-1].toFixed(2), minMs: +sorted[0].toFixed(2), maxMs: +sorted.at(-1).toFixed(2) } }
try {
 const urls = { baseline: await startServer(baseline), candidate: await startServer() }
 const month = new Date().toISOString().slice(0,7)
 const nextMonth = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 1)).toISOString().slice(0,7)
 const calendars = [{ id: 'calendar123456789', name: 'Visits' }, { id: 'secondcalendar123', name: 'Estimates' }]
 const dayChoices=[15,16,17].filter(day=>day!==new Date().getUTCDate()).slice(0,2)
 const dayLabel = day => new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${month}-${String(day).padStart(2,'0')}T12:00:00Z`))
 for (const [engineName,engine] of [['chromium',chromium],['webkit',webkit]].filter(([name]) => !selected.length || selected.includes(name))) {
  const browser = await engine.launch()
  try { for (const width of [390,1280]) for (const count of [80,1000]) {
   console.log(`Measuring ${engineName} ${width} ${count} events`)
   const cases = {}
   async function open(arm) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'en-US', timezoneId: 'UTC' })
    const calls = [], errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    await page.route('**/connections/ghl/calendar**', route => {
     const request = route.request(), body = request.postDataJSON(), target = new URL(request.url())
     const id = body?.calendarId ?? target.searchParams.get('calendarId') ?? calendars[0].id
     const rangeMonth = body?.month ?? target.searchParams.get('month') ?? month
     const events = Array.from({ length: count }, (_, index) => {
      const day = String(index%28+1).padStart(2,'0'), hour = String(8+Math.floor(index/28)%10).padStart(2,'0')
      return { id: `appointment-${index}`, kind: 'appointment', title: `${id === calendars[0].id ? 'VISIT' : 'ESTIMATE'} ${index+1}`, start: `${rangeMonth}-${day}T${hour}:00:00Z`, end: `${rangeMonth}-${day}T${hour}:30:00Z`, allDay: false, status: 'confirmed', version: 4, detailsRetained: true }
     })
     const json = { revision: 'fixture-revision', calendars, refreshedAt: new Date().toISOString(), error: null, busy: false, complete: true, queued: false, detailsPending: false, snapshot: { source: 'booking-calendar', calendarId: id, owner: { id, name: calendars.find(c=>c.id===id).name }, month: rangeMonth, timezone: 'UTC', snapshotId: `snapshot-${id}-${rangeMonth}`, namesStatus: 'ready', events } }
     calls.push({ method: request.method(), bytes: Buffer.byteLength(JSON.stringify(json)), background: body?.background === true })
     return route.fulfill({ json })
    })
    await page.bringToFront()
    const start = performance.now()
    await page.goto(urls[arm]+'portal')
    await page.getByRole('button', { name: 'Portal calendar', exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && document.querySelector('[role="group"][aria-label$=" calendar"] button')?.getAttribute('aria-label')?.includes('event'))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const coldMs = performance.now()-start
    assert.equal(calls.length,1,'Cold fresh range uses one stored GET')
    assert.equal(calls[0].method,'GET')
    assert.deepEqual(errors,[])
    return { page, calls, errors, coldMs }
   }
   for (let sample=0;sample<5;sample++) for (const arm of sample%2 ? ['candidate','baseline'] : ['baseline','candidate']) {
    const current = await open(arm)
    cases[arm] ??= { cold: [], day: [], month: [], dayCommit: [], monthCommit: [] }
    cases[arm].cold.push(current.coldMs)
    if (sample===4) Object.assign(cases[arm],current)
    else await current.page.close()
   }
   // Warm the same second calendar and next month; setup requests excluded from warm observations.
   for (const arm of ['baseline','candidate']) {
    const {page} = cases[arm]
    await page.bringToFront()
    await page.getByRole('button',{name:'Portal calendar',exact:true}).click()
    await page.getByRole('option',{name:'Estimates',exact:true}).click()
    await page.getByText('ESTIMATE 1',{exact:true}).first().waitFor({state:'attached'})
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
    await page.getByRole('button',{name:'Portal calendar',exact:true}).click()
    await page.getByRole('option',{name:'Visits',exact:true}).click()
    await page.getByRole('button',{name:'Next month',exact:true}).click()
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
    const nextLabel = new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(nextMonth+'-01T12:00:00Z'))
    await page.getByRole('heading',{name:nextLabel,exact:true}).waitFor()
    await page.waitForFunction(value=>[...document.querySelectorAll('time')].some(node=>node.dateTime.startsWith(value)),nextMonth)
    await page.getByRole('button',{name:'Previous month',exact:true}).click()
    cases[arm].setupCalls = cases[arm].calls.length
    cases[arm].setupProviderPost = cases[arm].calls.filter(c=>c.method==='POST'&&!c.background).length
    assert.equal(cases[arm].setupCalls,3,'Warmup loads exactly three ranges without redundant queue admission')
    assert.equal(cases[arm].calls.filter(c=>c.background).length,0,'Fresh reads must not queue background refresh')
    if(arm==='candidate')assert.equal(cases[arm].setupProviderPost,0,'Uncached selection reads stored fresh ranges without provider work')
   }
   for (let sample=0;sample<20;sample++) for (const arm of sample%2 ? ['candidate','baseline'] : ['baseline','candidate']) {
    const entry=cases[arm],{page}=entry
    await page.bringToFront()
    // Align both arms to the same frame phase; record DOM commit and two-frame completion separately.
    const dayResult=await page.evaluate(async label => {
     const button=[...document.querySelectorAll('[role="group"][aria-label$=" calendar"] button')].find(node=>node.getAttribute('aria-label').startsWith(label+','))
     if(!button||button.getAttribute('aria-pressed')==='true')throw Error('Missing or already-selected day')
     await new Promise(resolve=>requestAnimationFrame(resolve))
     const start=performance.now()
     const commit=new Promise(resolve=>{const observer=new MutationObserver(()=>{if(button.getAttribute('aria-pressed')==='true'){observer.disconnect();resolve(performance.now()-start)}});observer.observe(button,{attributes:true,attributeFilter:['aria-pressed']})})
     button.click()
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
     return {frame:performance.now()-start,commit:await commit}
    },dayLabel(dayChoices[sample%2]))
    entry.day.push(dayResult.frame);entry.dayCommit.push(dayResult.commit)
    for(const direction of ['Next month','Previous month']) {
     const monthResult=await page.getByRole('button',{name:direction,exact:true}).evaluate(async node=>{
      const heading=document.querySelector('#appointments h3'),before=heading.textContent
      await new Promise(resolve=>requestAnimationFrame(resolve))
      const start=performance.now()
      const commit=new Promise(resolve=>{const observer=new MutationObserver(()=>{if(heading.textContent!==before){observer.disconnect();resolve(performance.now()-start)}});observer.observe(heading,{childList:true,characterData:true,subtree:true})})
      node.click();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
      return {frame:performance.now()-start,commit:await commit}
     })
     entry.month.push(monthResult.frame);entry.monthCommit.push(monthResult.commit)
    }
   }
   for (const arm of ['baseline','candidate']) {
    const entry=cases[arm]
    assert.equal(entry.calls.length,entry.setupCalls,'Resident calendar/day/month navigation must not issue reads or provider requests')
    assert.deepEqual(entry.errors,[])
    assert.equal(await entry.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    const row={arm,engine:engineName,width,events:count,cold:stats(entry.cold),cachedDay:stats(entry.day),cachedDayDomCommit:stats(entry.dayCommit),cachedMonth:stats(entry.month),cachedMonthDomCommit:stats(entry.monthCommit),initialReads:1,setupRequests:entry.setupCalls,setupProviderPost:entry.setupProviderPost,cachedRequests:0,cachedProviderPost:0,responseBytes:entry.calls[0].bytes,failures:entry.errors.length}
    rows.push(row);console.log(JSON.stringify(row))
    await entry.page.close()
   }
  }} finally {await browser.close()}
 }
 await mkdir('browser-results/ghl-calendar-performance',{recursive:true})
 await writeFile(`browser-results/ghl-calendar-performance/${selected.join('-')||'all'}.json`,JSON.stringify({baseline,recordedAt:new Date().toISOString(),conditions:'Loopback synthetic responses; production-mode single-chunk fixture; actual component before/after; same current shared primitives; no network throttling; cold5 small observations, cached20 day and40 month each; repeated selector timings excluded because baseline selector failed reopen under rapid repeats; functional selector cases are recorded separately; desktop browsers at mobile/desktop widths. Compile time excluded; cold measured navigation through hydrated calendar and two frames; warm start aligned to animation frame, DOM commit plus two-frame completion measured separately; sample arms alternate. Concurrent local validation may add load. Not full Next deployment or physical-device evidence.',rows},null,2))
} finally {for(const server of servers)server.kill('SIGTERM')}
