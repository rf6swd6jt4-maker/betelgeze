// Actual presentation component, synthetic content, and blocked external traffic.
// This checks layout/navigation attributes; physical devices and production are separate.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire, Module } from 'node:module'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import ts from 'typescript'
import { chromium, webkit } from 'playwright'
const engines=process.argv.slice(2)
if(engines.some(engine=>!['chromium','webkit'].includes(engine)))throw Error('Usage: run-whatsapp-template-evidence.mjs [chromium|webkit]')
if(!engines.length)engines.push('chromium','webkit')
const root = process.cwd(), require = createRequire(import.meta.url)
function load(path, dependencies = {}) {
 const filename=resolve(root,path),compiled=new Module(filename)
 compiled.require=name=>name in dependencies?dependencies[name]:require(name)
 compiled._compile(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,filename)
 return compiled.exports
}
const helpers=load('lib/communications/template-evidence.ts')
const {MessageTemplateButtons}=load('components/communications/MessageTemplateButtons.tsx',{'@/lib/communications/template-evidence':helpers})
const token='b'.repeat(64),url=`https://portal.scaylup.com/appointment/${token}?v=4`
const evidence={schemaVersion:1,templateId:'synthetic',templateName:'be_appointment_added',language:'en_US',capturedAt:'2026-10-21T12:00:00Z',buttons:[{index:0,type:'url',label:'View appointment',url}]}
const css=(await postcss([tailwind({base:root,optimize:false})]).process(readFileSync('app/globals.css','utf8'),{from:resolve('app/globals.css')})).css
const server=createServer((request,response)=>{
 if(request.url==='/style.css'){response.writeHead(200,{'Content-Type':'text/css'});response.end(css);return}
 const status=new URL(request.url,'http://127.0.0.1').searchParams.get('status')||'sending'
 const message={status,providerMessageId:status==='sent'?'wamid.synthetic':null,deliveredAt:null,readAt:null}
 const content=React.createElement('main',{className:'min-h-screen bg-neutral-950 p-3 text-white'},React.createElement('article',{className:'ml-auto max-w-[80%] rounded-2xl bg-neutral-100 px-3.5 py-2.5 text-sm text-neutral-950'},React.createElement('p',null,'An appointment has been added to your connected calendar.'),React.createElement(MessageTemplateButtons,{evidence,message})))
 response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'})
 response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body>${renderToStaticMarkup(content)}</body></html>`)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin=`http://127.0.0.1:${server.address().port}`,results=[]
mkdirSync('browser-results/whatsapp-template-evidence',{recursive:true})
try {
 for(const engine of engines){
  const browser=await ({chromium,webkit})[engine].launch()
  try {for(const width of [320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500}),external=[]
   await context.route('**/*',async route=>{
    if(route.request().url().startsWith(origin))return route.continue()
    external.push({url:route.request().url(),referer:route.request().headers().referer})
    await route.fulfill({status:200,contentType:'text/html',body:'<html><body>Synthetic destination</body></html>'})
   })
   const page=await context.newPage(),errors=[]
   page.on('pageerror',error=>errors.push(error.message))
   for(const status of ['sending','sent','send_uncertain','whatsapp_delivered','whatsapp_read','delivery_failed']){
    await page.goto(`${origin}/?status=${status}`)
    const link=page.getByRole('link',{name:/View appointment/})
    await link.waitFor()
    assert.equal(await link.getAttribute('href'),url)
    assert.equal(await link.getAttribute('rel'),'noopener noreferrer')
    assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer')
    assert.equal((await page.locator('main').innerText()).includes(token),false)
    assert.equal(external.length,0,'No eager fetch or prefetch of capability links')
    const box=await link.boundingBox();assert.ok(box.height>=44)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth))
    assert.match(await page.locator('[data-template-buttons]').innerText(),new RegExp(helpers.templateEvidenceState({status,providerMessageId:status==='sent'?'id':null,deliveredAt:null,readAt:null})))
    results.push({engine,width,status,passed:true})
   }
   await page.getByRole('link',{name:/View appointment/}).focus();assert.equal(await linkFocused(page),true)
   const popupPromise=context.waitForEvent('page');await page.keyboard.press('Enter');const popup=await popupPromise
   await popup.waitForLoadState()
   assert.equal(external.length,1);assert.equal(external[0].url,url);assert.equal(external[0].referer,undefined)
   await popup.close();assert.deepEqual(errors,[])
   if(width===390)await page.screenshot({path:`browser-results/whatsapp-template-evidence/${engine}.png`,fullPage:true})
   await context.close()
  }}finally{await browser.close()}
 }
 writeFileSync('browser-results/whatsapp-template-evidence/results.json',JSON.stringify(results,null,2))
 console.log(`PASS WhatsApp evidence: ${results.length} ${engines.join('/')} viewport/status cases; keyboard link retains full target, no referrer or eager network reads.`)
}finally{await new Promise(resolve=>server.close(resolve))}
async function linkFocused(page){return page.getByRole('link',{name:/View appointment/}).evaluate(node=>document.activeElement===node)}
