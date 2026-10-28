// Actual Team workspace + member editor, synthetic transport only.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright'

const output = process.env.CLIENT_CHAT_MEMBERS_OUTPUT ?? join(tmpdir(),'client-chat-team-members-browser')
const engines=process.argv.slice(2)
if(engines.some(engine=>!['chromium','webkit'].includes(engine)))throw Error('Use chromium or webkit')
await mkdir(output,{recursive:true})
const server = spawn(process.execPath,['scripts/serve-fullscreen-comms-preview.mjs','--host','127.0.0.1','--port','0'],{stdio:['ignore','pipe','pipe']})
const origin = await new Promise((resolve,reject) => {
    let log=''
    const timer=setTimeout(()=>reject(Error(`Preview startup timeout: ${log}`)),90_000)
    const receive=chunk=>{log=(log+chunk).slice(-12000);const match=log.match(/http:\/\/localhost:(\d+)\//);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`)}}
    server.stdout.on('data',receive);server.stderr.on('data',receive)
    server.once('exit',code=>{clearTimeout(timer);reject(Error(`Preview exited ${code}: ${log}`))})
})
const results=[]
try {
    for (const [engine,driver] of Object.entries({chromium,webkit})) {
        if(engines.length&&!engines.includes(engine))continue
        const browser=await driver.launch()
        try {
            for(const mobile of [false,true]) {
                const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},hasTouch:mobile,isMobile:mobile})
                const errors=[]
                await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort())
                const page=await context.newPage()
                page.on('pageerror',error=>errors.push(error.message))
                await page.goto(`${origin}/?client-team-members`)
                await page.getByText('Project team',{exact:true}).click()
                if(mobile)await page.waitForFunction(()=>document.querySelector('[data-mobile-conversation-surface]:not([hidden])')?.dataset.phase==='open')
                await page.evaluate(()=>{
                    const original=window.fetch
                    window.memberFixture={reads:0,writes:[],members:['preview-you','preview-alex'],mode:'normal'}
                    window.fetch=async(input,options={})=>{
                        if(!String(input).includes('/communications/participants'))return original(input,options)
                        const state=window.memberFixture
                        const snapshot=()=>({relationshipId:'preview-client-0',title:'Northstar Studio',memberIds:[...state.members],eligibleIds:['preview-sam','preview-jamie']})
                        const json=(value,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}))
                        if(options.method==='POST'){
                            const body=JSON.parse(options.body);state.writes.push(body)
                            state.members=[...new Set([...state.members,...body.userIds])]
                            if(state.mode==='lost-ack'){state.mode='normal';throw new TypeError('Network connection lost')}
                            return json(snapshot())
                        }
                        state.reads++
                        if(state.mode==='denied')return json({error:'Only this client’s assigned manager can add people to Client chat'},403)
                        if(state.mode==='delay')return new Promise(resolve=>{state.release=()=>resolve(new Response(JSON.stringify(snapshot())));options.signal.addEventListener('abort',()=>{state.aborted=true})})
                        return json(snapshot())
                    }
                })
                const trigger=page.getByRole('button',{name:'View Project team members',exact:true})
                const dialog=page.getByRole('dialog',{name:'Project team',exact:true})
                await trigger.click()
                assert.equal(await page.evaluate(()=>window.memberFixture.reads),0,'opening the existing Team roster adds no request')
                await dialog.getByRole('button',{name:'Add to Client chat',exact:true}).click()
                await dialog.getByRole('button',{name:'Add selected members',exact:true}).waitFor()
                assert.equal(await page.evaluate(()=>window.memberFixture.reads),1)
                assert.equal(await dialog.getByRole('checkbox').count(),2)
                assert.equal(await dialog.getByRole('button',{name:'Add selected members',exact:true}).isDisabled(),true)
                assert.match(await dialog.textContent(),/can read Northstar Studio’s Client chat history and message the client/)
                await dialog.getByRole('checkbox').first().check()
                await page.evaluate(()=>{window.memberFixture.mode='lost-ack'})
                await dialog.getByRole('button',{name:'Add selected members',exact:true}).click()
                await dialog.getByRole('alert').waitFor()
                assert.equal(await dialog.getByRole('checkbox').first().isChecked(),true,'uncertain write retains selection for safe retry')
                await dialog.getByRole('button',{name:'Add selected members',exact:true}).click()
                await dialog.getByRole('status').waitFor()
                const state=await page.evaluate(()=>window.memberFixture)
                assert.equal(state.writes.length,2)
                assert.deepEqual(state.writes[0],state.writes[1])
                assert.equal(state.members.length,3)
                assert.ok(state.members.includes('preview-alex'),'existing participant retained')
                assert.equal(await dialog.getByRole('checkbox').count(),1)
                await page.screenshot({path:`${output}/${engine}-${mobile?'mobile':'desktop'}-saved.png`})
                await page.keyboard.press('Escape')
                await dialog.waitFor({state:'detached'})

                await page.evaluate(()=>{window.memberFixture.mode='denied'})
                await trigger.click()
                await dialog.getByRole('button',{name:'Add to Client chat',exact:true}).click()
                await dialog.getByRole('alert').waitFor()
                assert.equal(await dialog.getByRole('checkbox').count(),0)
                assert.equal(await page.evaluate(()=>window.memberFixture.writes.length),2)
                await dialog.getByRole('button',{name:'Close team members',exact:true}).click()

                await page.evaluate(()=>{window.memberFixture.mode='delay'})
                await trigger.click()
                await dialog.getByRole('button',{name:'Add to Client chat',exact:true}).click()
                await page.waitForFunction(()=>Boolean(window.memberFixture.release))
                await dialog.getByRole('button',{name:'Close team members',exact:true}).click()
                assert.equal(await page.evaluate(()=>window.memberFixture.aborted),true)
                await page.evaluate(()=>{window.memberFixture.release();window.memberFixture.mode='normal'})
                await trigger.click()
                assert.equal(await dialog.getByRole('checkbox').count(),0,'late result cannot repopulate a new roster session')
                await dialog.getByRole('button',{name:'Add to Client chat',exact:true}).waitFor()
                await page.keyboard.press('Escape')

                // The existing Client editor accepts the smaller mutation
                // acknowledgement and still waits for its canonical refresh.
                await page.goto(origin)
                await page.getByRole('tab',{name:'Clients',exact:true}).click()
                await page.getByText('Northstar Studio',{exact:true}).click()
                if(mobile)await page.waitForFunction(()=>document.querySelector('[data-mobile-conversation-surface]:not([hidden])')?.dataset.phase==='open')
                await page.evaluate(()=>{
                    const original=window.fetch
                    window.clientSaveFixture={writes:0,refreshes:0}
                    window.fetch=(input,options={})=>{
                        if(String(input).includes('/communications/participants')&&options.method==='POST'){
                            window.clientSaveFixture.writes++
                            return Promise.resolve(new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json'}}))
                        }
                        if(String(input).includes('/communications/sync')){
                            window.clientSaveFixture.refreshes++
                            return new Promise(resolve=>{window.clientSaveFixture.release=()=>resolve(original(input,options))})
                        }
                        return original(input,options)
                    }
                })
                await page.getByRole('button',{name:'Client conversation participants',exact:true}).click()
                const clientDialog=page.getByRole('dialog',{name:'Client conversation',exact:true})
                await clientDialog.getByRole('button',{name:'Save participants',exact:true}).click()
                await page.waitForFunction(()=>Boolean(window.clientSaveFixture.release))
                assert.equal(await clientDialog.isVisible(),true,'save acknowledgement does not skip the existing refresh')
                await page.evaluate(()=>window.clientSaveFixture.release())
                await clientDialog.waitFor({state:'detached'})
                assert.deepEqual(await page.evaluate(()=>({writes:window.clientSaveFixture.writes,refreshes:window.clientSaveFixture.refreshes})),{writes:1,refreshes:1})
                assert.deepEqual(errors,[])
                results.push({engine,mobile,passed:true,checks:['on-demand read','disclosure','selection','lost acknowledgement and retry','existing membership','denied manager','close cancellation','late-response isolation','Client save acknowledgement and refresh']})
                console.log(`PASS ${engine} ${mobile?'mobile':'desktop'}: ${results.at(-1).checks.join(', ')}`)
                await context.close()
            }
        } finally {await browser.close()}
    }
} finally {server.kill();await writeFile(`${output}/results.json`,JSON.stringify(results,null,2))}
