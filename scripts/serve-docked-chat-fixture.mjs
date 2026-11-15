// The real docked-chat owner and the real tab-activity predicate around a stand-in chat page. No database, no
// messages: the stand-in frame speaks the workspace frame protocol (location, activate, prepare-departure) and shows
// what the real workspaceDocumentIsActive() answers, which is the condition the chat reader checks before any read.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-docked-chat-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "host.tsx"), `import React,{useRef,useState}from"react";import{createRoot}from"react-dom/client";
import{DockedCommunications,type DockedCommunicationsHandle}from"@/components/workspace/DockedCommunications";import{SegmentedSwitch}from"@/components/ui/SegmentedSwitch";
const VIEWS=[{value:"context",label:"Context"},{value:"chat",label:"Chat"}] as const;
function Host(){const handle=useRef<DockedCommunicationsHandle>(null);const[mounted,setMounted]=useState(true);const[view,setView]=useState<"context"|"chat">("chat");const[cover,setCover]=useState(false);const[note,setNote]=useState("");
return <div className="p-6"><p data-fixture-opened className="text-sm text-neutral-400">Work area. Opened: <span data-opened></span></p>
<div className="mt-3 flex gap-2 text-sm"><button data-close className="underline" onClick={async()=>{const safe=await handle.current!.leave();setNote(safe?"left":"refused");if(safe)setMounted(false)}}>Close chat</button><button data-cover className="underline" onClick={()=>setCover(v=>!v)}>Toggle cover</button><span data-note>{note}</span></div>
{mounted?<aside className="fixed right-6 top-24 flex h-[30rem] w-80 flex-col overflow-hidden rounded-xl border border-card-border bg-[var(--color-surface-glass)]"><header className="border-b border-white/[0.06] px-4 py-3"><h2 className="text-base font-semibold">Harbor Fitness</h2><SegmentedSwitch label="Client column view" value={view} options={VIEWS} onChange={setView} className="mt-3"/></header>
<DockedCommunications handle={handle} shown={view==="chat"} url="/fixture/communications?mode=clients&conversation=r1" label="Chat with Harbor Fitness" workspaceSlug="fixture" readProtocol="account-v1" onOpenDestination={href=>{document.querySelector("[data-opened]")!.textContent+=href+" "}}/></aside>:null}
{cover?<div data-cover-layer className="fixed right-6 top-24 z-50 h-[30rem] w-80 bg-black/80"/>:null}</div>}
document.body.dataset.workspaceActiveTabId="work";createRoot(document.getElementById("root")!).render(<Host/>);`)
    writeFileSync(join(directory, "frame.ts"), `import{workspaceDocumentIsActive}from"@/lib/workspace-tab-activity";
const SOURCE="betelgeze-workspace-tabs",tabId=new URLSearchParams(location.search).get("__betelgeze_tab");
const post=(m:object)=>parent.postMessage({source:SOURCE,target:"host",tabId,...m},location.origin);
const state=document.getElementById("state")!,draft=document.getElementById("draft") as HTMLInputElement;
const show=()=>{state.textContent=workspaceDocumentIsActive()?"active":"inactive"};
document.documentElement.setAttribute("data-workspace-frame-document","doc-1");document.documentElement.setAttribute("data-workspace-frame-page-mounted","true");
addEventListener("message",e=>{const m=e.data;if(m?.source!==SOURCE||m.target!=="frame"||m.tabId!==tabId)return;
 if(m.type==="activate"){document.body.dataset.workspaceTabActive=m.active?"true":"false";show()}
 if(m.type==="prepare-departure")post({type:"departure-ready",documentId:m.documentId,requestId:m.requestId,safe:draft.dataset.unsaved!=="true"})});
addEventListener("betelgeze:confirm-frame-departure",(e:any)=>{e.detail.safe=draft.dataset.unsaved!=="true"});
document.getElementById("record")!.addEventListener("click",()=>post({type:"open-tab",url:"/fixture/work-items/w1"}));
document.getElementById("away")!.addEventListener("click",()=>post({type:"location",url:"/fixture/relationships/r1"}));
setInterval(show,250);setTimeout(()=>post({type:"location",url:location.pathname+"?mode=clients&conversation=r1"}),Number(new URLSearchParams(location.search).get("delay")??150));`)
    const build = (entry, filename) => new Promise((done, fail) => webpack({ mode: "production", devtool: false,
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) })],
        entry: join(directory, entry), output: { path: directory, filename },
        resolve: { alias: { "@": root }, extensions: [".tsx", ".ts", ".js"], extensionAlias: { ".ts": [".ts"] }, modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }] }, optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, filename)))))
    const [host, frame, css] = await Promise.all([build("host.tsx", "host.js"), build("frame.ts", "frame.js"),
        postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)])
    const page = script => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white">${script}</body></html>`
    const hostHtml = page('<div id="root"></div><script src="/host.js"></script>')
    const frameHtml = page('<div class="flex h-dvh flex-col gap-3 p-3 text-sm"><p>Stand-in chat. Reader sees this chat as: <strong id="state">inactive</strong></p><button id="record" class="text-left underline">Open a record link</button><button id="away" class="text-left underline">Navigate away from chat</button><input id="draft" aria-label="Draft" class="mt-auto rounded-lg border border-neutral-700 bg-black px-3 py-2" placeholder="Message"></div><script src="/frame.js"></script>')
    const server = createServer((request, response) => {
        const path = new URL(request.url, "http://127.0.0.1").pathname
        const type = path.endsWith(".js") ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html"
        response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" })
        response.end(path === "/host.js" ? host : path === "/frame.js" ? frame : path === "/style.css" ? css : path === "/fixture/communications" ? frameHtml : hostHtml)
    })
    server.listen(Number(process.env.PORT ?? 3111), "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
