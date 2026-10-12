import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
const server=spawn(process.execPath,['scripts/serve-settings-popup-ownership-fixture.mjs'],{stdio:['ignore','pipe','pipe']})
try{
 const origin=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error(log)),60000);const read=chunk=>{log+=chunk;const match=log.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0])}};server.stdout.on('data',read);server.stderr.on('data',read);server.on('exit',()=>{clearTimeout(timer);reject(Error(log))})})
 for(const name of ['chromium','webkit']){
  const browser=await ({chromium,webkit})[name].launch()
  try{for(const width of [320,390,1280]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[],unexpected=[]
   page.on('pageerror',e=>errors.push(e.message))
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==new URL(origin).origin||url.pathname.startsWith('/api/')){unexpected.push(url.href);return route.abort()}return route.continue()})
   await page.goto(`${origin}?type=service&initial=1`)
   await page.getByRole('button',{name:'Retainer',exact:true}).click()
   await page.getByRole('spinbutton',{name:'Additional one-time fee'}).fill('500')
   await page.getByRole('spinbutton',{name:'Recurring price'}).fill('1500')
   const summary=page.getByRole('region',{name:'Default payment breakdown'})
   await summary.getByText('$2,000.00 USD',{exact:true}).waitFor()
   await summary.getByText('$1,500.00 every month',{exact:true}).waitFor()
   await summary.getByText('Additional one-time fee',{exact:true}).waitFor()
   await page.getByRole('spinbutton',{name:'Additional one-time fee'}).fill('0')
   await summary.getByText('$1,500.00 USD',{exact:true}).waitFor()
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[])
   await page.close();console.log(`PASS ${name} catalogue ${width}`)
  }}finally{await browser.close()}
 }
}finally{server.kill()}
