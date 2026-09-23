import http from 'node:http';
import { writeFile } from 'node:fs/promises';
const html = `<!doctype html><meta charset="utf-8"><title>Local draft checkpoint benchmark</title>
<style>body{font:15px system-ui;max-width:960px;margin:30px auto;background:#171717;color:#eee}pre{white-space:pre-wrap}button{font:inherit;padding:12px}</style>
<h1>Synthetic draft checkpoint benchmark</h1><p>Loopback only. No application, account, provider, or client data. Measures one bounded JSON snapshot and localStorage write at departure; normal typing has zero storage calls. This is not production or physical-device evidence.</p>
<button id="run">Run matched samples</button><pre id="result">Ready</pre>
<script>
const out=document.getElementById('result'), button=document.getElementById('run');
button.onclick=async()=>{
 button.disabled=true;out.textContent='Running';
 const key='fixture:draft:'+crypto.randomUUID(),hint=key+':hint';
 const percentile=(a,p)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.min(b.length-1,Math.floor(b.length*p))]};
 const result={ua:navigator.userAgent,samples:100,ordinaryTypingStorageCalls:0,cases:[]};
 try{
 for(const length of [0,1000,20000,100000]){
  const value='x'.repeat(length),baseline='y'.repeat(length);
  const snapshot={format:1,actor:'synthetic-actor',workspace:'synthetic-workspace',record:'synthetic-record',field:'description',writer:'synthetic-writer',updatedAt:'2026-09-23T12:00:00.000Z',value,baseline,version:'2026-09-23T11:59:00.000Z'};
  const control=[],serialized=[],checkpoint=[],fresh=[];
  for(let round=0;round<100;round++){
   let start=performance.now();const retained={...snapshot};void retained.value;control.push(performance.now()-start);
   start=performance.now();const encoded=JSON.stringify(snapshot);serialized.push(performance.now()-start);
   start=performance.now();localStorage.setItem(key,encoded);checkpoint.push(performance.now()-start);
   start=performance.now();localStorage.setItem(hint,'1');localStorage.setItem(key,JSON.stringify(snapshot));fresh.push(performance.now()-start);
   if(round%10===9) await new Promise(resolve=>setTimeout(resolve,0));
  }
  result.cases.push({textChars:length,encodedBytes:new Blob([JSON.stringify(snapshot)]).size,control:{median:percentile(control,.5),p95:percentile(control,.95),max:Math.max(...control)},serialize:{median:percentile(serialized,.5),p95:percentile(serialized,.95),max:Math.max(...serialized)},existingWriterCheckpoint:{median:percentile(checkpoint,.5),p95:percentile(checkpoint,.95),max:Math.max(...checkpoint)},firstCheckpointIncludingHint:{median:percentile(fresh,.5),p95:percentile(fresh,.95),max:Math.max(...fresh)}});
 }
 out.textContent=JSON.stringify(result,null,2);
 const saved=await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)}).then(response=>response.json());
 out.textContent+='\\nEvidence: '+saved.file;
 }catch(error){out.textContent=JSON.stringify({error:String(error),result},null,2)}finally{localStorage.removeItem(key);localStorage.removeItem(hint);button.disabled=false}
};
</script>`;
http.createServer(async(req,res)=>{
 if(req.url==='/result'&&req.method==='POST'){
  let body='';for await(const chunk of req){body+=chunk;if(body.length>100000){res.writeHead(413).end();return}}
  try{const result=JSON.parse(body);if(result.samples!==100||!Array.isArray(result.cases)||result.cases.length!==4)throw Error('Invalid synthetic result');
   const file='/private/tmp/be-consolidation-evidence/draft-checkpoint-'+Date.now()+'.json';await writeFile(file,JSON.stringify(result,null,2));res.setHeader('content-type','application/json');res.end(JSON.stringify({file}));
  }catch{res.writeHead(400).end()}return;
 }
 if(req.url!=='/'){res.writeHead(404).end();return}res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');res.end(html)
}).listen(57670,'127.0.0.1',()=>process.stdout.write('http://127.0.0.1:57670/\n'));
