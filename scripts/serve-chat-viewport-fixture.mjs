// Local-only browser fixture. Open the printed URL in Chromium and Safari.
// It serves the real helper, synthetic DOM, and no authenticated app data.
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import ts from "typescript"

const baseline = process.argv.includes("--baseline")
const source = (path) => baseline && path === "lib/chat-viewport-motion.ts"
    ? execFileSync("git", ["show", "31388081894e6d4143d5bb0d577c0341ec31edf7:" + path], { encoding: "utf8" })
    : readFileSync(path, "utf8")
const helper = ts.transpileModule(source("lib/chat-viewport-motion.ts"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const tabs = ts.transpileModule(source("lib/workspace-tabs.ts"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const index = `<!doctype html><meta charset="utf-8"><title>Betelgeze mobile motion fixture</title>
<h1>Mobile motion: ${baseline ? "baseline" : "candidate"}</h1><p>Real browser animation, synthetic 390px resident frame. No client data or remote requests.</p>
<pre id="result">Running…</pre><iframe id="runner" src="/runner" style="width:390px;height:850px;border:1px solid #777"></iframe>
<script>window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===document.querySelector('#runner').contentWindow&&e.data?.kind==='result')document.querySelector('#result').textContent=JSON.stringify(e.data.result,null,2)})</script>`
const runner = `<!doctype html><meta charset="utf-8"><style>body{margin:0} iframe{display:block;width:100%;border:0} [hidden]{display:none!important}</style>
<div id="scope"></div><script type="module">
import {observeChatViewportMotion,requestChatViewportMotion} from '/chat-viewport-motion.js';
import {WORKSPACE_TAB_VISIBILITY_EVENT} from '/workspace-tabs.ts';
const results=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function assert(ok,why){if(!ok)throw Error(why)}
async function fixture(){
 const scope=document.querySelector('#scope'),frame=document.createElement('iframe');
 frame.style.height='800px'; frame.src='/frame';scope.append(frame); await new Promise(r=>frame.onload=r);
 const doc=frame.contentDocument,clip=doc.querySelector('#clip'),layer=doc.querySelector('#layer'),pane=doc.querySelector('#pane');
 const stop=observeChatViewportMotion(clip,layer),writes=[];
 return {frame,clip,layer,writes,
  move(bottom){requestChatViewportMotion(scope,parseFloat(frame.style.height),bottom,40,value=>{frame.style.height=value+'px';writes.push(value)})},
  touch(type){const e=new Event(type,{bubbles:true});Object.defineProperty(e,'touches',{value:type==='touchstart'?[{}]:[]});pane.dispatchEvent(e)},
  select(active){doc.body.dataset.workspaceTabActive=String(active);frame.contentWindow.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))},
  async complete(){const animation=layer.getAnimations().at(-1);if(animation)await Promise.race([animation.finished.catch(e=>{if(e.name!=='AbortError')throw e}),wait(2000).then(()=>{throw Error('animation deadline')})]);await wait(40)},
  check(bottom){assert(frame.style.height===bottom+'px','expected height '+bottom+', received '+frame.style.height);assert(layer.style.height===''&&layer.style.willChange===''&&!clip.dataset.chatViewportMoving,'temporary motion geometry remains')},
  close(){stop();frame.remove()}
 }
}
async function run(name,fn){const f=await fixture();try{await fn(f);results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message})}finally{f.close()}}
await run('keyboard motion completes',async f=>{f.move(500);await f.complete();f.check(500)});
await run('hidden return with lost touchend',async f=>{f.move(500);f.touch('touchstart');f.frame.hidden=true;f.move(800);f.frame.hidden=false;f.move(500);await f.complete();f.check(500)});
await run('deactivation before CSS hide',async f=>{f.move(500);f.touch('touchstart');f.select(false);assert(f.writes.length===1,'obsolete motion applied on departure');f.select(true);f.move(450);await f.complete();f.check(450)});
await run('lost touch without pending motion',async f=>{f.touch('touchstart');f.select(false);f.select(true);f.move(500);await f.complete();f.check(500)});
await run('active gesture waits for touch and momentum',async f=>{f.move(500);f.touch('touchstart');f.select(true);await wait(520);assert(f.frame.style.height==='800px','active scroll resized early');f.touch('touchend');await wait(260);f.check(500)});
parent.postMessage({kind:'result',result:{engine:navigator.userAgent,width:innerWidth,passed:results.filter(r=>r.passed).length,total:results.length,cases:results}},location.origin);
</script>`
const frame = `<!doctype html><meta charset="utf-8"><style>body{margin:0}header{height:100px;background:#ddd}#clip{height:calc(100vh - 100px);overflow:hidden}#layer{height:100%;background:#eee}#pane{height:100%;overflow:auto}p{height:1400px;margin:0}</style><header>Chat fixture</header><div id="clip"><div id="layer"><div id="pane" data-message-pane><p>Synthetic messages</p></div></div></div>`
const routes = new Map([["/", ["text/html", index]], ["/runner", ["text/html", runner]], ["/frame", ["text/html", frame]], ["/chat-viewport-motion.js", ["text/javascript", helper]], ["/workspace-tabs.ts", ["text/javascript", tabs]]])
const server = createServer((request, response) => {
    const route = routes.get(request.url)
    if (!route) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { "Content-Type": route[0], "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'" })
    response.end(route[1])
})
server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
