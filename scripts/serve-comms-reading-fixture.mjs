// Actual reading/summary hooks and mobile surface. All account/message I/O is synthetic.
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const directory = mkdtempSync(join(tmpdir(), 'be-comms-reading-'))
const sources = [
 'components/communications/MobileConversationSurface.tsx', 'components/communications/useConversationRead.ts',
 'components/communications/useChatDocumentAttention.ts', 'components/workspace/useWorkspaceTabActive.ts',
 'components/communications/useCommunicationsUnread.ts', 'components/communications/useSharedUnreadSummary.ts',
 'lib/mobile-conversation-viewport.ts', 'lib/workspace-tabs.ts', 'lib/workspace-tab-activity.ts',
 'lib/communications/reading-visibility.ts', 'lib/communications/reading-observer.ts',
 'lib/communications/read-queue.ts', 'lib/communications/read-state.ts', 'lib/record-version.js',
 'lib/communications/unread-summary.ts', 'lib/communications/unread-broadcast.ts',
].filter(existsSync)
const aliases = new Map(sources.flatMap(path => {
 const file = path.split('/').at(-1), compiled = './' + file.replace(/\.tsx?$/, '.js')
 return [['@/' + path.replace(/\.(tsx?|js)$/, ''), compiled], ['./' + file, compiled], ['./' + file.replace(/\.(tsx?|js)$/, ''), compiled]]
}))
for (const key of ['@/components/workspace/WorkspaceNavigation', './WorkspaceNavigation', '@/lib/workspace-performance', '@/lib/push/browser-notifications']) aliases.set(key, './stubs.js')
aliases.set('../record-version.js', './record-version.js')
for (const path of sources) {
 let source = process.env.COMMS_READ_BASELINE && ['components/communications/useConversationRead.ts','lib/communications/reading-visibility.ts'].includes(path)
  ? execFileSync('git', ['show', `${process.env.COMMS_READ_BASELINE}:${path}`], { encoding: 'utf8' }) : readFileSync(path, 'utf8')
 for (const [from, to] of aliases) source = source.replaceAll(`"${from}"`, JSON.stringify(to))
 writeFileSync(join(directory, path.split('/').at(-1).replace(/\.tsx?$/, '.js')), ts.transpileModule(source, { fileName:path, compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX} }).outputText)
}
writeFileSync(join(directory,'stubs.js'), `import React from 'react'; export const Navigation = React.createContext({tabId:'fixture-tab',active:true}); export const useWorkspaceNavigation=()=>React.useContext(Navigation); export const beginWorkspaceInteraction=()=>({mark(){},finish(){}}); export const dismissReadChatNotification=async()=>{};`)
writeFileSync(join(directory,'runner.js'),readFileSync('scripts/browser/comms-reading-runner.mjs','utf8'))
let bundle, css
try {
 [bundle,css]=await Promise.all([
 new Promise((done,fail)=>webpack({mode:'production',entry:join(directory,'runner.js'),output:{path:directory,filename:'bundle.js'},resolve:{modules:[resolve('node_modules'),'node_modules']},optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?fail(error??Error(stats.toString({all:false,errors:true}))):done(readFileSync(join(directory,'bundle.js'))))),
 postcss([tailwind({base:process.cwd(),optimize:false})]).process(readFileSync('app/globals.css','utf8'),{from:resolve('app/globals.css')}).then(result=>result.css)
 ])
} finally { rmSync(directory,{recursive:true,force:true}) }
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nhtml,body{margin:0;background:#111;color:white;font:16px system-ui}#stage{height:100dvh}.fixture-chat{height:100%;display:flex;flex-direction:column;background:#111}.fixture-chat header,.fixture-chat footer{height:70px;flex:none}.fixture-pane{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;justify-content:flex-end}.fixture-row{height:80px;flex:none;background:#333;margin:8px}.cover{position:fixed;inset:0;z-index:200000;background:#444}#result{position:fixed;pointer-events:none;width:1px;height:1px;overflow:hidden;z-index:-1}</style></head><body><div id="stage"></div><pre id="result">Running</pre><script src="/bundle.js"></script></body></html>`
const server=createServer((req,res)=>{ const path=new URL(req.url,'http://127.0.0.1').pathname; if(req.method!=='GET'||!['/','/bundle.js'].includes(path)){res.writeHead(404);res.end();return} res.writeHead(200,{'Content-Type':path==='/'?'text/html':'text/javascript','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'"});res.end(path==='/'?html:bundle) })
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/`))
