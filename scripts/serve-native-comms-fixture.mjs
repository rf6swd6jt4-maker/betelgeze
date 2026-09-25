// Actual resident host/panel lifecycle with synthetic child chats and loopback
// bootstraps. No auth, messages, sockets or production data are involved.
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import ts from "typescript"

const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const directory = mkdtempSync(join(tmpdir(), "be-native-comms-"))
const development = process.argv.includes("--development")
const sources = [
    "components/workspace/NativeCommunicationsTab.tsx",
    "components/workspace/WorkspaceNavigation.tsx",
    "components/communications/CommunicationsPanel.tsx",
    "components/communications/CommunicationsRuntime.tsx",
    "lib/communications/native-host.ts",
    "lib/communications/mode-resource.ts",
    "lib/workspace-record-cache.ts",
    "lib/workspace-navigation-lifecycle.ts",
    "lib/workspace-tabs.ts",
]
const aliases = new Map(sources.map(path => ["@/" + path.replace(/\.(tsx?|js)$/, ""), "./" + path.split("/").at(-1).replace(/\.tsx?$/, ".js")]))
aliases.set("./WorkspaceNavigation", "./WorkspaceNavigation.js")
for (const from of ["./WorkspaceTabOpeningState", "@/components/workspace/PanelRouteLoading", "./useCommunicationsUnread", "@/components/ui", "@/components/communications/ResizableConversationColumns", "@/components/communications/useReliableCommunicationsRealtime"]) aliases.set(from, "./stubs.js")
aliases.set("@supabase/supabase-js", "./supabase-fixture.js")
aliases.set("@/lib/supabase/browser", "./supabase-fixture.js")
aliases.set("@/components/communications/CommunicationsWorkspace", "./workspaces.js")
aliases.set("@/components/communications/TeamCommunicationsWorkspace", "./workspaces.js")
aliases.set("next/navigation", "./stubs.js")
for (const path of sources) {
    let source = readFileSync(path, "utf8")
    for (const [from, to] of aliases) source = source.replaceAll(`"${from}"`, JSON.stringify(to))
    const result = ts.transpileModule(source, { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } })
    writeFileSync(join(directory, path.split("/").at(-1).replace(/\.tsx?$/, ".js")), result.outputText)
}
writeFileSync(join(directory, "stubs.js"), `import React from "react";
export const DEFAULT_CONVERSATION_LIST_WIDTH=320;
export const COMMUNICATIONS_RECOVERY_EVENT="fixture:recover";
export const WorkspaceTabOpeningState=()=>React.createElement("p",{"data-opening":true},"Opening synthetic chat");
export const PanelRouteLoading=WorkspaceTabOpeningState;
export const Status=({label})=>React.createElement("span",null,label);
export function useCommunicationsUnread(){return {invalidate(){}}}
export const useRouter=()=>({}); export const usePathname=()=>location.pathname;
export const useSearchParams=()=>new URLSearchParams(location.search);`)
writeFileSync(join(directory, "supabase-fixture.js"), `
export const transports=[];
export const authState={token:"fixture-token",factoryCalls:0,sessionReads:0};
export const shared={auth:{getSession:async()=>{authState.sessionReads++;return {data:{session:{access_token:authState.token}}}}}};
export function createSupabaseBrowserClient(){authState.factoryCalls++;return shared}
export function createClient(url,key,options){
 if(typeof options?.accessToken!=="function")throw Error("Transport constructed without external auth supplier");
 const transport={id:transports.length+1,options,realtime:{},channels:[],removedAll:0,
 channel(topic){const channel={topic,owner:this.id,subscribe(){return channel}};this.channels.push(channel);return channel},
 async removeChannel(channel){this.channels=this.channels.filter(value=>value!==channel);return "ok"},
 async removeAllChannels(){this.removedAll++;this.channels=[];return []}};
 transports.push(transport);return transport;
}`)
writeFileSync(join(directory, "workspaces.js"), `import React,{useEffect,useState} from "react";
import {useWorkspaceNavigation} from "./WorkspaceNavigation.js";
function Workspace(props){
 const nav=useWorkspaceNavigation();
 const [token]=useState(()=>String(++window.fixtureInstance));
 const [selected,setSelected]=useState(props.bootstrap.selectedConversationId??props.bootstrap.requestedConversationId??null);
 const [draft,setDraft]=useState("");
 useEffect(()=>props.onSelectedConversationChange(selected),[selected,props.onSelectedConversationChange]);
 window.fixtureWorkspaces[nav.tabId+":"+props.kind]={select:setSelected,navigate:nav.replace,token};
 return React.createElement("section",{"data-fixture-workspace":props.kind,"data-token":token},
 React.createElement("p",null,selected??"list"),
 React.createElement("input",{"aria-label":"Synthetic draft",value:draft,onChange:e=>setDraft(e.target.value)}),
 React.createElement("a",{href:"/demo/relationships/synthetic",onClick:()=>{throw Error("Native link reached the child router")}},"Synthetic relationship"),
 React.createElement("button",{onClick:()=>setSelected("local-choice")},"Select synthetic conversation"),
 React.createElement("button",{onClick:()=>props.onOpenTeam?.()??props.onOpenClients?.()},"Switch synthetic mode"));
}
export const CommunicationsWorkspace=props=>React.createElement(Workspace,{...props,kind:"clients"});
export const TeamCommunicationsWorkspace=props=>React.createElement(Workspace,{...props,kind:"team"});`)
writeFileSync(join(directory, "runner.js"), readFileSync("scripts/browser/native-comms-runner.mjs", "utf8"))
await new Promise((done, fail) => webpack({ mode: development ? "development" : "production", devtool: false, entry: join(directory, "runner.js"), output: { path: directory, filename: "bundle.js" }, plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }), new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("https://fixture.invalid"), "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify("synthetic-key") })], resolve: { modules: [resolve("node_modules"), "node_modules"] }, optimization: { minimize: false } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done()))
const bundle = readFileSync(join(directory, "bundle.js"))
rmSync(directory, { recursive: true, force: true })
const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1")
    if (request.method !== "GET") { response.writeHead(405); response.end(); return }
    if (url.pathname.startsWith("/api/workspaces/demo/communications/")) {
        const selected = url.searchParams.get("conversation")
        const bootstrap = { workspaceId: "workspace", workspaceSlug: "demo", currentUser: { id: "viewer" }, conversations: [], selectedConversationId: selected, requestedConversationId: selected }
        setTimeout(() => { response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(bootstrap)) }, selected?.startsWith("delayed-") ? 320 : 25)
        return
    }
    response.writeHead(200, { "Content-Type": url.pathname === "/bundle.js" ? "text/javascript" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'none'" })
    response.end(url.pathname === "/bundle.js" ? bundle : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui}.hidden,[hidden]{display:none!important}[data-mobile-comms-tab]{border:1px solid;padding:10px}.fixed{position:fixed}#result{white-space:pre-wrap}</style></head><body data-workspace-tabs-hosted="true"><div id="host"></div><pre id="result">Running</pre><script src="/bundle.js"></script></body></html>')
})
server.listen(0, "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
