// Local synthetic browser fixture for the real workspace geometry controllers.
// A body transform injects the viewport pan reported in WebKit bug 311821.
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import ts from "typescript"

const baseline = process.argv.includes("--baseline")
const compile = (file) => ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const cssSource = readFileSync("app/globals.css", "utf8")
const css = cssSource.slice(cssSource.indexOf('html[data-workspace-viewport-locked="true"] {'), cssSource.indexOf("@media (min-width: 768px)"))
const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workspace visual origin fixture</title><style>${css}
body{margin:0} [data-workspace-topbar]{position:fixed;left:0;top:0;width:390px;height:56px;background:#ddd}
[data-workspace-tabbar]{position:fixed;left:0;top:56px;width:390px;height:44px;background:#bbb}
[data-workspace-tab-panels]{position:fixed;left:0;top:100px;width:390px;background:#777}
</style><body><div data-workspace-shell-root><header data-workspace-topbar></header><nav data-workspace-tabbar></nav><main data-workspace-tab-panels><input id="editor" value="draft selected passage"></main></div>
<pre id="result">Running…</pre><script type="module">
import {createComposerViewportController} from '/composer.js';
import {createWorkspaceVisualOrigin} from '/origin.js';
const root=document.documentElement,bar=document.querySelector('[data-workspace-topbar]'),tab=document.querySelector('[data-workspace-tabbar]'),panel=document.querySelector('[data-workspace-tab-panels]'),editor=document.querySelector('#editor');
root.dataset.workspaceViewportLocked='true';
let measured=800,focused=false,eligible=true;
const controller=createComposerViewportController({readBottom:()=>measured,readLayoutBottom:()=>800,writeBottom:bottom=>root.style.setProperty('--workspace-visual-viewport-bottom',bottom+'px'),animateKeyboard:()=>false,schedule:(cb,ms)=>setTimeout(cb,ms),cancel:id=>clearTimeout(id)});
const origin=createWorkspaceVisualOrigin({readTop:()=>bar.getBoundingClientRect().top,readLimit:()=>eligible?400:0,writeOffset:offset=>root.style.setProperty('--workspace-visual-origin-offset',offset+'px'),requestFrame:cb=>requestAnimationFrame(cb),cancelFrame:id=>cancelAnimationFrame(id)});
const delay=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const cases=[];function check(name,condition,detail){cases.push({name,passed:!!condition,detail});}
function move(pan,bottom){document.body.style.transform='translateY(-'+pan+'px)';measured=bottom;controller.update();${baseline ? "" : "origin.update();"}}
function geometry(){return {bar:bar.getBoundingClientRect().top,tab:tab.getBoundingClientRect().top,panel:panel.getBoundingClientRect().top,bottom:panel.getBoundingClientRect().bottom,scroll:root.scrollTop};}
move(0,800);await delay();let g=geometry();check('resting chrome',g.bar===0&&g.tab===56&&g.panel===100&&g.bottom===800,g);
editor.focus({preventScroll:true});editor.setSelectionRange(6,14);focused=true;controller.focus();move(84,500);await delay();g=geometry();check('keyboard pan keeps chrome, composer edge and selection',g.bar===0&&g.tab===56&&g.panel===100&&g.bottom===500&&g.scroll===0&&document.activeElement===editor&&editor.selectionStart===6&&editor.selectionEnd===14,g);
move(32,550);await delay();g=geometry();check('changing keyboard pan',g.bar===0&&g.tab===56&&g.panel===100&&g.bottom===550,g);
focused=false;controller.blur();move(0,800);await delay();g=geometry();check('keyboard close restores chrome',g.bar===0&&g.tab===56&&g.panel===100&&g.bottom===800,g);
controller.focus();move(100,450);await delay();g=geometry();check('reopen after close',g.bar===0&&g.tab===56&&g.panel===100&&g.bottom===450,g);
eligible=false;${baseline ? "" : "origin.update();"}await delay();g=geometry();check('zoom or desktop releases correction',g.bar===-100&&g.tab===-44&&g.panel===0,g);
controller.dispose();origin.dispose();document.querySelector('#result').textContent=JSON.stringify({engine:navigator.userAgent,baseline:${baseline},passed:cases.filter(c=>c.passed).length,total:cases.length,cases},null,2);
</script>`
const routes = new Map([["/", ["text/html", page]], ["/composer.js", ["text/javascript", compile("lib/composer-viewport-controller.ts")]], ["/origin.js", ["text/javascript", compile("lib/workspace-visual-origin.ts")]]])
const server = createServer((request, response) => {
    const route = routes.get(request.url)
    if (!route) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { "Content-Type": route[0], "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'" })
    response.end(route[1])
})
server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
