import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
const root=dirname(dirname(fileURLToPath(import.meta.url)))
const require=createRequire(join(root,'package.json'))
const browserRoot=process.env.BE_BROWSER_TEST_ROOT
const {chromium,webkit}=require(require.resolve('playwright',{paths:browserRoot?[browserRoot]:[root]}))
const fixture=await mkdtemp(join(tmpdir(),'be-alerts-browser-'))
const output=process.env.BE_ALERTS_OUTPUT??join(root,'output','app-alerts-2026-09-17')
await mkdir(output,{recursive:true});await mkdir(join(fixture,'app','reader'),{recursive:true})
for(const [from,to] of [['host.tsx.fixture','app/page.tsx'],['reader.tsx.fixture','app/reader/page.tsx'],['layout.tsx.fixture','app/layout.tsx']])await writeFile(join(fixture,to),await readFile(join(root,'tests','fixtures','app-alerts',from)))
await symlink(join(root,'node_modules'),join(fixture,'node_modules'))
await writeFile(join(fixture,'package.json'),JSON.stringify({name:'alerts-browser-fixture',private:true,dependencies:{next:'16.2.11',react:'19.2.4','react-dom':'19.2.4'}}))
await writeFile(join(fixture,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',lib:['dom','esnext'],module:'esnext',moduleResolution:'bundler',jsx:'react-jsx',allowJs:true,skipLibCheck:true,esModuleInterop:true,paths:{'@/*':[root+'/*']}},include:['**/*.tsx']}))
await writeFile(join(fixture,'next.config.js'),`module.exports={webpack(config){config.resolve.alias['@']=${JSON.stringify(root)};return config}}`)
const port=await new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})})
const origin=`http://127.0.0.1:${port}/`
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','-p',String(port),'-H','127.0.0.1'],{cwd:fixture,stdio:['ignore','pipe','pipe']})
let logs='';server.stdout.on('data',data=>{logs+=data});server.stderr.on('data',data=>{logs+=data})
try {
 let ready=false
 for(let n=0;n<120;n++) {try{const response=await fetch(origin);if(response.ok){ready=true;break}}catch{};await new Promise(resolve=>setTimeout(resolve,500))}
 if(!ready)throw new Error('Browser fixture could not start: '+logs.slice(-3000))
const results=[];for(const [engine,type,executablePath] of [['chromium',chromium,process.env.CHROMIUM_EXECUTABLE],['webkit',webkit,process.env.WEBKIT_EXECUTABLE]]){
 const browser=await type.launch({headless:true,executablePath});
 try{for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
 const context=await browser.newContext({viewport});
 // WebKit's automation protocol omits Blob beacon bodies. Preserve the exact
 // application payload through an intercepted fetch for deterministic checks.
 await context.addInitScript(()=>{navigator.sendBeacon=(url,body)=>{Promise.resolve(body instanceof Blob?body.text():String(body)).then(payload=>fetch(String(url),{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true})).catch(()=>undefined);return true}});
 const page=await context.newPage();const reads=[],activities=[],errors=[];let fail=false;
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/api/communications/activity',route=>{activities.push(route.request().postDataJSON()??JSON.parse(route.request().postData()||'{}'));return route.fulfill({json:{applied:true}})});
 await context.route('**/communications/native/read',route=>{const input=route.request().postDataJSON();reads.push(input);const n=Number(input.messageId.slice(-12));return route.fulfill({status:fail?503:200,json:fail?{error:'offline'}:{cursor:{conversationId:input.conversationId,userId:'u',lastReadMessageId:input.messageId,lastReadAt:new Date(Date.UTC(2026,8,17,10,0,n)).toISOString()}}})});
 await page.goto(origin);await page.bringToFront();const frame=page.frameLocator('iframe');await frame.locator('#unread').filter({hasText:/^0$/}).waitFor({timeout:30000});
 const zero=async()=>{try{await frame.locator('#unread').filter({hasText:/^0$/}).waitFor({timeout:5000})}catch(e){console.log(JSON.stringify({engine,reads,activities:activities.slice(-4),debug:await page.frames()[1].evaluate(()=>{const pane=document.querySelector('[data-message-pane]'),row=pane.querySelector('[data-message-interaction]:last-child'),r=row.getBoundingClientRect(),p=pane.getBoundingClientRect(),f=window.frameElement.getBoundingClientRect();return {focus:window.top.document.hasFocus(),visible:document.visibilityState,active:window.top.document.body.dataset.workspaceActiveTabId,unread:document.querySelector('#unread').textContent,error:document.querySelector('#error').textContent,scrollTop:pane.scrollTop,clientHeight:pane.clientHeight,scrollHeight:pane.scrollHeight,positioned:pane.dataset.positioned,row:{top:r.top,bottom:r.bottom},pane:{top:p.top,bottom:p.bottom},localHit:document.elementFromPoint((r.left+r.right)/2,r.bottom-2)?.outerHTML.slice(0,150),hostHit:window.top.document.elementFromPoint(f.left+(r.left+r.right)/2,f.top+r.bottom-2)?.outerHTML.slice(0,150)}})}));throw e}};
 const initial=reads.length;assert.ok(initial>0);
 // Scroll up as a real wheel interaction. Following must stop before arrival.
 await frame.locator('[data-message-pane]').hover();await page.mouse.wheel(0,-650);await page.waitForTimeout(350);
 const prior=reads.length;await frame.locator('#add').evaluate(el=>el.click());await page.waitForTimeout(350);assert.equal(reads.length,prior,'scrolling up must retain unread');assert.equal(await frame.locator('#unread').textContent(),'1');assert.equal(activities.at(-1).active,false);
 // Scroll down to actually see the newly arrived message.
 await frame.locator('[data-message-pane]').hover();await page.mouse.wheel(0,2500);await zero();
 // A hidden resident iframe must neither save reads nor advertise reading.
 await page.locator('#switch').click();const hiddenReads=reads.length;await page.frames()[1].evaluate(()=>window.addMessage());await page.waitForTimeout(300);assert.equal(reads.length,hiddenReads);assert.equal(activities.at(-1).active,false);
 await page.locator('#switch').click();await zero();
 // A shell viewer covering the iframe must block reading until dismissed.
 await page.locator('#cover').click();const coveredReads=reads.length;await page.frames()[1].evaluate(()=>window.addMessage());await page.waitForTimeout(300);assert.equal(reads.length,coveredReads);assert.equal(activities.at(-1).active,false);
 await page.locator('#uncover').click();await zero();
 // Failed persistence must retain both badge and recoverable intent.
 fail=true;await frame.locator('#add').click();await frame.locator('#error').filter({hasText:/could not be saved/}).waitFor({timeout:5000});assert.equal(await frame.locator('#unread').textContent(),'1');
 fail=false;await page.frames()[1].evaluate(()=>window.dispatchEvent(new Event('online')));await zero();
 assert.deepEqual(errors,[]);results.push({engine,viewport,passed:true,readRequests:reads.length,activityRequests:activities.length});console.log(JSON.stringify(results.at(-1)));await context.close();
 }}finally{await browser.close()}
}await writeFile(join(output,'browser-results.json'),JSON.stringify(results,null,2))
} finally {server.kill('SIGTERM');await writeFile(join(output,'fixture-server.log'),logs)}
