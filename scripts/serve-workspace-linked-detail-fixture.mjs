// Real shell/bridge/guard and actual server route + proxy decisions, with synthetic services.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-linked-detail-"))
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "css.cjs"), 'module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]]));return `const style=document.createElement("style");style.textContent=${JSON.stringify(source)};document.head.append(style);export default ${JSON.stringify(names)}`;}')
    writeFileSync(join(directory, "navigation.js"), `import{useSyncExternalStore,useMemo}from"react";
const event="fixture:location",subscribe=fn=>{window.addEventListener(event,fn);window.addEventListener("popstate",fn);return()=>{window.removeEventListener(event,fn);window.removeEventListener("popstate",fn)}};
for(const name of["pushState","replaceState"]){const original=history[name];history[name]=function(...args){const result=original.apply(this,args);window.dispatchEvent(new Event(event));return result}}
const href=()=>location.href;const current=()=>useSyncExternalStore(subscribe,href,href);
export const usePathname=()=>new URL(current()).pathname;
export const useSearchParams=()=>{const url=current();return useMemo(()=>new URL(url).searchParams,[url])};
const router={push:url=>location.assign(url),replace:url=>location.replace(url),refresh:()=>location.reload(),prefetch(){}};export const useRouter=()=>router;`)
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,prefetch,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "dynamic.js"), 'import React,{lazy,Suspense}from"react";export default loader=>{const Component=lazy(()=>loader().then(defaultExport=>({default:defaultExport})));return props=>React.createElement(Suspense,{fallback:null},React.createElement(Component,props))}')
    writeFileSync(join(directory, "unused.js"), 'export const NativeWorkspaceTab=()=>null;export const NativeCommunicationsTab=()=>null;export const nativePanelCacheKey=()=>"unused";export const WorkspaceMemberProfileModal=()=>null;export const WorkspaceCreateModal=()=>null;export const AccountMenu=()=>null;const invalidate=()=>{};export const useCommunicationsUnread=()=>({count:0,stale:false,invalidate});')
    writeFileSync(join(directory, "supabase.js"), 'const channel={on(){return this},subscribe(callback){queueMicrotask(()=>callback("SUBSCRIBED"));return this},track:async()=>{},presenceState:()=>({}),untrack:async()=>{}};const client={auth:{getSession:async()=>({data:{session:{access_token:"fixture"}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},realtime:{setAuth:async()=>{}},channel:()=>channel,removeChannel:async()=>{}};export const createSupabaseBrowserClient=()=>client;')
    const aliases = { "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory,"link.js"), "next/dynamic$":join(directory,"dynamic.js"), "@/lib/supabase/browser$":join(directory,"supabase.js") }
    for (const name of ["workspace/NativeWorkspaceTab", "workspace/NativeCommunicationsTab", "workspace/WorkspaceMemberProfileModal", "workspace/WorkspaceCreateModal", "account/AccountMenu", "communications/useCommunicationsUnread"]) aliases[`@/components/${name}$`] = join(directory,"unused.js")
    aliases["@"] = root
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode:"production",devtool:false,entry:resolve("scripts/fixtures/workspace-linked-detail.tsx"),output:{path:directory,filename:"bundle.js"},resolve:{alias:aliases,extensions:[".tsx",".ts",".js"],modules:[resolve("node_modules"),"node_modules"]},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(directory,"loader.cjs")},{test:/\.css$/,use:join(directory,"css.cjs")}]},optimization:{minimize:false},plugins:[new webpack.DefinePlugin({"process.env":JSON.stringify({NODE_ENV:"production"})}),new webpack.optimize.LimitChunkCountPlugin({maxChunks:1})]},(error,stats)=>error||stats.hasErrors()?fail(error??Error(stats.toString({all:false,errors:true}))):done(readFileSync(join(directory,"bundle.js")))))
    const css = await cssPromise
    const html = proxyShell => `<!doctype html><html data-workspace-viewport-locked="true" data-proxy-shell="${proxyShell}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>`
    const requests = []
    const server = createServer(async(request,response)=>{
        try {
            const url=new URL(request.url,"http://127.0.0.1"),path=url.pathname
            if(path==="/__requests"){response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify(requests));return}
            if(path.startsWith("/api/")){response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({email:"fixture@example.test",workspaceMembers:[]}));return}
            let shell=false
            if(path.startsWith("/fixture/")){
                requests.push({url:request.url,kind:"document"})
                // The harness executes the real source, including access checks before redirects.
                const runtime=await import("./fixtures/onboarding-redirect-runtime.mjs")
                if(path.includes("/onboarding/")&&!url.searchParams.has("session")){
                    const result=await runtime.resolveOnboardingRedirect(request.url)
                    if(result.location){requests.at(-1).redirect=result.location;response.writeHead(307,{Location:result.location});response.end();return}
                }
                const result=await runtime.resolveProxy(request.url)
                shell=result.pathname.startsWith("/~workspace-shell/")
                requests.at(-1).proxyPath=result.pathname
            }
            response.writeHead(200,{"Content-Type":path==="/bundle.js"?"text/javascript":path==="/style.css"?"text/css":"text/html","Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"})
            response.end(path==="/bundle.js"?bundle:path==="/style.css"?css:html(shell))
        }catch(error){console.error(error);response.writeHead(500);response.end(String(error))}
    })
    server.listen(0,"127.0.0.1",()=>console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory,{recursive:true,force:true}) }
