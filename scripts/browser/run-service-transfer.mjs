import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
const engines=process.argv.slice(2)
if(engines.some(engine=>!['chromium','webkit'].includes(engine)))throw Error('Use chromium and/or webkit')
const server=spawn(process.execPath,['scripts/serve-service-transfer-fixture.mjs'],{stdio:['ignore','pipe','pipe']})
try {
 const origin=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error(log)),60000);const read=chunk=>{log+=chunk;const match=log.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0])}};server.stdout.on('data',read);server.stderr.on('data',read);server.on('exit',()=>reject(Error(log)))})
 for(const name of engines.length?engines:['chromium','webkit']) {
 const browser=await ({chromium,webkit})[name].launch()
 try { for(const scenario of ['success','uncertain','stale','preview-error','recover','recover-closed','recover-closed-rejected','recovery-empty','storage-failure']) {
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],serviceReads=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(scenario=>{window.calls=[];window.fixtureTransfer=async input=>{window.calls.push(input);if(scenario==='uncertain'&&window.calls.length===1)throw Error('Lost response');if(['recover','recover-closed','recover-closed-rejected'].includes(scenario)&&!sessionStorage.getItem('sent')){sessionStorage.setItem('sent','1');throw Error('Lost response')}if(scenario==='recover-closed-rejected')return{ok:false,uncertain:false,error:'Choose an active delivery service.'};if(scenario==='stale')return{ok:false,uncertain:false,error:'The work changed. Review a fresh preview.'};return{ok:true,receipt:{version:2}}};if(scenario==='storage-failure')Storage.prototype.setItem=function(){throw Error('No device storage')}},scenario)
  await page.route('**/api/services?*',async route=>{
   const url=new URL(route.request().url()); const kind=url.searchParams.get('kind');serviceReads.push(kind)
   if(kind==='assignees')return route.fulfill({json:[{id:'00000000-0000-4000-8000-000000000005',name:'New Staff'}]})
   if(scenario==='preview-error')return route.fulfill({status:409,json:{error:'This service changed. Reload the preview.'}})
   return route.fulfill({json:{instanceId:'00000000-0000-4000-8000-000000000006',recipientName:'New Staff',formerName:'Former',fingerprint:'a'.repeat(32),version:1,stage:'setup',formerId:'00000000-0000-4000-8000-000000000004',recipientId:'00000000-0000-4000-8000-000000000005',appointment:true,bookingEnabled:true,formerSetupRetained:true,formerBookingRetained:false,teamMembershipRetained:true,items:[
    {id:'00000000-0000-4000-8000-000000000010',title:'Prepare campaign',status:'todo',execution_owner_id:'00000000-0000-4000-8000-000000000004',assignees:['00000000-0000-4000-8000-000000000004'],movable:true,shared:false},
    {id:'00000000-0000-4000-8000-000000000011',title:'Shared review',status:'todo',execution_owner_id:'00000000-0000-4000-8000-000000000004',assignees:['00000000-0000-4000-8000-000000000004'],movable:false,shared:true},
    {id:'00000000-0000-4000-8000-000000000012',title:'Another owner task',status:'todo',execution_owner_id:'00000000-0000-4000-8000-000000000014',assignees:['00000000-0000-4000-8000-000000000014'],movable:true,shared:false},
    {id:'00000000-0000-4000-8000-000000000013',title:'Inherits service owner',status:'todo',execution_owner_id:null,assignees:[],movable:true,shared:false}
   ]}})
  })
  await page.goto(scenario==='recovery-empty'?`${origin}?recovery=1`:origin)
  if(scenario==='recovery-empty'){
   await page.getByText('No saved transfer requests were found on this device.').waitFor()
   assert.equal(await page.getByRole('button',{name:'New service assignee'}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Transfer assignee',exact:true}).count(),0)
   assert.equal(await page.getByRole('button',{name:'Retry same transfer'}).count(),0)
   assert.deepEqual(serviceReads,[]);assert.equal(await page.evaluate(()=>window.calls.length),0)
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${name}: ${scenario}`);continue
  }
  await page.getByRole('button',{name:'New service assignee'}).click()
  await page.getByRole('option',{name:'New Staff'}).click()
  if(scenario==='preview-error'){
   await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Transfer assignee',exact:true}).isEnabled(),false)
  }else{
   await page.getByText('2 open work items will move.',{exact:false}).waitFor()
   assert.equal(await page.getByRole('checkbox',{name:'Shared review'}).isEnabled(),false)
   assert.equal(await page.getByRole('checkbox',{name:'Inherits service owner'}).isEnabled(),false)
   assert.equal(await page.getByRole('checkbox',{name:'Another owner task'}).isChecked(),false)
   await page.getByRole('textbox',{name:'Reason'}).fill('Reassign delivery responsibility')
   await page.getByRole('checkbox',{name:/I reviewed/}).check()
   await page.getByRole('button',{name:'Transfer assignee',exact:true}).click()
   if(scenario==='storage-failure'){
    await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.calls.length),0)
   }else if(scenario==='stale'){
    await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Transfer assignee',exact:true}).isEnabled(),false)
    await page.getByRole('button',{name:'Reload preview'}).click();await page.getByRole('checkbox',{name:/I reviewed/}).waitFor();assert.equal(await page.getByRole('checkbox',{name:/I reviewed/}).isChecked(),false)
   }else{
    if(['recover','recover-closed','recover-closed-rejected'].includes(scenario)){
     await page.getByRole('button',{name:'Retry same transfer'}).waitFor();const original=await page.evaluate(()=>window.calls[0]);const readsBeforeRecovery=serviceReads.length
     if(scenario==='recover')await page.reload();else await page.goto(`${origin}?recovery=1`)
     await page.getByRole('button',{name:'Review saved transfer requests'}).click();await page.getByRole('button',{name:/Recover transfer:/}).first().click();
     if(scenario!=='recover'){assert.equal(serviceReads.length,readsBeforeRecovery);assert.equal(await page.getByRole('button',{name:'New service assignee'}).isEnabled(),false)}
     await page.getByRole('button',{name:'Retry same transfer'}).click()
     if(scenario==='recover-closed-rejected'){
      await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Transfer assignee',exact:true}).count(),0)
      assert.equal(await page.getByRole('button',{name:'Reload preview'}).count(),0)
      assert.equal(serviceReads.length,readsBeforeRecovery)
     }else await page.getByText('Transfer saved.',{exact:false}).waitFor()
     assert.deepEqual(await page.evaluate(()=>window.calls[0]),original)
    }
    if(scenario==='uncertain'){
     await page.getByRole('button',{name:'Retry same transfer'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Reason'}).isEnabled(),false)
     await page.getByRole('button',{name:'Retry same transfer'}).click()
     assert.deepEqual(await page.evaluate(()=>window.calls[0]),await page.evaluate(()=>window.calls[1]))
    }
    if(scenario!=='recover-closed-rejected'){await page.getByText('Transfer saved.',{exact:false}).waitFor();await page.getByRole('button',{name:'Done — refresh service'}).click();assert.equal(await page.evaluate(()=>window.fixtureDone),true)}
   }
  }
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${name}: ${scenario}`)
 }}finally{await browser.close()}
 }
}finally{server.kill('SIGTERM')}
