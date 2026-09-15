import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { createCanvas,loadImage } from '@napi-rs/canvas'
import { ZipWriter,Uint8ArrayWriter,TextReader,Uint8ArrayReader } from '@zip.js/zip.js'
import { fileURLToPath } from 'node:url'
const script=fileURLToPath(new URL('../lib/sops/extract-document.mjs',import.meta.url))
function extract(bytes,type){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[script,type],{stdio:['pipe','pipe','pipe']}),out=[],err=[];const timeout=setTimeout(()=>child.kill('SIGKILL'),15000);child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);if(code===0)resolve(JSON.parse(Buffer.concat(out).toString()));else reject(new Error(Buffer.concat(err).toString()))});child.stdin.end(bytes)})}
export function pdfFixture(withNull=false){
 const pixels=deflateSync(Buffer.from(Array.from({length:30*20},()=>[40,120,220]).flat()))
 const stream=Buffer.from(('q 120 0 0 80 70 500 cm /Im1 Do Q\n1 0 0 RG 4 w 200 540 m 260 540 l S\nBT /F1 18 Tf 60 470 Td (Verify the tracking settings shown above) Tj ET').replace('settings shown',withNull?'settings\x00 shown':'settings shown'))
 const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> /Font << /F1 6 0 R >> >> /Contents 5 0 R >>'),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 30 /Height 20 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`),pixels,Buffer.from('\nendstream')]),Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from('\nendstream')]),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')]
 const chunks=[Buffer.from('%PDF-1.7\n')],offsets=[0];let size=chunks[0].length
 for(const [i,o]of objects.entries()){offsets.push(size);const b=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),o,Buffer.from('\nendobj\n')]);chunks.push(b);size+=b.length}
 chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`));return Buffer.concat(chunks)
}
export async function docxFixture(count=2,external=false,complex=false,heading='Configure conversion tracking'){
 const canvas=createCanvas(160,100),ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,80,100);ctx.fillStyle='blue';ctx.fillRect(80,0,80,100)
 const writer=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false})
 const image=`<w:drawing><wp:inline><wp:docPr id="1" descr="Tracking settings reference"/><a:graphic><a:graphicData><pic:pic>${complex?'<pic:spPr><a:xfrm rot="5400000"/></pic:spPr>':''}<pic:blipFill><a:blip r:embed="rId1"/><a:srcRect l="50000"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
 await writer.add('word/document.xml',new TextReader(`<w:document xmlns:w="word" xmlns:wp="drawing" xmlns:a="drawingml" xmlns:pic="picture" xmlns:r="relationships"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${heading}</w:t></w:r></w:p>${Array.from({length:count},(_,i)=>`<w:p><w:r><w:t>Verify tracking setting ${i+1} using this screenshot.</w:t>${image}</w:r></w:p>`).join('')}</w:body></w:document>`))
 await writer.add('word/_rels/document.xml.rels',new TextReader(`<Relationships><Relationship Id="rId1" Target="${external?'https://invalid.example/private':'media/image.png'}"${external?' TargetMode="External"':''}/></Relationships>`))
 await writer.add('word/media/image.png',new Uint8ArrayReader(await canvas.encode('png')))
 return Buffer.from(await writer.close())
}
test('PDF extraction preserves the image, outside annotation and readable source context',async()=>{
 const output=await extract(pdfFixture(),'pdf');assert.equal(output.images.length,1);const picture=output.images[0];assert.equal(picture.method,'pdf_page');assert.equal(picture.location,'Page 1');assert.match(picture.context,/Verify the tracking settings/)
 const image=await loadImage(Buffer.from(picture.data,'base64')),canvas=createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0)
 const pixel=canvas.getContext('2d').getImageData(440,504,1,1).data;assert.ok(pixel[0]>180&&pixel[1]<90,'red annotation outside embedded image is preserved')
})
test('DOCX extracts cropped images with separate occurrence context and repeatable hashes',async()=>{
 const bytes=await docxFixture(),a=await extract(bytes,'docx'),b=await extract(bytes,'docx');assert.equal(a.images.length,2);assert.equal(a.images[0].width,80);assert.equal(a.images[0].height,100);assert.notEqual(a.images[0].ordinal,a.images[1].ordinal);assert.equal(a.images[0].hash,a.images[1].hash);assert.equal(a.images[0].hash,b.images[0].hash);assert.match(a.images[0].context,/Configure conversion tracking/)
 const img=await loadImage(Buffer.from(a.images[0].data,'base64')),c=createCanvas(80,100);c.getContext('2d').drawImage(img,0,0);assert.ok(c.getContext('2d').getImageData(40,50,1,1).data[2]>180,'visible blue crop retained')
})
test('external DOCX images are never fetched and limits fail explicitly',async()=>{
 const external=await extract(await docxFixture(1,true),'docx');assert.equal(external.images.length,0);assert.match(external.warnings.join(' '),/external/)
 await assert.rejects(extract(await docxFixture(81),'docx'),/80-image limit/)
 await assert.rejects(extract(Buffer.from('not a pdf'),'pdf'),/PDF|document/i)
})

test('DOCX with unreproduced transformations keeps previews but forbids AI attachment',async()=>{
 const output=await extract(await docxFixture(1,false,true),'docx');assert.equal(output.images.length,1);assert.equal(output.images[0].attachable,false);assert.match(output.warnings.join(' '),/preview-only/)
})

test('PDF control characters are removed before PostgreSQL JSON storage',async()=>{
 const output=await extract(pdfFixture(true),'pdf');assert.equal(output.images.length,1);assert.ok(!output.images[0].context.includes(String.fromCharCode(0)));assert.match(output.images[0].context,/settings shown above/)
})

test('DOCX context truncation preserves valid Unicode at the database boundary',async()=>{
 const output=await extract(await docxFixture(1,false,false,'A'.repeat(1999)+'😀'),'docx');assert.equal(Array.from(output.images[0].context).length,2000);assert.ok(output.images[0].context.endsWith('😀'));assert.doesNotMatch(output.images[0].context,/\p{Cs}/u)
})
