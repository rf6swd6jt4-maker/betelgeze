// Full production build with a loopback-only transport. Host mapping exercises
// the actual app-host proxy path; no imports, components or routes are replaced.
import { createServer } from 'node:http'
import next from 'next'
const dir=process.argv[2];if(!dir)throw Error('Pass an isolated built checkout')
const port=45678,app=next({dev:false,dir,hostname:'app.betelgeze.com',port}),handle=app.getRequestHandler();await app.prepare()
const server=createServer((req,res)=>{req.headers.host=`app.betelgeze.com:${port}`;if(req.headers.origin===`http://127.0.0.1:${port}`)req.headers.origin=`http://app.betelgeze.com:${port}`;handle(req,res)})
server.listen(port,'127.0.0.1',()=>console.log(`Full app fixture: http://127.0.0.1:${port}`))
