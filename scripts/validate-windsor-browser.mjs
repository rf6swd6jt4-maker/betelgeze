import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtemp,mkdir,readFile,writeFile,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
const root=dirname(dirname(fileURLToPath(import.meta.url))), require=createRequire(join(root,'package.json'))
const {chromium,webkit}=require(require.resolve('playwright',{paths:[process.env.BE_BROWSER_TEST_ROOT??root]}))
const fixture=await mkdtemp(join(tmpdir(),'be-windsor-browser-')),output=join(root,'output','windsor-onboarding')
await mkdir(output,{recursive:true});await mkdir(join(fixture,'app'),{recursive:true})
await symlink(join(root,'node_modules'),join(fixture,'node_modules'))
await writeFile(join(fixture,'package.json'),JSON.stringify({private:true,dependencies:{next:'16.2.11',react:'19.2.4','react-dom':'19.2.4'}}))
await writeFile(join(fixture,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',lib:['dom','esnext'],module:'esnext',moduleResolution:'bundler',jsx:'react-jsx',allowJs:true,skipLibCheck:true,esModuleInterop:true,paths:{'@/*':[root+'/*']}},include:['**/*.tsx']}))
await writeFile(join(fixture,'next.config.js'),`module.exports={webpack(config){config.resolve.alias['@']=${JSON.stringify(root)};return config}}`)
await writeFile(join(fixture,'postcss.config.mjs'),`export default {plugins:{${JSON.stringify(require.resolve('@tailwindcss/postcss'))}:{}}}`)
await writeFile(join(fixture,'app','globals.css'),(await readFile(join(root,'app','globals.css'),'utf8'))+`\n@source "${root}/components";\n@source "${fixture}/app";`)
await writeFile(join(fixture,'app','layout.tsx'),`import './globals.css'; export default function Layout({children}){return <html><body>{children}</body></html>}`)
await writeFile(join(fixture,'app','page.tsx'),`"use client";import {useState} from 'react';import {WindsorMetaAdsConnectionBlock} from '@/components/onboarding/WindsorMetaAdsConnectionBlock';export default function Page(){const [satisfied,setSatisfied]=useState(false);return <main style={{'--onboarding-primary':'#1e3a5f','--onboarding-page':'#faf9f6','--onboarding-surface':'white','--onboarding-text':'#102035','--onboarding-muted':'#475569',padding:20,maxWidth:760,margin:'auto',background:'white'}}><WindsorMetaAdsConnectionBlock block={{id:'block',kind:'connection',provider:'meta_ads',label:'Connect Meta Ads'}} token="fixture" sessionBlockId="00000000-0000-0000-0000-000000000001" locked={false} preview={false} satisfied={satisfied} onSatisfied={()=>setSatisfied(true)} onUnsatisfied={()=>setSatisfied(false)}/><p data-testid="requirement">{satisfied?'Requirement complete':'Requirement pending'}</p></main>}`)
const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})}),origin=`http://127.0.0.1:${port}`
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port),'-H','127.0.0.1'],{cwd:fixture,stdio:['ignore','pipe','pipe']})
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d)
const pending={status:'pending',accountId:null,accountName:null,datasource:null,connectedAt:null}
const connected={status:'connected',accountId:'1348332320788897',accountName:'Test Ads',datasource:'facebook_ads',connectedAt:'2026-09-17'}
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin)).ok){ready=true;break}}catch{};await new Promise(r=>setTimeout(r,500))}assert.ok(ready,logs.slice(-3000))
 const results=[]
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await type.launch({headless:true,executablePath:engine==='chromium'?process.env.CHROMIUM_EXECUTABLE:process.env.WEBKIT_EXECUTABLE})
 try{for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 let mode='new',posts=0,starts=0,gets=0
 await context.route('**/windsor-meta-ads/start?*',route=>{starts++;return route.fulfill({contentType:'text/html',body:'<h1>Windsor fixture</h1><p>Select account and Finish</p>'})})
 await context.route('**/windsor-meta-ads?*',async route=>{
  if(route.request().method()==='GET'){gets++;return route.fulfill({json:{ok:true,connection:mode==='restore'?pending:null,satisfied:false}})}
  posts++
  if(mode==='fail')return route.fulfill({status:503,json:{ok:false,error:'Provider unavailable. Please try again.'}})
  if(mode==='multiple'&&!new URL(route.request().url()).searchParams.has('account'))return route.fulfill({json:{ok:true,connection:pending,accounts:[{id:'one',name:'First',datasource:'facebook_ads'},{id:'two',name:'Second',datasource:'facebook_ads'}],satisfied:false}})
  await new Promise(r=>setTimeout(r,100))
  return route.fulfill({json:{ok:true,connection:mode==='new'&&posts===1?pending:connected,accounts:[],satisfied:!(mode==='new'&&posts===1)}})
 })
 await page.goto(origin);await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('button')?.disabled)
 assert.equal(posts,0);assert.equal(await page.getByRole('button',{name:/Open secure connection|Check connection/}).count(),0)
 const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).click();const popup=await popupPromise;await popup.getByRole('heading',{name:'Windsor fixture'}).waitFor();assert.equal(starts,1)
 assert.equal(await popup.evaluate(()=>window.opener===null),true)
 await popup.close();await page.bringToFront();await page.getByTestId('requirement').filter({hasText:'Requirement complete'}).waitFor();assert.ok(posts>=2&&posts<=3,`bounded confirmation requests: ${posts}`)
 await page.screenshot({path:join(output,`${engine}-${width}-connected.png`)})
 const completedPosts=posts;await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(300);assert.equal(posts,completedPosts)
 mode='restore';posts=0;await page.reload();await page.getByText('Requirement complete').waitFor();assert.equal(posts,1)
 mode='fail';posts=0;await page.reload();await page.waitForFunction(()=>!document.querySelector('button')?.disabled)
 const failPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).click();const failPopup=await failPopupPromise;await failPopup.getByRole('heading',{name:'Windsor fixture'}).waitFor();await failPopup.close();await page.bringToFront();await page.getByRole('alert').filter({hasText:'Provider unavailable. Please try again.'}).waitFor();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal(await page.getByText('Requirement complete').count(),0)
 await page.screenshot({path:join(output,`${engine}-${width}-failure.png`)})
 mode='multiple';posts=0;await page.reload();await page.waitForFunction(()=>!document.querySelector('button')?.disabled)
 const multiPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).click();const multiPopup=await multiPopupPromise;await multiPopup.getByRole('heading',{name:'Windsor fixture'}).waitFor();await multiPopup.close();await page.bringToFront();await page.getByLabel('Advertising account').selectOption('two');await page.getByText('Requirement complete').waitFor();assert.equal(posts,2)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[])
 results.push({engine,width,passed:true,gets});await context.close()
 }}finally{await browser.close()}
 }
 await writeFile(join(output,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results))
}finally{server.kill();await writeFile(join(output,'fixture-server.log'),logs)}
