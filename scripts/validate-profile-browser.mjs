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
const fixture=await mkdtemp(join(tmpdir(),'be-profile-browser-')),output=join(root,'output','profile-devices')
await mkdir(output,{recursive:true});await mkdir(join(fixture,'app','users','jed','security'),{recursive:true})
await symlink(join(root,'node_modules'),join(fixture,'node_modules'))
await writeFile(join(fixture,'package.json'),JSON.stringify({private:true,dependencies:{next:'16.2.11',react:'19.2.4','react-dom':'19.2.4'}}))
await writeFile(join(fixture,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',lib:['dom','esnext'],module:'esnext',moduleResolution:'bundler',jsx:'react-jsx',allowJs:true,skipLibCheck:true,esModuleInterop:true,paths:{'@/*':[root+'/*']}},include:['**/*.tsx']}))
await writeFile(join(fixture,'next.config.js'),`module.exports={webpack(config){config.resolve.alias['@']=${JSON.stringify(root)};return config}}`)
await writeFile(join(fixture,'postcss.config.mjs'),`export default {plugins:{${JSON.stringify(require.resolve('@tailwindcss/postcss'))}:{}}}`)
await writeFile(join(fixture,'app','globals.css'),(await readFile(join(root,'app','globals.css'),'utf8'))+`\n@source "${root}/components";\n@source "${fixture}/app";`)
await writeFile(join(fixture,'app','layout.tsx'),`import './globals.css'; export default function Layout({children}){return <html><body>{children}</body></html>}`)
await writeFile(join(fixture,'app','page.tsx'),`import {ProfileHeader} from '@/components/account/ProfileHeader';import {List,ListItem,ListPrimaryRow,ListSecondaryRow,ListTitle} from '@/components/list/List';export default function Page(){return <main className="min-h-dvh bg-neutral-950 px-5 py-8 text-white sm:px-8"><div className="mx-auto max-w-3xl"><ProfileHeader username="jed" displayName="Jed Ryszczyk"/><section className="mt-10"><h2 className="text-xl font-semibold">Your workspaces</h2><List ariaLabel="Your workspaces"><ListItem><ListPrimaryRow><ListTitle>Betelgeze</ListTitle></ListPrimaryRow><ListSecondaryRow>Owner</ListSecondaryRow></ListItem></List></section></div></main>}`)
await writeFile(join(fixture,'app','users','jed','security','page.tsx'),`import {AccountDevices} from '@/components/account/AccountDevices';import {SecuritySettings} from '@/components/account/SecuritySettings';export default function Page(){return <main className="min-h-dvh bg-neutral-950 px-5 py-8 text-white sm:px-8"><div className="mx-auto max-w-3xl"><a href="/" className="text-sm text-neutral-400">← Back to profile</a><h1 className="mt-7 text-3xl font-semibold">Security</h1><p className="mt-2 text-sm text-neutral-400">Manage your devices, notifications and account security.</p><div className="mt-7"><AccountDevices/><SecuritySettings email="demo@example.test" initialFactors={[{id:'factor',friendlyName:'Authenticator',createdAt:'2026-09-01'}]}/></div></div></main>}`)
const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})}),origin=`http://127.0.0.1:${port}`
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port),'-H','127.0.0.1'],{cwd:fixture,stdio:['ignore','pipe','pipe']})
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d)
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin)).ok){ready=true;break}}catch{};await new Promise(r=>setTimeout(r,500))}assert.ok(ready,logs.slice(-2000))
 const results=[]
 for(const [engine,type,path] of [['chromium',chromium,process.env.CHROMIUM_EXECUTABLE],['webkit',webkit,process.env.WEBKIT_EXECUTABLE]]){
 const browser=await type.launch({headless:true,executablePath:path})
 try{for(const width of [1280,390,320]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 let enabled=false,fail=false,writes=0
 await context.addInitScript(()=>{
   const subscription={endpoint:'https://example.test/push',keys:{p256dh:'public',auth:'auth'},toJSON(){return {endpoint:this.endpoint,keys:this.keys}},async unsubscribe(){return true}}
   Object.defineProperty(window,'Notification',{value:{permission:'granted'},configurable:true})
   Object.defineProperty(window,'PushManager',{value:function(){},configurable:true})
   Object.defineProperty(navigator,'serviceWorker',{value:{async getRegistration(){return {pushManager:{async getSubscription(){return subscription},async subscribe(){return subscription}}}}},configurable:true})
 })
 await context.route('**/api/account/devices',route=>route.fulfill({json:{devices:[{id:'current',platform:'macOS',browser:'Chrome',mobile:false,is_current:true,last_seen_at:'2026-09-17T19:00:00Z',notifications_enabled:enabled},{id:'phone',platform:'iPhone',browser:'Safari',mobile:true,is_current:false,last_seen_at:'2026-09-17T17:30:00Z',notifications_enabled:true},{id:'android',platform:'Android',browser:'Chrome',mobile:true,is_current:false,last_seen_at:'2026-09-16T12:00:00Z',notifications_enabled:false}]}}))
 await context.route('**/api/push/subscriptions',async route=>{
  const method=route.request().method();if(method==='POST'||method==='DELETE'){writes++;if(fail)return route.fulfill({status:503,json:{error:'Could not save this device.'}});enabled=method==='POST';return route.fulfill({json:{subscribed:enabled}})}
  const fingerprint=await page.evaluate(async()=>{const bytes=new TextEncoder().encode(JSON.stringify(['https://example.test/push','public','auth']));const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')})
  return route.fulfill({json:{configured:true,publicKey:'aGVsbG8',subscribed:enabled,fingerprint}})
 })
 await page.goto(origin);const header=page.locator('header'),box=await header.boundingBox(),avatar=await page.getByLabel('Jed Ryszczyk profile picture').boundingBox();assert.ok(Math.abs(avatar.x+avatar.width/2-box.x-box.width/2)<1)
 await page.getByRole('button',{name:'Profile options'}).click();await page.getByRole('menu').waitFor();const menu=await page.getByRole('menu').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=width)
 await page.waitForTimeout(180);await page.screenshot({path:join(output,`${engine}-${width}-profile.png`),fullPage:true})
 await page.getByRole('menuitem',{name:'Security',exact:true}).click();const current=page.getByRole('switch',{name:'Chat notifications on this device',exact:true});await current.waitFor();await page.getByText('Disabled',{exact:true}).first().waitFor()
 assert.equal(await page.getByRole('switch').count(),3);assert.equal(await page.getByRole('switch').nth(1).isDisabled(),true);assert.equal(await page.getByRole('switch').nth(1).getAttribute('aria-checked'),'true');assert.equal(await page.getByRole('switch').nth(2).getAttribute('aria-checked'),'false')
 await current.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Chat notifications on this device"]')?.getAttribute('aria-checked')==='true');assert.equal(writes,1)
 fail=true;await current.click();await page.getByText('Could not save this device.',{exact:true}).waitFor();assert.equal(await current.getAttribute('aria-checked'),'true','failed off must retain enabled state')
 fail=false;await current.click();await page.waitForFunction(()=>document.querySelector('[aria-label="Chat notifications on this device"]')?.getAttribute('aria-checked')==='false');assert.equal(writes,3)
 await page.waitForTimeout(200)
 for(const button of await page.getByRole('switch').all()){
 const sizes=await button.evaluate(el=>{const track=el.firstElementChild.getBoundingClientRect(),knob=el.firstElementChild.firstElementChild.getBoundingClientRect(),button=el.getBoundingClientRect();return {track:{x:track.x,y:track.y,w:track.width,h:track.height},knob:{x:knob.x,y:knob.y,w:knob.width,h:knob.height},button:{w:button.width,h:button.height}}});assert.ok(Math.abs((sizes.track.y+sizes.track.h/2)-(sizes.knob.y+sizes.knob.h/2))<1);assert.equal(sizes.knob.w,sizes.knob.h);assert.ok(sizes.button.h>=44)
 }
 for(const card of await page.locator('article').all()){const b=await card.boundingBox();assert.ok(b.width>b.height,`card proportions ${b.width}x${b.height}`)}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[])
 await page.screenshot({path:join(output,`${engine}-${width}-security.png`),fullPage:true});results.push({engine,width,passed:true,writes});await context.close()
 }}finally{await browser.close()}
 }
 await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results))
}finally{server.kill('SIGTERM');await writeFile(join(output,'server.log'),logs)}
