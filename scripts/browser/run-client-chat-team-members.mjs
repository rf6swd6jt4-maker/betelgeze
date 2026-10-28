// Real workspace components, synthetic data and transport only.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {chromium,webkit} from 'playwright'
const output=process.env.CLIENT_CHAT_MEMBERS_OUTPUT??join(tmpdir(),'client-chat-permissions-browser')
const engines=process.argv.slice(2)
if(engines.some(e=>!['chromium','webkit'].includes(e)))throw Error('Use chromium or webkit')
await mkdir(output,{recursive:true})
const server=spawn(process.execPath,['scripts/serve-fullscreen-comms-preview.mjs','--host','127.0.0.1','--port','0'],{stdio:['ignore','pipe','pipe']})
const origin=await new Promise((resolve,reject)=>{
 let log='';const timer=setTimeout(()=>reject(Error(`Preview startup timeout: ${log}`)),90_000)
 const receive=chunk=>{log=(log+chunk).slice(-12000);const match=log.match(/http:\/\/localhost:(\d+)\//);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`)}}
 server.stdout.on('data',receive);server.stderr.on('data',receive)
 server.once('exit',code=>{clearTimeout(timer);reject(Error(`Preview exited ${code}: ${log}`))})
})
const results=[]
try{
 for(const [engine,driver]of Object.entries({chromium,webkit})){
  if(engines.length&&!engines.includes(engine))continue
  const browser=await driver.launch()
  try{for(const mobile of[false,true]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},hasTouch:mobile,isMobile:mobile})
   await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort())
   const page=await context.newPage(),errors=[];page.setDefaultTimeout(12_000)
   page.on('pageerror',e=>errors.push(e.message))
   try{
    await page.goto(`${origin}/?client-team-members`)
    await page.evaluate(()=>{
     const original=window.fetch
     window.memberFixture={reads:0,writes:[],refreshes:0,views:['preview-sam'],edits:[],mode:'normal',readOnly:false,writeCalls:[]}
     window.fetch=async(input,options={})=>{
      const url=String(input),s=window.memberFixture
      const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}})
      if(url.includes('/communications/participants')){
       if(options.method!=='POST'){s.reads++;throw Error('Unexpected participant fetch')}
       const body=JSON.parse(options.body);s.writes.push(body)
       if(s.mode==='failed')return json({error:'Synthetic save failure'},503)
       s.views=body.viewIds;s.edits=body.viewIds.filter(id=>!(body.viewOnlyIds??[]).includes(id))
       if(s.mode==='lost-ack'){s.mode='normal';throw TypeError('Synthetic lost acknowledgement')}
       if(s.mode==='hold-post')return new Promise(resolve=>{s.releasePost=()=>resolve(json({ok:true}))})
       return json({ok:true})
      }
      if(url.includes('/communications/sync')){
       s.refreshes++;const raw=await original(input,options),data=await raw.json()
       const c=data.conversations.find(c=>c.id==='preview-client-0');c.canWrite=!s.readOnly
       c.participants={managerId:s.readOnly?'preview-alex':'preview-you',memberIds:['preview-you','preview-alex',...s.views],optionalIds:s.readOnly?['preview-you',...s.views]:s.views,eligibleIds:['preview-sam','preview-jamie'],viewOnlyIds:[...(s.readOnly?['preview-you']:[]),...s.views.filter(id=>!s.edits.includes(id))]}
       if(s.mode==='hold-refresh')return new Promise(resolve=>{s.releaseRefresh=()=>resolve(json(data))})
       return json(data)
      }
      if(options.method&&options.method!=='GET'&&/\/communications\/(messages|reactions|typing|attachments|reconfirm|pins|checklist)/.test(url))s.writeCalls.push(url)
      return original(input,options)
     }
    })
    const openChat=async title=>{await page.getByText(title,{exact:true}).click();if(mobile)await page.waitForFunction(()=>document.querySelector('[data-mobile-conversation-surface]:not([hidden])')?.dataset.phase==='open')}
    await openChat('Project team')
    await page.getByRole('button',{name:'View Project team members',exact:true}).click()
    assert.equal(await page.getByRole('dialog',{name:'Project team',exact:true}).getByRole('button',{name:'Add to Client chat',exact:true}).count(),0)
    assert.equal(await page.evaluate(()=>window.memberFixture.reads),0)
    await page.keyboard.press('Escape')
    if(mobile)await page.getByRole('button',{name:'Back to team conversations',exact:true}).click()
    await page.getByRole('tab',{name:'Clients',exact:true}).click();await openChat('Northstar Studio')
    const trigger=page.getByRole('button',{name:'Client conversation participants',exact:true}),dialog=page.getByRole('dialog',{name:'Client conversation',exact:true})
    const check=(kind,name)=>dialog.getByRole('checkbox',{name:`${kind} access for ${name}`,exact:true})
    await trigger.click();assert.equal(await dialog.getByRole('checkbox').count(),8)
    for(const name of['You','Alex Morgan'])for(const kind of['View','Edit']){assert.equal(await check(kind,name).isChecked(),true);assert.equal(await check(kind,name).isDisabled(),true)}
    assert.equal(await check('View','Sam Taylor').isChecked(),true);assert.equal(await check('Edit','Sam Taylor').isChecked(),false)
    assert.equal(await check('View','Jamie Reed').isChecked(),false)
    await check('Edit','Jamie Reed').check();assert.equal(await check('View','Jamie Reed').isChecked(),true)
    await check('View','Jamie Reed').uncheck();assert.equal(await check('Edit','Jamie Reed').isChecked(),false)
    await check('View','Jamie Reed').check()
    await page.screenshot({path:`${output}/${engine}-${mobile?'mobile':'desktop'}-permissions.png`})
    assert.equal(await page.evaluate(()=>window.memberFixture.reads),0)
    await page.evaluate(()=>{window.memberFixture.mode='failed'});await dialog.getByRole('button',{name:'Save participants',exact:true}).click()
    await dialog.getByRole('alert').waitFor();assert.equal(await check('View','Jamie Reed').isChecked(),true)
    await page.evaluate(()=>{window.memberFixture.mode='lost-ack'});await dialog.getByRole('button',{name:'Save participants',exact:true}).click()
    await page.getByText('Synthetic lost acknowledgement',{exact:true}).waitFor();assert.equal(await check('View','Jamie Reed').isChecked(),true)
    await page.evaluate(()=>{window.memberFixture.mode='hold-refresh'});await dialog.getByRole('button',{name:'Save participants',exact:true}).click()
    await page.waitForFunction(()=>Boolean(window.memberFixture.releaseRefresh));assert.equal(await dialog.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true)
    await page.evaluate(()=>{window.memberFixture.mode='normal';window.memberFixture.releaseRefresh()});await dialog.waitFor({state:'detached'})
    const writes=await page.evaluate(()=>window.memberFixture.writes);assert.equal(writes.length,3);assert.deepEqual(writes[1],writes[2])
    assert.deepEqual(writes[2],{relationshipId:'preview-client-0',viewIds:['preview-sam','preview-jamie'],viewOnlyIds:['preview-sam','preview-jamie']})
    await trigger.click();assert.equal(await check('View','Jamie Reed').isChecked(),true)
    await page.evaluate(()=>{window.memberFixture.mode='hold-post'});await dialog.getByRole('button',{name:'Save participants',exact:true}).click()
    await page.waitForFunction(()=>Boolean(window.memberFixture.releasePost));await page.keyboard.press('Escape');await trigger.click()
    await page.evaluate(()=>{window.memberFixture.mode='normal';window.memberFixture.releasePost()});await dialog.getByRole('button',{name:'Save participants',exact:true}).waitFor()
    assert.equal(await dialog.isVisible(),true,'late save cannot close a newer dialog session');await page.keyboard.press('Escape')
    const composer=page.locator('[data-chat-composer]').filter({visible:true})
    await composer.fill('Retained draft')
    await trigger.click()
    await page.evaluate(()=>{window.memberFixture.readOnly=true})
    await dialog.getByRole('button',{name:'Save participants',exact:true}).click()
    await dialog.waitFor({state:'detached'})
    await page.getByRole('textbox',{name:'You have view-only access to this chat',exact:true}).waitFor()
    assert.match(await composer.textContent(),/Retained draft/)
    for(const name of['Send message','Attach image or file','Open sticker tray'])assert.equal(await page.getByRole('button',{name,exact:true}).isDisabled(),true)
    const countBefore=await page.evaluate(()=>window.memberFixture.writeCalls.length)
    await composer.press('Enter');await page.locator('[data-message-interaction] article').last().dispatchEvent('contextmenu',{button:2})
    assert.equal(await page.getByRole('button',{name:'React to message',exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:'Pin message',exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:'Reply',exact:true}).isDisabled(),true)
    assert.equal(await page.getByRole('button',{name:'Copy message',exact:true}).isEnabled(),true)
    await page.keyboard.press('Escape');await trigger.click()
    assert.equal(await dialog.getByRole('button',{name:'Save participants',exact:true}).count(),0)
    for(const checkbox of await dialog.getByRole('checkbox').all())assert.equal(await checkbox.isDisabled(),true)
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.memberFixture.writeCalls.length),countBefore)
    assert.deepEqual(errors,[])
    results.push({engine,mobile,passed:true,checks:['Team button removed','all members shown','fixed seller and manager','View/Edit dependency','no dialog fetch','failure and lost-ack retry','canonical refresh','late save isolation','view-only controls','draft retained','manager-only editing']})
    console.log(`PASS ${engine} ${mobile?'mobile':'desktop'}: ${results.at(-1).checks.join(', ')}`)
   }catch(error){await page.screenshot({path:`${output}/${engine}-${mobile?'mobile':'desktop'}-failure.png`});throw error}
   finally{await context.close()}
  }}finally{await browser.close()}
 }
}finally{server.kill();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2))}
