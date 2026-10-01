import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"
const engines=process.argv.slice(2)
if(engines.some(engine=>!["chromium","webkit"].includes(engine)))throw Error("Use chromium and/or webkit")
const output=process.env.LINKED_DETAIL_OUTPUT??"browser-results/linked-detail"
const baseline=process.env.LINKED_DETAIL_EXPECT_FAILURE==="1"
const server=spawn(process.execPath,["scripts/serve-workspace-linked-detail-fixture.mjs"],{stdio:["ignore","pipe","pipe"]})
const observations=[]
await mkdir(output,{recursive:true})
try {
 const origin=await new Promise((resolve,reject)=>{let log="";const timer=setTimeout(()=>reject(Error(`Fixture startup timeout: ${log}`)),90000);const consume=chunk=>{log=(log+chunk).slice(-12000);const match=log.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0])}};server.stdout.on("data",consume);server.stderr.on("data",consume);server.once("error",reject);server.once("exit",code=>reject(Error(`Fixture exit ${code}: ${log}`)))})
 for(const engine of engines.length?engines:["chromium","webkit"]){
  const browser=await({chromium,webkit})[engine].launch({headless:true})
  try{for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
   const context=await browser.newContext({viewport,reducedMotion:"reduce"})
   try{
    const page=await context.newPage(),errors=[],external=[],documents=[],messages=[]
    page.on("pageerror",error=>errors.push(error.message))
    page.on("request",request=>{if(request.isNavigationRequest())documents.push(request.url())})
    await context.route("**/*",route=>{if(new URL(route.request().url()).origin===new URL(origin).origin)return route.continue();external.push(route.request().url());return route.abort()})
    const droppedAcknowledgement=viewport.width>=1024&&!baseline
    await page.addInitScript(drop=>{
      window.fixtureMessages=[];window.fixtureDropRedirectProof=drop;window.fixtureDroppedProofs=0
      window.fixtureDrawerAnimations=[]
      const show=HTMLDialogElement.prototype.show
      HTMLDialogElement.prototype.show=function(){
        const result=show.call(this)
        if(!this.hasAttribute("data-workspace-side-drawer"))return result
        const section=this.querySelector("[data-side-drawer]"),entry={samples:[],completed:false}
        window.fixtureDrawerAnimations.push(entry)
        const sample=()=>{const bounds=section.getBoundingClientRect();entry.samples.push({x:bounds.x,right:bounds.right,width:bounds.width,dialogScrollLeft:this.scrollLeft,rootScrollLeft:document.documentElement.scrollLeft,bodyScrollLeft:document.body.scrollLeft,windowScrollX:scrollX})}
        sample()
        const frame=()=>{if(entry.completed)return;sample();requestAnimationFrame(frame)}
        requestAnimationFrame(frame)
        Promise.allSettled(section.getAnimations().map(animation=>animation.finished)).then(()=>{sample();entry.completed=true})
        return result
      }
      window.addEventListener("message",event=>{
        if(event.origin!==location.origin||event.data?.source!=="betelgeze-workspace-tabs")return
        window.fixtureMessages.push(event.data)
        if(window.parent===window&&window.fixtureDropRedirectProof&&event.data.type==="location-replace"&&event.data.replacedUrl){window.fixtureDroppedProofs++;event.stopImmediatePropagation()}
      })
    },droppedAcknowledgement)
    await page.goto(`${origin}fixture/relationships/10000000-0000-4000-8000-000000000020`)
    await page.frameLocator("iframe").getByText("Relationship ready",{exact:true}).waitFor()
    if(viewport.width<1024){
      if(!baseline)await page.emulateMedia({reducedMotion:"no-preference"})
      await page.getByRole("button",{name:"Show relationship context",exact:true}).click()
      if(!baseline){
        const drawer=page.locator("[data-workspace-side-drawer]")
        await drawer.waitFor({state:"visible"})
        const header=await page.locator("[data-workspace-topbar]").boundingBox()
        const bounds=await drawer.boundingBox()
        assert.ok(Math.abs(bounds.y-header.y-header.height)<2,"right drawer starts below the real shell header")
        assert.ok(bounds.y+bounds.height<=viewport.height+2)
        assert.equal(await page.locator("dialog:modal").count(),0,"shell header remains outside drawer modality")
        assert.equal(await page.locator("[data-workspace-tabbar]").evaluate(element=>element.inert),true)
        assert.equal(await page.locator("[data-workspace-tab-panels]").evaluate(element=>element.inert),true)
        assert.equal(await drawer.locator("[data-side-drawer]").evaluate(element=>getComputedStyle(element).animationName),"betelgeze-drawer-right-in")
        assert.equal(await drawer.locator("[data-side-drawer]").evaluate(element=>getComputedStyle(element).animationDuration),"0.2s")
        await drawer.locator("[data-side-drawer]").evaluate(async element=>{await Promise.allSettled(element.getAnimations().map(animation=>animation.finished))})
        await page.waitForFunction(()=>window.fixtureDrawerAnimations[0]?.completed)
        const entry=await page.evaluate(()=>window.fixtureDrawerAnimations[0])
        assert.ok(entry.samples.every(sample=>sample.dialogScrollLeft===0&&sample.rootScrollLeft===0&&sample.bodyScrollLeft===0&&sample.windowScrollX===0),"autofocus cannot scroll the dialog or page during entry")
        assert.ok(entry.samples.every(sample=>sample.x>=48-1),"entry never translates the section across the left gutter")
        const finalBounds=await drawer.locator("[data-side-drawer]").boundingBox()
        assert.ok(Math.abs(finalBounds.x-48)<1&&Math.abs(finalBounds.x+finalBounds.width-viewport.width)<1,"finished section aligns to the right viewport edge with a48px gutter")
        await page.screenshot({path:`${output}/${engine}-mobile-drawer.png`})
        // A real header action must still work and replace the right companion.
        await page.getByRole("button",{name:"Toggle sidebar",exact:true}).click()
        await drawer.waitFor({state:"detached"})
        assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute("aria-label")),"Toggle sidebar","drawer dismissal preserves header action focus")
        assert.equal(await page.locator("[data-workspace-sidebar]").getAttribute("aria-hidden"),"false")
        assert.equal(await page.locator("[data-workspace-tabbar]").evaluate(element=>element.inert),false)
        await page.getByRole("button",{name:"Toggle sidebar",exact:true}).click()
        await page.emulateMedia({reducedMotion:"reduce"})
        await page.getByRole("button",{name:"Show relationship context",exact:true}).click()
        await drawer.waitFor({state:"visible"})
        assert.equal(await page.locator("[data-workspace-sidebar]").getAttribute("aria-hidden"),"true")
        assert.equal(await drawer.locator("[data-side-drawer]").evaluate(element=>getComputedStyle(element).animationName),"none")
      }
    }
    const clickStarted=Date.now()
    let clickToUsableMs=null
    await page.getByRole("navigation",{name:"Relationship shortcuts"}).getByRole("link",{name:"Onboarding",exact:true}).click()
    if(baseline){
      await page.waitForFunction(()=>[...document.querySelectorAll("iframe")].some(frame=>frame.contentDocument?.documentElement.dataset.proxyShell==="true"&&frame.contentWindow.location.pathname.includes("/onboarding/")))
      assert.equal(await page.getByText("Opening onboarding",{exact:false}).count()>0,true)
    }else{
      await page.frameLocator("iframe:not([hidden])").getByText("Onboarding session ready",{exact:true}).waitFor({timeout:7000})
      if(droppedAcknowledgement){
        await page.waitForFunction(()=>window.fixtureDroppedProofs>0)
        const source=await page.evaluate(()=>{const state=JSON.parse(sessionStorage.getItem("betelgeze:workspace-tabs:fixture"));return state.tabs.find(tab=>tab.id===state.activeId).url})
        assert.ok(!source.includes("session="),"a dropped canonical commit cannot claim ready")
        await page.evaluate(()=>{
          window.fixtureDropRedirectProof=false
          const frame=document.querySelector("iframe:not([hidden])")
          frame.contentWindow.postMessage({source:"betelgeze-workspace-tabs",target:"frame",type:"probe",tabId:new URL(frame.contentWindow.location.href).searchParams.get("__betelgeze_tab")},location.origin)
        })
      }
      await page.waitForFunction(()=>!document.querySelector('[aria-label="Loading onboarding details"]')&&!document.body.textContent.includes("Opening onboarding"))
      const frame=page.frameLocator("iframe:not([hidden])")
      await frame.getByRole("button",{name:"Use detail action",exact:true}).click()
      await frame.getByRole("button",{name:"Detail action used",exact:true}).waitFor()
      clickToUsableMs=Date.now()-clickStarted
      await page.waitForFunction(() => {
        const state=JSON.parse(sessionStorage.getItem("betelgeze:workspace-tabs:fixture")??"null")
        return /onboarding\/[^?]+\?session=/.test(state?.tabs.find(tab=>tab.id===state.activeId)?.url??"")
      })
      if(viewport.width<1024)assert.match(page.url(),/onboarding\/[^?]+\?session=/)
      assert.ok(!page.url().includes("__betelgeze"),"shell address must not contain internal identity")
      const state=await page.locator("iframe:not([hidden])").evaluate(frame=>({url:frame.contentWindow.location.href,name:frame.name,nestedShells:frame.contentDocument.querySelectorAll("[data-workspace-shell-root]").length,history:frame.contentWindow.history.length}))
      assert.equal(state.nestedShells,0)
      assert.ok(state.url.includes("__betelgeze_tab="))
      assert.ok(!state.url.includes("__betelgeze_redirect"),"metadata cleanup must use history replacement without a second read")
      assert.equal(documents.filter(url=>new URL(url).pathname.includes("/onboarding/")).length,2,"one canonical request and its redirect; no reload or repair read")
      assert.equal(await page.locator("[data-workspace-side-drawer]").count(),0)
      assert.equal(await page.locator("[data-workspace-tab-panels]").evaluate(element=>element.inert),false)
      await frame.getByRole("textbox",{name:"Retained local draft"}).fill("Draft survives warm tab return")
      await frame.getByRole("link",{name:"Open relationship in another tab",exact:true}).click()
      await page.frameLocator("iframe:not([hidden])").getByText("Relationship ready",{exact:true}).waitFor()
      assert.equal(await page.getByRole("tab").count(),2,"real bridge record link opens a second shell tab")
      const committedDocuments=documents.length
      await page.getByRole("tab").first().click()
      await page.frameLocator("iframe:not([hidden])").getByRole("button",{name:"Detail action used",exact:true}).waitFor()
      assert.equal(await page.frameLocator("iframe:not([hidden])").getByRole("textbox",{name:"Retained local draft"}).inputValue(),"Draft survives warm tab return")
      assert.equal(documents.length,committedDocuments,"returning to the canonical tab keeps its resident document and draft")
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[])
    messages.push(...await page.evaluate(()=>window.fixtureMessages))
    await page.screenshot({path:`${output}/${engine}-${viewport.width}${baseline?"-baseline":""}.png`})
    observations.push({engine,viewport,baseline,drawerAnimations:await page.evaluate(()=>window.fixtureDrawerAnimations),droppedAcknowledgement,clickToUsableMs,onboardingDocumentRequests:documents.filter(url=>new URL(url).pathname.includes("/onboarding/")).length,documents,messages,requests:await(await page.request.get(`${origin}__requests`)).json()})
    await writeFile(`${output}/observations.json`,JSON.stringify(observations,null,2))
    console.log(`${engine} ${viewport.width}: ${baseline?"reproduced nested-shell pending failure":"canonical detail ready"}`)
   }finally{await context.close()}
  }}finally{await browser.close()}
 }
 await writeFile(`${output}/observations.json`,JSON.stringify(observations,null,2))
 await mkdir("browser-results",{recursive:true})
 await writeFile("browser-results/workspace-linked-detail.json",JSON.stringify({passed:true,baseline,observations},null,2))
}finally{server.kill("SIGTERM")}
