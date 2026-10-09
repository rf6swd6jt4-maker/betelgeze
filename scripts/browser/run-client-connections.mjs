import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
const server=spawn(process.execPath,['scripts/serve-client-connections-fixture.mjs'],{stdio:['ignore','pipe','inherit']})
try {
 const url=await new Promise((resolve,reject)=>{let output='';server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match)resolve(match[0])});server.on('exit',code=>reject(Error(`Fixture exited ${code}`)))})
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await engine.launch()
  try { for(const viewport of [{width:1280,height:900},{width:390,height:844}]) {
   const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',error=>errors.push(String(error)))
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
   await page.goto(url);await page.getByText('Fixture Agency',{exact:false}).waitFor()
   if(viewport.width>500) await page.getByLabel('Synthetic Client – Fixture Business connection actions',{exact:true}).click({button:'right'})
   else await page.getByRole('button',{name:'Actions for'}).click()
   await page.getByRole('menuitem',{name:'Edit connection'}).click()
   await page.getByRole('button',{name:'Load calendars',exact:true}).click()
   await page.getByRole('button',{name:'Save connection'}).waitFor({state:'visible'})
   await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled)
   await page.getByRole('button',{name:'Save connection'}).click()
   await page.waitForFunction(()=>window.savedInput)
   assert.equal(await page.evaluate(()=>window.savedInput.privateToken),false)
   assert.equal(await page.evaluate(()=>window.savedInput.calendarId),'calendar123456789')
   const row=page.getByLabel('Synthetic Client – Fixture Business connection actions',{exact:true})
   await row.focus();await page.keyboard.press('Shift+F10')
   await page.getByRole('menuitem',{name:'Remove connection'}).click()
   await page.getByRole('button',{name:'Cancel',exact:true}).click()
   assert.equal(await page.evaluate(()=>!!window.removed),false)
   await page.getByRole('button',{name:'Actions for'}).click();await page.getByRole('menuitem',{name:'Remove connection'}).click()
   await page.getByRole('button',{name:'Remove connection',exact:true}).click()
   await page.getByText('Waiting for a HighLevel account to be linked').waitFor()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   assert.deepEqual(errors,[])
   console.log(`${name} ${viewport.width}: edit with saved token, calendar discovery/save, right-click/keyboard/mobile actions, cancelled and confirmed removal passed`)
   await page.close()
  }} finally {await browser.close()}
 }
} finally {server.kill('SIGTERM')}
