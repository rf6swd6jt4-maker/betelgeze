import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
import {chromium,webkit} from 'playwright'
const selected=process.argv.slice(2)
assert.ok(selected.every(x=>['chromium','webkit'].includes(x)))
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const server=spawn(process.execPath,['scripts/serve-shared-service-queue-fixture.mjs'],{stdio:['ignore','pipe','pipe']})
let count=0
try{
 const origin=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error(log)),60000);const read=c=>{log+=c;const m=log.match(/http:\/\/127\.0\.0\.1:\d+\//);if(m){clearTimeout(timer);resolve(m[0])}};server.stdout.on('data',read);server.stderr.on('data',read);server.once('exit',()=>reject(Error(log)))})
 for(const engine of selected.length?selected:['chromium','webkit']){
 const browser=await ({chromium,webkit})[engine].launch()
 try{for(const scenario of ['roster','roster-recovery','roster-recovery-closed','roster-stale','roster-storage','roster-malformed','queue','queue-recovery','queue-stale','queue-accountchanged','queue-storage','queue-malformed','account']){
 const context=await browser.newContext({viewport:{width:scenario==='roster'?1280:390,height:844}}),page=await context.newPage(),errors=[],calls=[]
 page.on('pageerror',e=>errors.push(e.message));let reads=0
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort())
 const queue=scenario.startsWith('queue')||scenario==='account'
 await page.addInitScript(scenario=>{
  if(scenario.endsWith('storage'))Storage.prototype.setItem=function(){throw Error('Storage unavailable')}
 },scenario)
 // Functions cannot cross the browser serialization boundary.
 if(scenario.endsWith('malformed'))await page.addInitScript(({key})=>sessionStorage.setItem(key,'invalid'),{key:queue?`shared-queue-command:${id(1)}:${id(2)}`:`service-members:${id(2)}:${id(11)}`})
 const roster={instanceId:id(11),version:1,primaryId:id(2),memberIds:[],people:[{id:id(2),name:'Alice'},{id:id(3),name:'Bob'}]}
 await page.route('**/api/**',async route=>{
  if(route.request().method()==='GET'){
   reads++
   if(queue)return route.fulfill({json:{kind:'queue',workspaceId:id(1),workspaceSlug:'fixture',userId:route.request().headers()['x-workspace-user'],view:'ready',items:[],total:0,ready:0,deferred:0,hasMore:false,aiEnabled:false}})
   return route.fulfill({json:roster})
  }
  const input=route.request().postDataJSON();calls.push(input)
  if(scenario.includes('recovery')&&calls.length===1 || scenario==='account')return route.abort()
  if(scenario==='queue-accountchanged')return route.fulfill({status:409,json:{error:'Your session changed',code:'account_changed'}})
  if(scenario.endsWith('stale'))return route.fulfill({status:409,json:{error:'Assignments changed. Reload before saving'}})
  return route.fulfill({json:queue?{id:input.id,status:'done',updated_at:'2026-01-02T00:00:00Z'}:{...roster,version:2,memberIds:[id(3)]}})
 })
 await page.goto(origin+(queue?'?queue=1':''))
 if(queue){
  await page.getByText('Started by Bob.',{exact:true}).waitFor()
  if(scenario.endsWith('malformed')){await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Complete',exact:true}).isEnabled(),false)}
  else{
   await page.getByRole('button',{name:'Complete',exact:true}).click();await page.getByText('This work was started by Bob.',{exact:false}).waitFor()
   await page.getByRole('button',{name:'Confirm complete'}).click()
   if(scenario.endsWith('storage')){await page.getByRole('alert').last().waitFor();assert.equal(calls.length,0)}
   else if(scenario==='queue-accountchanged'){await page.getByRole('alert').last().waitFor();assert.equal(await page.getByRole('button',{name:'Retry same action'}).count(),1)}
   else if(scenario.endsWith('stale')){await page.getByRole('alert').last().waitFor();assert.equal(calls.length,1)}
   else if(scenario.endsWith('recovery')||scenario==='account'){
    await page.getByRole('button',{name:'Retry same action'}).waitFor();const input=calls[0]
    if(scenario==='account'){
     await page.getByRole('button',{name:'Close popup'}).click()
     await page.getByRole('button',{name:'Switch fixture account'}).click();assert.equal(await page.getByRole('button',{name:'Retry same action'}).count(),0);assert.equal(calls.length,1)
    }else{
     await page.reload();await page.getByRole('button',{name:'Retry same action'}).click();await page.getByText('No ready work is assigned to you.',{exact:false}).waitFor();assert.deepEqual(calls[1],input)
    }
   }else{await page.getByText('No ready work is assigned to you.',{exact:false}).waitFor();assert.equal(calls[0].action,'complete');assert.equal(calls[0].id,id(20));assert.ok(calls[0].requestId)}
  }
 }else{
  assert.equal(reads,0);await page.getByRole('button',{name:'Manage assignees'}).click();await page.getByRole('button',{name:'Service assignees',exact:true}).waitFor()
  if(scenario.endsWith('malformed')){await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Save assignees'}).isEnabled(),false)}
  else{
   await page.getByRole('button',{name:'Service assignees',exact:true}).click();assert.equal(await page.getByRole('option',{name:'Alice'}).isEnabled(),false);await page.getByRole('option',{name:'Bob'}).click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Save assignees'}).click()
   if(scenario.endsWith('storage')){await page.getByRole('alert').waitFor();assert.equal(calls.length,0)}
   else if(scenario.endsWith('stale')){await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Reload assignees'}).click();await page.getByRole('button',{name:'Save assignees'}).waitFor();assert.equal(calls.length,1)}
   else{
    if(scenario.includes('recovery')){await page.getByRole('button',{name:'Retry same assignment change'}).waitFor();const input=calls[0];if(scenario.endsWith('closed'))await page.goto(origin+'?closed=1');else await page.reload();await page.getByRole('button',{name:scenario.endsWith('closed')?'Review saved assignment changes':'Manage assignees'}).click();await page.getByRole('button',{name:'Retry same assignment change'}).click();assert.deepEqual(calls[1],input)}
    await page.getByText('Assignees saved.',{exact:false}).waitFor();assert.deepEqual(calls[0].members,[id(3)])
   }
  }
 }
 assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await context.close();console.log(`PASS ${++count} ${engine}: ${scenario}`)
 }}finally{await browser.close()}
 }
}finally{server.kill('SIGTERM')}
