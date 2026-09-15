// Runs in a short-lived child process without application credentials.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js'
import { XMLParser } from 'fast-xml-parser'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { imageSize } from 'image-size'

const MAX_IMAGES=80, MAX_BYTES=24*1024*1024, MAX_PIXELS=16_000_000
const images=[], warnings=[]; let outputBytes=0
const text = value => String(value??'').replace(/\s+/g,' ').trim()
async function retain(canvas, location, context, method, ordinal, attachable=true) {
  if(images.length>=MAX_IMAGES)throw new Error('This source exceeds the 80-image limit. Split the document before extraction.')
  const bytes=await canvas.encode('webp',90)
  outputBytes+=bytes.length
  if(outputBytes>MAX_BYTES)throw new Error('Extracted images exceed the storage limit. Split the document.')
  const thumbnail=createCanvas(Math.min(400,canvas.width),Math.max(1,Math.round(canvas.height*Math.min(400/canvas.width,1))))
  thumbnail.getContext('2d').drawImage(canvas,0,0,thumbnail.width,thumbnail.height)
  images.push({ordinal,attachable,location,context:text(context).slice(0,2000),method,width:canvas.width,height:canvas.height,hash:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64'),thumbnail:(await thumbnail.encode('webp',75)).toString('base64')})
}
async function pdf(bytes) {
  const require=createRequire(import.meta.url), root=dirname(require.resolve('pdfjs-dist/package.json'))
  const pdfjs=await import(pathToFileURL(join(root,'legacy/build/pdf.mjs')).href)
  const loading=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,standardFontDataUrl:join(root,'standard_fonts/'),cMapUrl:join(root,'cmaps/'),cMapPacked:true,wasmUrl:join(root,'wasm/'),maxImageSize:MAX_PIXELS,stopAtErrors:true,verbosity:0})
  const doc=await loading.promise
  try {
    if(doc.numPages>80)throw new Error('This source exceeds the 80-page limit. Split the document before extraction.')
    for(let n=1;n<=doc.numPages;n++){
      const page=await doc.getPage(n), ops=await page.getOperatorList()
      const visualOps=['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintImageXObjectRepeat','paintImageMaskXObjectRepeat','shadingFill','constructPath'].map(k=>pdfjs.OPS[k]).filter(x=>x!==undefined)
      if(!ops.fnArray.some(op=>visualOps.includes(op))){page.cleanup();continue}
      const native=page.getViewport({scale:1}), scale=Math.min(2,2400/Math.max(native.width,native.height))
      const viewport=page.getViewport({scale}), width=Math.ceil(viewport.width),height=Math.ceil(viewport.height)
      if(width*height>MAX_PIXELS)throw new Error('A source page is too large to render safely.')
      const canvas=createCanvas(width,height)
      await page.render({canvasContext:canvas.getContext('2d'),canvas,viewport}).promise
      const content=await page.getTextContent()
      await retain(canvas,`Page ${n}`,content.items.map(i=>i.str??'').join(' '),'pdf_page',n)
      canvas.width=1;canvas.height=1;page.cleanup()
    }
    if(images.length)warnings.push('PDF visual references preserve the whole rendered page, including captions and annotations. Decorative-only pages should not be attached to work.')
  } finally {await loading.destroy()}
}
function nodes(tree,name,result=[]){for(const node of tree??[]){for(const [key,value] of Object.entries(node)){if(key===name)result.push(node);if(Array.isArray(value))nodes(value,name,result)}}return result}
function contentText(tree){return nodes(tree,'w:t').map(n=>n['w:t'].map(v=>v['#text']??'').join('')).join(' ')}
async function docx(bytes){
  const zip=new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)),{useWebWorkers:false})
  try{
    const entries=await zip.getEntries()
    if(entries.length>3000||entries.reduce((n,e)=>n+e.uncompressedSize,0)>100*1024*1024)throw new Error('The DOCX expands beyond the extraction limit.')
    const byName=new Map(entries.map(e=>[e.filename,e]))
    const read=async(name,max=5*1024*1024)=>{const e=byName.get(name);if(!e||e.directory)return null;if(e.encrypted||e.uncompressedSize>max)throw new Error('A DOCX part exceeds the extraction limit.');return Buffer.from(await e.getData(new Uint8ArrayWriter()))}
    const document=await read('word/document.xml'),rels=await read('word/_rels/document.xml.rels')
    if(!document||!rels)throw new Error('The DOCX document or image relationships are missing.')
    const xml=document.toString('utf8'), relationships=rels.toString('utf8')
    if(/<!DOCTYPE|<!ENTITY/i.test(xml+relationships))throw new Error('Unsupported XML declarations in DOCX.')
    const parser=new XMLParser({ignoreAttributes:false,preserveOrder:true,processEntities:false,parseTagValue:false})
    const tree=parser.parse(xml), relationTree=parser.parse(relationships), links=new Map(nodes(relationTree,'Relationship').map(n=>[n[':@']?.['@_Id'],n[':@']]))
    const complexDrawing=/<(?:w:pict|wpg:|wps:|c:chart)|<a:xfrm[^>]*\b(?:rot|flipH|flipV)=/.test(xml)
    const paragraphs=nodes(tree,'w:p');let ordinal=0,heading=''
    for(let p=0;p<paragraphs.length;p++){
      const paragraph=paragraphs[p]['w:p'], surrounding=[heading,contentText(paragraphs[p-1]?.['w:p']),contentText(paragraph),contentText(paragraphs[p+1]?.['w:p'])].filter(Boolean).join(' ')
      if(nodes(paragraph,'w:pStyle').some(n=>/heading/i.test(n[':@']?.['@_w:val']??'')))heading=contentText(paragraph)
      for(const picture of nodes(paragraph,'pic:pic')){
        const blip=nodes(picture['pic:pic'],'a:blip')[0]?.[':@'], link=links.get(blip?.['@_r:embed'])
        if(!link||link['@_TargetMode']==='External'){warnings.push('An external or missing image was not fetched.');continue}
        const name=posix.normalize(posix.join('word',link['@_Target']??''))
        if(!name.startsWith('word/media/')||!/^word\/media\/[^/]+\.(png|jpe?g|webp|gif)$/i.test(name)){warnings.push('An unsupported drawing format remains in the original DOCX.');continue}
        const data=await read(name,12*1024*1024);if(!data){warnings.push('An embedded image is missing.');continue}
        const dimensions=imageSize(data)
        if(!dimensions.width||!dimensions.height||dimensions.width*dimensions.height>MAX_PIXELS)throw new Error('A DOCX image exceeds the pixel limit.')
        const img=await loadImage(data)
        if(img.width*img.height>MAX_PIXELS)throw new Error('A DOCX image exceeds the pixel limit.')
        const crop=nodes(picture['pic:pic'],'a:srcRect')[0]?.[':@']??{}
        const edge=k=>Math.max(0,Math.min(.95,Number(crop['@_'+k]??0)/100000))
        const left=edge('l'),top=edge('t'),w=1-left-edge('r'),h=1-top-edge('b')
        if(w<=0||h<=0){warnings.push('An image has unsupported cropping.');continue}
        const sw=img.width*w,sh=img.height*h,scale=Math.min(1,2400/Math.max(sw,sh)),canvas=createCanvas(Math.max(1,Math.round(sw*scale)),Math.max(1,Math.round(sh*scale)))
        canvas.getContext('2d').drawImage(img,img.width*left,img.height*top,sw,sh,0,0,canvas.width,canvas.height)
        const label=nodes(paragraph,'wp:docPr')[0]?.[':@']
        await retain(canvas,`${heading?heading+' · ':''}Paragraph ${p+1}`,surrounding+' '+(label?.['@_descr']??''),'docx_image',++ordinal,!complexDrawing)
        canvas.width=1;canvas.height=1
      }
    }
    if(complexDrawing)warnings.push('This DOCX contains shapes, charts, rotations or overlays that cannot be reproduced faithfully. Extracted pictures are preview-only and cannot be attached by AI. Use a PDF export to preserve the complete visual instructions.')
    if(nodes(tree,'a:blip').length>images.length)warnings.push('Some document images could not be extracted as standalone pictures; check the original source.')
  }finally{await zip.close()}
}
let size=0;const chunks=[]
for await(const chunk of process.stdin){size+=chunk.length;if(size>21*1024*1024)throw new Error('Source exceeds the 20 MB extraction limit.');chunks.push(chunk)}
try{const bytes=Buffer.concat(chunks);if(process.argv[2]==='pdf')await pdf(bytes);else await docx(bytes);process.stdout.write(JSON.stringify({images,warnings:[...new Set(warnings)]}))}
catch(error){process.stderr.write(error instanceof Error?error.message.slice(0,300):'Document extraction failed.');process.exitCode=1}
