import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {ZipWriter,Uint8ArrayWriter,TextReader} from '@zip.js/zip.js'
import {pdfFixture} from './sop-image-extraction.test.mjs'
function read(bytes,type){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['lib/relationship-assets/extract-text.mjs',type]);let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('close',code=>code?reject(new Error(err)):resolve(JSON.parse(out)));child.stdin.end(bytes)})}
test('context extractor reads text and PDF and rejects oversized context',async()=>{assert.equal((await read(Buffer.from('Current website facts.'),'text')).text,'Current website facts.');assert.match((await read(pdfFixture(),'pdf')).text,/Verify the tracking settings/);await assert.rejects(read(Buffer.from('x'.repeat(61000)),'text'),/60,000/);await assert.rejects(read(Buffer.from([0xff]),'text'),/encoded|encoding/i)})
test('context DOCX extraction preserves text order and tables without executing document instructions',async()=>{const zip=new ZipWriter(new Uint8ArrayWriter());await zip.add('word/document.xml',new TextReader('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Old website brief.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Booking page missing.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'));const result=await read(Buffer.from(await zip.close()),'docx');assert.equal(result.text,'Old website brief.\nBooking page missing.')})
