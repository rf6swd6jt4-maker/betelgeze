import {buildProgressiveBrowser} from './browser-build.mjs'
import {startProgressiveServer} from './server.mjs'
const build=await buildProgressiveBrowser()
const server=await startProgressiveServer({build,chats:Number(process.env.BE_BROWSER_CHATS??200),backlog:Number(process.env.BE_BROWSER_BACKLOG??100)})
console.log(server.url+'/')
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit()})
