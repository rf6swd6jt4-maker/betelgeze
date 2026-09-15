import 'server-only'
import { spawn } from 'node:child_process'
import { createHash,randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { GetObjectCommand,PutObjectCommand } from '@aws-sdk/client-s3'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getR2Client,getR2BucketName } from '@/lib/onboarding/uploads'
import { getSopAsset } from './records'
import { assertSopAssetPath } from './assets'
export const EXTRACTION_VERSION='sop-images-v1'
export const supportsExtraction=(type:string)=>['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(type)
export type ExtractedImage={asset_id:string;attachable:boolean;ordinal:number;location:string;context:string;method:string;width:number;height:number;content_hash:string;extraction_id:string}
type Extracted={attachable:boolean;ordinal:number;location:string;context:string;method:string;width:number;height:number;hash:string;data:string;thumbnail:string}
type Job={id:string;workspace_id:string;sop_id:string;asset_id:string;requested_by:string;source_path:string;lease_token:string}
export async function readSopExtraction(workspaceId:string,sopId:string,assetId:string){
 const result=await supabaseAdmin.from('sop_asset_extractions').select('id,status,source_hash,image_count,warnings,error_summary,updated_at').eq('workspace_id',workspaceId).eq('sop_id',sopId).eq('asset_id',assetId).eq('extractor_version',EXTRACTION_VERSION).maybeSingle()
 if(result.error)throw new Error('Could not read image extraction.')
 return result.data
}
export async function readExtractedImages(workspaceId:string,assetId:string){
 const result=await supabaseAdmin.from('sop_extracted_images').select('asset_id,attachable,ordinal,location,context,method,width,height,content_hash,extraction_id').eq('workspace_id',workspaceId).eq('source_asset_id',assetId).order('ordinal').limit(80)
 if(result.error)throw new Error('Could not load extracted images.')
 return result.data as ExtractedImage[]
}
export async function queueSopExtraction(workspaceId:string,userId:string,sopId:string,assetId:string,retry=false){
 const result=await supabaseAdmin.rpc('queue_sop_extraction',{p_workspace:workspaceId,p_actor:userId,p_sop:sopId,p_asset:assetId,p_retry:retry})
 if(result.error)throw new Error(result.error.code==='P0001'?result.error.message:'Could not queue image extraction.')
 return result.data as string|null
}
export function extractDocument(bytes:Buffer,type:string):Promise<{images:Extracted[];warnings:string[]}>{
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=256',join(process.cwd(),'lib/sops/extract-document.mjs'),type==='application/pdf'?'pdf':'docx'],{stdio:['pipe','pipe','pipe'],env:{NODE_ENV:'production',PATH:process.env.PATH??'',TZ:'UTC'}})
  const chunks:Buffer[]=[];let size=0,stderr='',settled=false
  const fail=(message:string)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill('SIGKILL');reject(new Error(message))}
  const timer=setTimeout(()=>fail('Image extraction exceeded its time limit. Split the document and retry.'),85000)
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>36*1024*1024)fail('Image extraction output exceeded its limit.');else chunks.push(chunk)})
  child.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-1000)})
  child.on('error',()=>fail('Image extraction could not start.'))
  child.stdin.on('error',()=>{ /* The exit event reports a parser failure. */ })
  child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);if(code!==0){reject(new Error(/(limit|exceed|Split|missing|unsupported)/i.test(stderr)?stderr.slice(-300):'The document could not be extracted. Check the original file.'));return}try{const result=JSON.parse(Buffer.concat(chunks).toString());if(!Array.isArray(result.images)||result.images.length>80||!Array.isArray(result.warnings))throw new Error();resolve(result)}catch{reject(new Error('Invalid image extraction result.'))}})
  child.stdin.end(bytes)
 })
}
export async function processSopExtraction(id?:string){
 const claim=await supabaseAdmin.rpc('claim_sop_extraction',{p_id:id??null});if(claim.error)throw new Error('Could not claim image extraction.')
 const job=claim.data?.[0] as Job|undefined;if(!job)return {claimed:0}
 const deadline=Date.now()+150000
 const storageTimeout=()=>{const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Image extraction exceeded its time limit. Split the document and retry.');return AbortSignal.timeout(Math.min(15000,remaining))}
 let hash:string|null=null,images:object[]=[],warnings:string[]=[],error:string|null=null
 try{
  const access=await supabaseAdmin.rpc('assert_sop_admin',{p_workspace:job.workspace_id,p_actor:job.requested_by});if(access.error)throw new Error('SOP access was revoked.')
  const linked=await getSopAsset(job.workspace_id,job.sop_id,job.asset_id)
  if(!linked||linked.asset.storage_path!==job.source_path||!supportsExtraction(linked.asset.content_type)||linked.asset.file_size>20*1024*1024)throw new Error('The source changed or exceeds the extraction limit.')
  assertSopAssetPath(job.workspace_id,job.sop_id,job.asset_id,job.source_path)
  const client=getR2Client(),Bucket=getR2BucketName(),object=await client.send(new GetObjectCommand({Bucket,Key:job.source_path}),{abortSignal:AbortSignal.timeout(20000)})
  if(!object.Body||object.ContentLength!==linked.asset.file_size)throw new Error('The source download was incomplete.')
  const bytes=Buffer.from(await object.Body.transformToByteArray());if(bytes.length!==linked.asset.file_size)throw new Error('The source download was incomplete.')
  hash=createHash('sha256').update(bytes).digest('hex')
  const result=await extractDocument(bytes,linked.asset.content_type);warnings=result.warnings
  const written=new Set<string>()
  for(const item of result.images){
   const data=Buffer.from(item.data,'base64'),thumbnail=Buffer.from(item.thumbnail,'base64')
   if(createHash('sha256').update(data).digest('hex')!==item.hash)throw new Error('Extracted image integrity failed.')
   const Key=`${job.workspace_id}/sops/${job.sop_id}/extractions/${job.id}/${item.hash}.webp`
   if(!written.has(item.hash)){for(const [key,body] of [[Key,data],[Key+'.thumbnail',thumbnail]] as const)await client.send(new PutObjectCommand({Bucket,Key:key,Body:body,ContentType:'image/webp',CacheControl:'private, max-age=3600'}),{abortSignal:storageTimeout()});written.add(item.hash)}
   images.push({id:randomUUID(),ordinal:item.ordinal,attachable:item.attachable===true,location:item.location.slice(0,300),context:item.context,method:item.method,width:item.width,height:item.height,hash:item.hash,size:data.length})
  }
 }catch(e){error=e instanceof Error&&/^(SOP access|The source|The document|Image extraction|Extracted image|Invalid image|This source|Extracted images|The DOCX|A DOCX|A source|Unsupported XML|An image)/.test(e.message)?e.message.slice(0,400):'Image extraction failed. Check the source file and retry.';images=[]}
 const finish=await supabaseAdmin.rpc('finish_sop_extraction',{p_id:job.id,p_lease:job.lease_token,p_hash:hash,p_images:images,p_warnings:warnings,p_error:error})
 if(finish.error||finish.data!==true)throw new Error('Image extraction completion was not confirmed.')
 return {claimed:1,ready:!error}
}
