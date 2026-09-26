// Actual pane layout, motion and portal owners. No account or message network I/O.
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
const directory = mkdtempSync(join(tmpdir(), 'be-comms-pane-lifecycle-'))
const sources = [
 'components/communications/MobileConversationSurface.tsx', 'components/communications/useConversationLayout.ts',
 'components/communications/message-pane-observer.ts', 'components/communications/ChatMotionViewport.tsx',
 'lib/mobile-conversation-viewport.ts', 'lib/chat-viewport-motion.ts', 'lib/mobile-conversation-motion.ts',
 'lib/mobile-conversation-easing.ts', 'lib/workspace-tabs.ts',
].filter(existsSync)
const aliases = new Map(sources.flatMap(path => {
 const file = path.split('/').at(-1), compiled = './' + file.replace(/\.tsx?$/, '.js')
 return [['@/' + path.replace(/\.(tsx?|js)$/, ''), compiled], ['./' + file, compiled], ['./' + file.replace(/\.(tsx?|js)$/, ''), compiled]]
}))
for (const path of sources) {
 let source = process.env.COMMS_PANE_BASELINE && path === 'components/communications/useConversationLayout.ts'
  ? execFileSync('git', ['show', `${process.env.COMMS_PANE_BASELINE}:${path}`], { encoding: 'utf8' }) : readFileSync(path, 'utf8')
 for (const [from, to] of aliases) source = source.replaceAll(`"${from}"`, JSON.stringify(to))
 writeFileSync(join(directory, path.split('/').at(-1).replace(/\.tsx?$/, '.js')), ts.transpileModule(source, { fileName:path, compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX} }).outputText)
}
writeFileSync(join(directory,'runner.js'),readFileSync('scripts/browser/comms-pane-lifecycle-runner.mjs','utf8'))
let bundle, css
try {
 [bundle,css]=await Promise.all([
 new Promise((done,fail)=>webpack({mode:'development',entry:join(directory,'runner.js'),output:{path:directory,filename:'bundle.js'},resolve:{modules:[resolve('node_modules'),'node_modules']},devtool:false,optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?fail(error??Error(stats.toString({all:false,errors:true}))):done(readFileSync(join(directory,'bundle.js'))))),
 postcss([tailwind({base:process.cwd(),optimize:false})]).process(readFileSync('app/globals.css','utf8'),{from:resolve('app/globals.css')}).then(result=>result.css)
 ])
} finally { rmSync(directory,{recursive:true,force:true}) }
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\nhtml,body{margin:0;background:#111;color:white;font:16px system-ui}#stage{height:100dvh}.fixture-chat{height:100%;display:flex;flex-direction:column;background:black}.fixture-chat header,.fixture-chat footer{height:70px;flex:none;display:flex;align-items:center;background:#222}.fixture-pane{min-height:0;overflow:auto}.fixture-content{min-height:100%;display:flex;flex-direction:column}.fixture-row{height:60px;flex:none;padding:8px;background:#333;margin:4px}.fixture-content [data-conversation-empty]{height:100%;min-height:80px;display:flex;align-items:center;justify-content:center}#result{position:fixed;pointer-events:none;width:1px;height:1px;overflow:hidden;z-index:-1}</style></head><body><div id="stage"></div><pre id="result">Running</pre><script src="/bundle.js"></script></body></html>`
const server=createServer((req,res)=>{ const path=new URL(req.url,'http://127.0.0.1').pathname; if(req.method!=='GET'||!['/','/bundle.js'].includes(path)){res.writeHead(404);res.end();return} res.writeHead(200,{'Content-Type':path==='/'?'text/html':'text/javascript','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'"});res.end(path==='/'?html:bundle) })
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/`))
