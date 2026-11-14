// The real reassign-and-remove dialog (and, with ?view=staff, the Staff panel assignments) with synthetic data. No database, no writes:
// the footprint read is served here and the save is a browser stub. ?mode=full|empty|blocked|unavailable|stale
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
const require = createRequire(import.meta.url)
const { webpack } = require("next/dist/compiled/webpack/webpack")
const root = process.cwd(), directory = mkdtempSync(join(tmpdir(), "be-member-offboarding-"))
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const fp = c => c.repeat(32)
const target = id(1), sam = id(2), mia = id(3), priya = id(4), me = id(9)
const service = id(20), seo = id(21)
const item = (key, kind, title, client, group, f, extra = {}) => ({ key, kind, relationshipId: id(30), recordId: key.split(":")[1], serviceKey: null, serviceId: null, client, title, fingerprint: fp(f), eligibleGroup: group, blockedReason: null, ...extra })
const full = {
    available: true, targetId: target, targetName: "Hemant Varshney", targetRole: "staff", fingerprint: fp("a"), history: { sellerClients: 2 },
    people: { [sam]: "Sam Ortega", [mia]: "Mia Novak", [priya]: "Priya Shah" },
    eligibility: { managers: [sam, priya], [`service:${service}`]: [sam, mia], [`service:${seo}`]: [sam], members: [sam, mia, priya, me] },
    items: [
        item(`client_manager:${id(30)}`, "client_manager", "Fulfilment manager", "North Texas Shutters", "managers", "1"),
        item(`client_manager:${id(31)}`, "client_manager", "Fulfilment manager", "PRO Construction", "managers", "2"),
        item(`service_assignee:${id(40)}`, "service_assignee", "Meta Ads Setup", "North Texas Shutters", `service:${service}`, "3", { serviceId: service }),
        item(`legacy_service_assignee:${id(30)}:seo`, "legacy_service_assignee", "seo", "North Texas Shutters", `service:${seo}`, "4", { serviceId: seo, serviceKey: "seo" }),
        item(`queue_member:${id(41)}`, "queue_member", "Meta Ads Setup", "Bright Dental", `service:${service}`, "5", { serviceId: service }),
        item(`work_owner:${id(50)}`, "work_owner", "Quarterly review deck", "PRO Construction", "members", "6"),
        item(`work_collaborator:${id(51)}`, "work_collaborator", "Tidy the shared drive", null, "members", "7"),
    ],
}
const modes = {
    full, stale: full,
    empty: { ...full, items: [], history: { sellerClients: 0 }, fingerprint: fp("b") },
    blocked: { ...full, items: full.items.map(i => i.kind === "service_assignee" ? { ...i, blockedReason: "This imported service must be reviewed before it can move." } : i) },
    unavailable: { available: false },
}
try {
    writeFileSync(join(directory, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
    writeFileSync(join(directory, "css.cjs"), 'module.exports=function(source){const names=Object.fromEntries([...source.matchAll(/\\.([a-zA-Z][\\w-]*)/g)].map(m=>[m[1],m[1]]));return `const style=document.createElement("style");style.textContent=${JSON.stringify(source)};document.head.append(style);export default ${JSON.stringify(names)}`;}')
    writeFileSync(join(directory, "navigation.js"), 'export const useRouter=()=>({refresh(){},push(){}});export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;')
    writeFileSync(join(directory, "link.js"), 'import React from "react";export default function Link({href,children,...props}){return React.createElement("a",{href,...props},children)}')
    writeFileSync(join(directory, "image.js"), 'import React from "react";export default function Image({fill,sizes,unoptimized,...props}){return React.createElement("img",props)}')
    writeFileSync(join(directory, "actions.js"), `export async function offboardWorkspaceMember(slug,input){(window.fixtureRequests??=[]).push(input);await new Promise(r=>setTimeout(r,500));
if(new URLSearchParams(location.search).get("mode")==="stale"&&window.fixtureRequests.length===1)return{ok:false,uncertain:false,message:"Assignments changed. Reload and try again. Nothing was moved."};
return{ok:true,message:"Assignments moved and the person was removed."}}
export async function reassignWorkspaceMemberItems(slug,input){(window.fixtureMoves??=[]).push(input);await new Promise(r=>setTimeout(r,500));return{ok:true,message:"Assignments moved."}}
export async function removeWorkspaceUser(){return{ok:false,message:"Fixture"}}`)
    writeFileSync(join(directory, "entry.tsx"), `import React from"react";import{createRoot}from"react-dom/client";
import{RemoveWorkspaceUser}from"@/components/admin/RemoveWorkspaceUser";
import{StaffMemberAssignments}from"@/components/staff/StaffMemberAssignments";
const staffFootprint=${JSON.stringify(full)};
const legacy=async()=>({ok:false,message:"Fixture: plain removal is not wired here."});
const staffView=new URLSearchParams(location.search).get("view")==="staff";
createRoot(document.getElementById("root")).render(staffView?<div style={{padding:24,maxWidth:1100}}><StaffMemberAssignments workspaceSlug="fixture" currentUserId="${me}" initial={staffFootprint}/></div>:<div style={{padding:24,maxWidth:640}}><div className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">hemant@example.invalid</p><p className="text-sm text-neutral-500">Staff</p></div><RemoveWorkspaceUser workspaceSlug="fixture" currentUserId="${me}" userId="${target}" email="hemant@example.invalid" legacyAction={legacy}/></div></div>);`)
    const cssPromise = postcss([tailwind({ base: root, optimize: false })]).process(readFileSync("app/globals.css", "utf8"), { from: resolve("app/globals.css") }).then(result => result.css)
    const bundle = await new Promise((done, fail) => webpack({ mode: "production", devtool: false,
        plugins: [new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) })],
        entry: join(directory, "entry.tsx"), output: { path: directory, filename: "bundle.js" },
        resolve: { alias: { "next/navigation$": join(directory, "navigation.js"), "next/link$": join(directory, "link.js"), "next/image$": join(directory, "image.js"),
            "@/app/[workspaceSlug]/users/actions$": join(directory, "actions.js"), "@": root }, extensions: [".tsx", ".ts", ".js"], modules: [resolve("node_modules"), "node_modules"] },
        module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(directory, "loader.cjs") }, { test: /\.css$/, use: join(directory, "css.cjs") }] }, optimization: { minimize: false },
    }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : done(readFileSync(join(directory, "bundle.js")))))
    const css = await cssPromise
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body data-workspace-tab-active="true" class="bg-neutral-950 text-white"><div id="root"></div><script src="/bundle.js"></script></body></html>'
    const server = createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1"), path = url.pathname
        if (path.startsWith("/api/workspaces/fixture/members/")) {
            const referer = new URL(request.headers.referer ?? "http://x/", "http://x")
            const mode = referer.searchParams.get("mode") ?? "full"
            const ok = request.headers["x-workspace-user"] === me
            response.writeHead(ok ? 200 : 409, { "Content-Type": "application/json", "Cache-Control": "no-store" })
            setTimeout(() => response.end(JSON.stringify(ok ? modes[mode] ?? full : { error: "Your account changed." })), 300)
            return
        }
        response.writeHead(200, { "Content-Type": path === "/bundle.js" ? "text/javascript" : path === "/style.css" ? "text/css" : "text/html", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" })
        response.end(path === "/bundle.js" ? bundle : path === "/style.css" ? css : html)
    })
    server.listen(Number(process.env.PORT ?? 3108), "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`))
} finally { rmSync(directory, { recursive: true, force: true }) }
