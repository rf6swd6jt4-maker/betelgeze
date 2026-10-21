import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtemp,mkdir,readFile,writeFile,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
const root=dirname(dirname(fileURLToPath(import.meta.url))), require=createRequire(join(root,'package.json'))
const {chromium,webkit}=require(require.resolve('playwright',{paths:[process.env.BE_BROWSER_TEST_ROOT??join(root,'scripts','browser')]}))
const requestedEngine=process.argv[2]
assert.ok(!requestedEngine||['chromium','webkit'].includes(requestedEngine),'Expected chromium or webkit')
const fixture=await mkdtemp(join(tmpdir(),'be-windsor-browser-')),output=process.env.BE_WINDSOR_BROWSER_OUTPUT??join(tmpdir(),'be-windsor-onboarding-results')
await mkdir(output,{recursive:true});await mkdir(join(fixture,'app'),{recursive:true})
await symlink(join(root,'node_modules'),join(fixture,'node_modules'))
await writeFile(join(fixture,'package.json'),JSON.stringify({private:true,dependencies:{next:'16.2.11',react:'19.2.4','react-dom':'19.2.4'}}))
await writeFile(join(fixture,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',lib:['dom','esnext'],module:'esnext',moduleResolution:'bundler',jsx:'react-jsx',allowJs:true,skipLibCheck:true,esModuleInterop:true,paths:{'@/*':[root+'/*']}},include:['**/*.tsx']}))
await writeFile(join(fixture,'next.config.js'),`module.exports={onDemandEntries:{pagesBufferLength:3},webpack(config){config.resolve.alias['@']=${JSON.stringify(root)};return config}}`)
await writeFile(join(fixture,'postcss.config.mjs'),`export default {plugins:{${JSON.stringify(require.resolve('@tailwindcss/postcss'))}:{}}}`)
await writeFile(join(fixture,'app','globals.css'),(await readFile(join(root,'app','globals.css'),'utf8'))+`\n@source "${root}/components";\n@source "${fixture}/app";`)
await writeFile(join(fixture,'app','layout.tsx'),`import './globals.css'; export default function Layout({children}){return <html><body>{children}</body></html>}`)
await writeFile(join(fixture,'app','page.tsx'),`"use client";import {useState} from 'react';import {WindsorMetaAdsConnectionBlock} from '@/components/onboarding/WindsorMetaAdsConnectionBlock';export default function Page(){const [satisfied,setSatisfied]=useState(false);return <main style={{'--onboarding-primary':'#1e3a5f','--onboarding-page':'#faf9f6','--onboarding-surface':'white','--onboarding-text':'#102035','--onboarding-muted':'#475569',padding:20,maxWidth:760,margin:'auto',background:'white'}}><WindsorMetaAdsConnectionBlock block={{id:'block',kind:'connection',provider:'meta_ads',label:'Connect Meta Ads'}} token="fixture" sessionBlockId="00000000-0000-0000-0000-000000000001" locked={false} preview={false} satisfied={satisfied} onSatisfied={()=>setSatisfied(true)} onUnsatisfied={()=>setSatisfied(false)}/><p data-testid="requirement">{satisfied?'Requirement complete':'Requirement pending'}</p></main>}`)
await mkdir(join(fixture,'app','maintenance'),{recursive:true});await mkdir(join(fixture,'app','report'),{recursive:true})
await writeFile(join(fixture,'app','maintenance','page.tsx'),`"use client";import {useState} from 'react';import {MetaReportingDialog} from '@/components/client-connections/MetaReportingDialog';export default function Page(){const [open,setOpen]=useState(false);return <main><button onClick={()=>setOpen(true)}>Open reporting settings</button>{open?<MetaReportingDialog workspaceSlug="fixture" relationshipId="00000000-0000-4000-8000-000000000020" clientName="Fixture client" onClose={()=>setOpen(false)}/>:null}</main>}`)
await writeFile(join(fixture,'app','report','page.tsx'),`"use client";import {useState} from 'react';import {ClientPortalMetaAds} from '@/components/client-portal/ClientPortalMetaAds';export default function Page(){const [active,setActive]=useState(false);return <main style={{padding:20,background:'white',color:'#102035'}}><button onClick={()=>setActive(!active)}>{active?'Hide report':'Open report'}</button><div style={{display:active?'block':'none'}}><ClientPortalMetaAds token="fixture" reporting={{accountId:'one',accountName:'Test Ads'}} active={active}/></div></main>}`)
const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})}),origin=`http://127.0.0.1:${port}`
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port),'-H','127.0.0.1'],{cwd:fixture,stdio:['ignore','pipe','pipe']})
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d)
const pending={status:'pending',accountId:null,accountName:null,datasource:null,connectedAt:null}
const connected={status:'connected',accountId:'one',accountName:'Test Ads',datasource:'facebook_ads',connectedAt:'2026-09-17'}
const accounts=[{id:'one',name:'Test Ads',datasource:'facebook_ads'},{id:'two',name:'Second',datasource:'facebook_ads'}]
const report={accountId:'one',accountName:'Test Ads',period:'last_30d',dateFrom:'2026-09-22',dateTo:'2026-10-21',currency:'USD',fetchedAt:'2026-10-21T20:00:00Z',totals:{spend:12,impressions:100,clicks:4,leads:0,ctr:4,cpc:3,costPerLead:null},daily:[]}
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin)).ok){ready=true;break}}catch{};await new Promise(r=>setTimeout(r,500))}assert.ok(ready,logs.slice(-3000))
 // Compile and retain all three fixture routes before a browser subscribes to HMR.
 // First-route compilation can otherwise force a reload of the onboarding page
 // while WebKit is navigating to maintenance. Drain each HTML response to finish
 // its compilation/render boundary; keep navigation failures visible below.
 for(const path of ['/maintenance','/report','/']){
  const response=await fetch(origin+path);await response.text();assert.ok(response.ok,`Fixture route ${path} failed to compile: ${response.status}`)
 }
 const results=[]
 for(const [engine,type] of [['chromium',chromium],['webkit',webkit]].filter(([name])=>!requestedEngine||name===requestedEngine)){
 const browser=await type.launch({headless:true,executablePath:engine==='chromium'?process.env.CHROMIUM_EXECUTABLE:process.env.WEBKIT_EXECUTABLE})
 try{for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 let mode='new',posts=0,starts=0,gets=0,lastSelection=null
 await context.route('**/windsor-meta-ads/start?*',route=>{starts++;return route.fulfill({contentType:'text/html',body:'<h1>Windsor fixture</h1><p>Select account and Finish</p>'})})
 await context.route('**/windsor-meta-ads?*',async route=>{
  if(route.request().method()==='GET'){gets++;return route.fulfill({json:{ok:true,connection:mode==='restore'?pending:null,satisfied:false}})}
  posts++
  if(mode==='fail')return route.fulfill({status:503,json:{ok:false,error:'Provider unavailable. Please try again.'}})
  const params=new URL(route.request().url()).searchParams
  lastSelection={account:params.get('account'),confirmed:params.get('confirm')==='true'}
  const offered=mode==='multiple'?accounts:[accounts[0]]
  if(mode==='new'&&posts===1)return route.fulfill({json:{ok:true,connection:pending,accounts:[],satisfied:false}})
  const chosen=offered.find(a=>a.id===params.get('account'))
  if(params.get('confirm')==='true'&&chosen){
   if(mode==='confirmation-fail')return route.fulfill({status:503,json:{ok:false,error:'Confirmation unavailable. Please try again.'}})
   return route.fulfill({json:{ok:true,connection:{...connected,accountId:chosen.id,accountName:chosen.name},accounts:[],satisfied:true}})
  }
  return route.fulfill({json:{ok:true,connection:pending,accounts:offered,satisfied:false,...(chosen?{preview:{account:chosen,report:{...report,accountId:chosen.id,accountName:chosen.name}}}:{})}})
 })
 await context.route('**/*',route=>{const host=new URL(route.request().url()).hostname;return host==='127.0.0.1'||host==='localhost'?route.fallback():route.abort('blockedbyclient')})
 async function confirmAccount(name){await page.getByRole('button',{name:'Advertising account',exact:true}).click();await page.getByRole('option',{name}).click();await page.getByText('No activity can be valid.',{exact:false}).waitFor();assert.equal(await page.getByTestId('requirement').textContent(),'Requirement pending');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm reporting account',exact:true}).click();await page.getByTestId('requirement').filter({hasText:'Requirement complete'}).waitFor()}
 await page.goto(origin);await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('button')?.disabled)
 assert.equal(posts,0);assert.equal(await page.getByRole('button',{name:/Open secure connection|Check connection/}).count(),0)
 const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).click();const popup=await popupPromise;await popup.getByRole('heading',{name:'Windsor fixture'}).waitFor();assert.equal(starts,1)
 assert.equal(await popup.evaluate(()=>window.opener===null),true)
 await popup.close();await page.bringToFront();await confirmAccount('Test Ads · one');assert.ok(posts>=4&&posts<=5,`bounded verification requests: ${posts}`)
 await page.screenshot({path:join(output,`${engine}-${width}-connected.png`)})
 const completedPosts=posts;await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))});await page.waitForTimeout(300);assert.equal(posts,completedPosts)
 mode='restore';posts=0;await page.reload();await confirmAccount('Test Ads · one');assert.equal(posts,3)
 mode='fail';posts=0;await page.reload();await page.waitForFunction(()=>!document.querySelector('button')?.disabled)
 const failPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).click();const failPopup=await failPopupPromise;await failPopup.getByRole('heading',{name:'Windsor fixture'}).waitFor();await failPopup.close();await page.bringToFront();await page.getByRole('alert').filter({hasText:'Provider unavailable. Please try again.'}).waitFor();await page.getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal(await page.getByText('Requirement complete').count(),0)
 await page.screenshot({path:join(output,`${engine}-${width}-failure.png`)})
 mode='multiple';posts=0;await page.reload();await page.waitForFunction(()=>!document.querySelector('button')?.disabled)
 const multiPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).click();const multiPopup=await multiPopupPromise;await multiPopup.getByRole('heading',{name:'Windsor fixture'}).waitFor();await multiPopup.close();await page.bringToFront();await confirmAccount('Second · two');assert.equal(posts,3)
 mode='confirmation-fail';posts=0;await page.reload();await page.waitForFunction(()=>!document.querySelector('button')?.disabled)
 const confirmPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Connect Meta Ads',exact:true}).click();const confirmPopup=await confirmPopupPromise;await confirmPopup.getByRole('heading',{name:'Windsor fixture'}).waitFor();await confirmPopup.close();await page.bringToFront()
 await page.getByRole('button',{name:'Advertising account',exact:true}).click();await page.getByRole('option',{name:'Test Ads · one'}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Confirm reporting account',exact:true}).click();await page.getByRole('alert').filter({hasText:'Confirmation unavailable.'}).waitFor()
 const retryPopupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Start a new connection',exact:true}).click();const retryPopup=await retryPopupPromise;await retryPopup.getByRole('heading',{name:'Windsor fixture'}).waitFor();await retryPopup.close();await page.bringToFront();await page.getByRole('button',{name:'Advertising account',exact:true}).waitFor()
 assert.deepEqual(lastSelection,{account:null,confirmed:false});assert.equal(await page.getByRole('button',{name:'Confirm reporting account',exact:true}).count(),0);assert.equal(await page.getByTestId('requirement').textContent(),'Requirement pending')
 let maintenanceSaved=false,maintenancePosts=0
 const candidateId='00000000-0000-4000-8000-000000000050'
 const maintenanceState=()=>({connection:{revision:'00000000-0000-4000-8000-000000000040',accountId:maintenanceSaved?'two':'old',accountName:maintenanceSaved?'Second':'Previous account',status:'connected',verifiedAt:maintenanceSaved?'2026-10-21T20:00:00Z':null,lastReportAt:maintenanceSaved?'2026-10-21T20:00:00Z':null,lastError:null,canReuseAuthorization:true},candidateId:maintenanceSaved?null:candidateId,history:maintenanceSaved?[{id:candidateId,account_id:'two',account_name:'Second',created_at:'2026-10-21T20:00:00Z',previous_account_id:'old',previous_account_name:'Previous account'}]:[]})
 await context.route('**/client-connections/meta-ads*',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:maintenanceState()})
  maintenancePosts++;const body=route.request().postDataJSON()
  if(body.action==='begin')return route.fulfill({json:{candidateId,authorizationUrl:null}})
  if(body.action==='accounts')return route.fulfill({json:{accounts}})
  if(body.action==='preview')return route.fulfill({json:{account:accounts[1],report:{...report,accountId:'two',accountName:'Second'}}})
  if(body.action==='commit'){assert.equal(body.confirmed,true);assert.equal(body.expectedRevision,'00000000-0000-4000-8000-000000000040');maintenanceSaved=true;return route.abort('failed')}
  return route.fulfill({status:400,json:{error:'Unexpected action'}})
 })
 await page.goto(origin+'/maintenance');await page.getByRole('button',{name:'Open reporting settings',exact:true}).click();await page.getByText('Account verification needed',{exact:true}).waitFor();assert.equal(maintenancePosts,0)
 await page.getByRole('button',{name:'Review authorized accounts',exact:true}).click();await page.getByRole('button',{name:'Load authorized accounts',exact:true}).click()
 await page.getByRole('button',{name:'Advertising account',exact:true}).click();await page.getByRole('option',{name:'Second · two'}).click();await page.getByRole('button',{name:'Preview report',exact:true}).click()
 await page.getByText('A valid report can contain no activity.',{exact:false}).waitFor();assert.equal(maintenanceSaved,false);assert.equal(await page.getByRole('button',{name:'Save reporting account',exact:true}).isDisabled(),true)
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save reporting account',exact:true}).click();await page.getByText('The reporting account was saved.',{exact:false}).waitFor();assert.equal(maintenancePosts,4)
 assert.equal(await page.getByRole('button',{name:'Preview report',exact:true}).count(),0)
 await page.screenshot({path:join(output,`${engine}-${width}-maintenance-reconciled.png`)})
 let reportGets=0,reportPosts=0
 await context.route('**/api/client-portal/session/fixture/meta-ads',route=>{
  if(route.request().method()==='GET'){reportGets++;return route.fulfill({json:{report:{...report,freshness:reportPosts>=2?'current':'stale',warning:reportPosts>=2?null:'Stored report needs refreshing.'}}})}
  reportPosts++;return reportPosts===1?route.fulfill({status:503,json:{error:'Provider unavailable'}}):route.fulfill({json:{report:{...report,freshness:'current',totals:{...report.totals,spend:25}}}})
 })
 await page.goto(origin+'/report');await page.waitForTimeout(200);assert.equal(reportGets,0);assert.equal(reportPosts,0)
 await page.getByRole('button',{name:'Open report',exact:true}).click();await page.getByText('The previous figures are retained below.',{exact:false}).waitFor();assert.equal(reportGets,1);assert.equal(reportPosts,1)
 await page.getByRole('button',{name:'Refresh report',exact:true}).click();await page.getByText(await page.evaluate(()=>new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}).format(25)),{exact:true}).first().waitFor();assert.equal(reportPosts,2)
 await page.screenshot({path:join(output,`${engine}-${width}-report-recovered.png`)})
 await page.getByRole('button',{name:'Hide report',exact:true}).click();await page.waitForTimeout(200);assert.equal(reportPosts,2)
 const reopenedReport=page.waitForResponse(response=>response.url().endsWith('/meta-ads')&&response.request().method()==='GET');await page.getByRole('button',{name:'Open report',exact:true}).click();await reopenedReport;await page.waitForTimeout(200);assert.equal(reportGets,2);assert.equal(reportPosts,2)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[])
 results.push({engine,width,passed:true,gets});await context.close()
 }}finally{await browser.close()}
 }
 await writeFile(join(output,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results))
}finally{server.kill();await writeFile(join(output,'fixture-server.log'),logs)}
