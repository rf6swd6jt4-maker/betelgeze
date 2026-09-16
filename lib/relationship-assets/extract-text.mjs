// Isolated parser: no application credentials, no remote document fetching.
import { createRequire } from 'node:module'
import { dirname,join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ZipReader,Uint8ArrayReader,TextWriter } from '@zip.js/zip.js'
import { XMLParser,XMLValidator } from 'fast-xml-parser'
const MAX=60000
const parts=[]
let length=0
function add(value){const s=String(value??'').replace(/[\p{Cc}\p{Cs}]/gu,' ').replace(/\s+/g,' ').trim();length+=s.length;if(length>MAX)throw new Error('Document exceeds 60,000 characters; split or shorten it.');if(s)parts.push(s)}
async function extract(bytes,type){
 if(type==='pdf'){
  const require=createRequire(import.meta.url), root=dirname(require.resolve('pdfjs-dist/package.json'))
  const pdf=await import(pathToFileURL(join(root,'legacy/build/pdf.mjs')).href)
  const task=pdf.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,verbosity:0})
  try{const doc=await task.promise;if(doc.numPages>80)throw new Error('PDF exceeds 80 pages; split it.');for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent();const text=content.items.map(x=>x.str??'').join(' ');if(text.trim().length<10)throw new Error(`Page ${i} has no readable text; upload a text-searchable PDF or DOCX.`);add(`Page ${i}: ${text}`);page.cleanup()}}finally{await task.destroy()}
 }else if(type==='docx'){
  const zip=new ZipReader(new Uint8ArrayReader(bytes));try{const entries=await zip.getEntries();if(entries.length>2000)throw new Error('Too many document parts.');const entry=entries.find(e=>e.filename==='word/document.xml');if(!entry||entry.uncompressedSize>4*1024*1024)throw new Error('Missing or oversized DOCX content.');const xml=await entry.getData(new TextWriter());if(xml.length>4*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Invalid DOCX content.');const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,processEntities:true}).parse(xml);function walk(nodes){for(const node of nodes??[])for(const [key,val]of Object.entries(node)){if(key==='w:t')add(val.map(v=>v['#text']??'').join(''));else if(Array.isArray(val))walk(val)}}walk(tree)}finally{await zip.close()}
 }else add(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
 const text=parts.join('\n');if(text.length<10)throw new Error('No readable document text; upload a text-searchable document.');return {text}
}
try{let size=0;const chunks=[];for await(const chunk of process.stdin){size+=chunk.length;if(size>20*1024*1024)throw new Error('Document exceeds 20 MB.');chunks.push(chunk)}process.stdout.write(JSON.stringify(await extract(Buffer.concat(chunks),process.argv[2])))}catch(error){process.stderr.write(error.message);process.exitCode=1}
