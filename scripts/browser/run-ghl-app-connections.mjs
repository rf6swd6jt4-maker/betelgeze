// Actual dialog and selectors, mocked provider/API boundaries, no live accounts.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const state='a'.repeat(43),channel=createHash('sha256').update(state).digest('hex')
import {chromium,webkit} from 'playwright'
const server=spawn(process.execPath,['scripts/serve-client-connections-fixture.mjs'],{stdio:['ignore','pipe','inherit']})
try {
 const url=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match)resolve(match[0])});server.on('exit',code=>reject(Error(`Fixture exited ${code}`)))})
 const selected=process.argv.slice(2);assert.ok(selected.every(name=>['chromium','webkit'].includes(name)))
 await mkdir('browser-results/ghl-app',{recursive:true})
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!selected.length||selected.includes(name))) {
  const browser=await engine.launch()
  try { for(const width of [320,390,1280]) {
   const page=await browser.newPage({viewport:{width,height:844}}),errors=[],actions=[]
   page.on('pageerror',error=>errors.push(String(error)))
   await page.context().route('**/*',async route=>{
    const target=new URL(route.request().url())
    if(target.hostname==='marketplace.gohighlevel.com') return route.fulfill({status:200,contentType:'text/html',body:'<script>location.replace('+JSON.stringify(url+'oauth-fixture-callback?state='+state+'&code=synthetic-code')+')</script>'})
    return target.hostname==='127.0.0.1'?route.continue():route.abort()
   })
   let phase='ready',lostAck=false,enabled=false,reads=0,resumeStart=false
   const notifications=()=>({ready:true,sendingEnabled:enabled,consentReady:true,reminderMinutes:60})
   await page.route('**/client-connections/oauth*',async route=>{
    const body=route.request().postDataJSON();let result
    if(!body) {
     reads++
     result=route.request().url().includes('notification_status') ? notifications() : {relationshipId:'relationship',phase,locations:[{id:'location123456789',name:'Pilot sub-account'},{id:'otherlocation123',name:'Another sub-account'}],limited:false,locationId:'location123456789',calendars:[{id:'calendar123456789',name:'Visits'},{id:'secondcalendar123',name:'Estimates'}]}
    } else {
     actions.push(body.action)
     if(body.action==='start') {assert.equal(body.relationshipId,'relationship');assert.equal(body.expectedRevision,'00000000-0000-4000-8000-000000000001');result=resumeStart?{resume:true}:{authorizationUrl:'https://marketplace.gohighlevel.com/oauth/chooselocation?state='+state,channel}}
     else if(body.action==='select') {assert.equal(body.locationId,'location123456789');phase='selected';result={locationId:body.locationId,calendars:[{id:'calendar123456789',name:'Visits'},{id:'secondcalendar123',name:'Estimates'}]}}
     else if(body.action==='connect') {phase='done';result={connected:true,revision:'00000000-0000-4000-8000-000000000002',notifications:notifications()};if(lostAck){lostAck=false;return route.fulfill({status:503,json:{error:'Synthetic lost acknowledgement; resume to recover.'}})}}
     else if(body.action==='enable_notifications'||body.action==='disable_notifications') {enabled=body.action==='enable_notifications';result=notifications()}
     else throw Error(`Unexpected operation ${body.action}`)
    }
    await route.fulfill({status:200,json:result})
   })
   await page.goto(url)
   await page.getByText('Fixture Agency',{exact:false}).waitFor()
   assert.deepEqual(actions,[],'Opening the panel must not start provider work')
   assert.equal(reads,0,'Opening the panel must not request notification state per client')
   await page.getByRole('button',{name:'Actions for Synthetic Client – Fixture Business',exact:true}).click()
   await page.getByRole('button',{name:'Reconnect or choose another calendar',exact:true}).click()
   await page.evaluate(()=>{window.preservedDraft='unsaved workspace draft'})
   const popupPromise=page.waitForEvent('popup')
   await page.getByRole('dialog').getByRole('button',{name:'Connect HighLevel',exact:true}).click()
   const popup=await popupPromise
   await page.getByRole('button',{name:'Choose calendar',exact:true}).waitFor().catch(async error=>{console.error({reads,actions,errors,pages:await Promise.all(page.context().pages().map(async p=>({url:p.url(),text:await p.locator('body').innerText()})))});throw error})
   if(!popup.isClosed()) await popup.waitForEvent('close')
   assert.equal(page.url(),url,'Callback must return to the original resident workspace')
   assert.equal(await page.evaluate(()=>window.preservedDraft),'unsaved workspace draft')
   assert.equal(page.context().pages().length,1,'Temporary authorization and callback windows close')
   assert.deepEqual(actions,['start'])
   assert.equal(reads,2,'Opening the existing connection reads its status; return adds one session read, without polling')
   await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
   // Reopening a completed authorization must resume without another provider window.
   resumeStart=true
   await page.getByRole('button',{name:'Actions for Synthetic Client – Fixture Business',exact:true}).click()
   await page.getByRole('button',{name:'Reconnect or choose another calendar',exact:true}).click()
   const resumePopupPromise=page.waitForEvent('popup')
   await page.getByRole('dialog').getByRole('button',{name:'Connect HighLevel',exact:true}).click()
   const resumePopup=await resumePopupPromise
   await page.getByRole('button',{name:'Choose calendar',exact:true}).waitFor()
   if(!resumePopup.isClosed()) await resumePopup.waitForEvent('close')
   assert.equal(page.context().pages().length,1)
   await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
   // Blocked popups keep a usable ordinary link and explicit recovery in place.
   resumeStart=false
   await page.getByRole('button',{name:'Actions for Synthetic Client – Fixture Business',exact:true}).click()
   await page.getByRole('button',{name:'Reconnect or choose another calendar',exact:true}).click()
   await page.evaluate(()=>{window.open=()=>null})
   await page.getByRole('dialog').getByRole('button',{name:'Connect HighLevel',exact:true}).click()
   await page.getByRole('link',{name:'continue to HighLevel',exact:true}).waitFor()
   assert.match(await page.getByRole('link',{name:'continue to HighLevel',exact:true}).getAttribute('href'),/^https:\/\/marketplace.gohighlevel.com\/oauth\/chooselocation/)
   assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Connect HighLevel',exact:true}).count(),0,'Waiting must not offer repeated starts that discard the grant')
   await page.evaluate(()=>{const wrong=new BroadcastChannel('be-ghl:wrong-attempt');wrong.postMessage({type:'complete'});wrong.close()})
   assert.equal(await page.getByRole('button',{name:'Choose calendar',exact:true}).count(),0)
   await page.getByRole('button',{name:'Resume connection',exact:true}).click()
   await page.getByRole('button',{name:'Choose calendar',exact:true}).waitFor()
   assert.equal(page.url(),url)
   actions.length=0
   await page.getByRole('button',{name:'HighLevel sub-account',exact:true}).click()
   await page.getByRole('option',{name:'Pilot sub-account',exact:true}).click()
   await page.getByRole('button',{name:'Choose calendar',exact:true}).click()
   await page.getByRole('button',{name:'HighLevel calendar',exact:true}).click()
   await page.getByRole('option',{name:'Estimates',exact:true}).click()
   await page.getByRole('button',{name:'Save calendar connection',exact:true}).click()
   await page.getByText('Notifications off',{exact:true}).waitFor()
   assert.deepEqual(actions,['select','connect'],'Connecting must not enable notifications or send a test')
   await page.getByRole('button',{name:'Enable WhatsApp notifications',exact:true}).click()
   await page.getByText('Notifications enabled',{exact:true}).waitFor()
   await page.getByRole('button',{name:'Turn off WhatsApp notifications',exact:true}).click()
   await page.getByText('Notifications off',{exact:true}).waitFor()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.screenshot({path:`browser-results/ghl-app/${name}-${width}.png`,fullPage:true})
   phase='selected';lostAck=true
   await page.goto(url+'?ghl=selected')
   await page.getByRole('button',{name:'HighLevel calendar',exact:true}).click()
   await page.getByRole('option',{name:'Visits',exact:true}).click()
   await page.getByRole('button',{name:'Save calendar connection',exact:true}).click()
   await page.getByText('Synthetic lost acknowledgement; resume to recover.',{exact:true}).waitFor()
   await page.getByRole('button',{name:'Resume connection',exact:true}).click()
   await page.getByText('Notifications off',{exact:true}).waitFor()
   assert.equal(actions.filter(action=>action==='select').length,1,'Lost save acknowledgement cannot redeem another location token')
   assert.deepEqual(errors,[])
   console.log(`${name} ${width}: app return, sub-account/calendar selection, explicit enable/disable and lost-save recovery passed`)
   await page.close()
  }} finally {await browser.close()}
 }
} finally {server.kill('SIGTERM')}
