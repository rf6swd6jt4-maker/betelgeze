import 'server-only'
import {randomUUID,createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {join} from 'node:path'
import {CopyObjectCommand,GetObjectCommand,HeadObjectCommand,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3'
import {getSignedUrl} from '@aws-sdk/s3-request-presigner'
import {supabaseAdmin} from '@/lib/supabase/admin'
import {getR2Client,getR2BucketName} from '@/lib/onboarding/uploads'
import {ensurePlatformDirectUploads} from '@/lib/onboarding/r2-cors'
import {getRequiredEnv} from '@/lib/env'
import {validSopAssetHeader} from '@/lib/sops/asset-ticket'
import {documentFile,documentDescription,readDocumentTicket,signDocumentTicket,type DocumentTicket} from './policy'
const path=(t:DocumentTicket)=>`${t.workspaceId}/relationship-context/${t.relationshipId}/${t.id}/pending`
export async function relationshipAssetList(w:string,r:string){
 const q=await supabaseAdmin.from('relationship_context_assets').select('asset_id,title,description,content_type,file_size,created_at').eq('workspace_id',w).eq('relationship_id',r).is('detached_at',null).order('created_at',{ascending:false}).limit(20)
 if(q.error)throw new Error('Could not load relationship assets.');return q.data
}
export async function prepareRelationshipAsset(w:string,r:string,u:string,value:unknown){
 const p=value as {file:unknown;description:unknown};const ticket:DocumentTicket={id:randomUUID(),workspaceId:w,relationshipId:r,userId:u,file:documentFile(p?.file),description:documentDescription(p?.description),expires:Date.now()+86400000}
 await ensurePlatformDirectUploads()
 const uploadUrl=await getSignedUrl(getR2Client(),new PutObjectCommand({Bucket:getR2BucketName(),Key:path(ticket),ContentType:ticket.file.type,ContentLength:ticket.file.size}),{expiresIn:900})
 return {uploadUrl,file:ticket.file,receipt:signDocumentTicket(ticket,getRequiredEnv('R2_SECRET_ACCESS_KEY'))}
}
function extract(bytes:Buffer,type:string):Promise<string>{return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['--max-old-space-size=256',join(process.cwd(),'lib/relationship-assets/extract-text.mjs'),type==='application/pdf'?'pdf':type.includes('wordprocessingml')?'docx':'text'],{stdio:['pipe','pipe','pipe'],env:{NODE_ENV:'production',PATH:process.env.PATH??'',TZ:'UTC'}})
 let output='',error='',done=false
 const fail=(message:string)=>{if(done)return;done=true;clearTimeout(timer);child.kill('SIGKILL');reject(new Error(message))}
 const timer=setTimeout(()=>fail('Document reading timed out; split the file and retry.'),60000)
 child.stdout.on('data',c=>{output+=c.toString();if(output.length>500000)fail('Document text is too large.')});child.stderr.on('data',c=>{error=(error+c.toString()).slice(-400)})
 child.on('error',()=>fail('Document reader could not start.'));child.stdin.on('error',()=>{})
 child.on('close',code=>{if(done)return;done=true;clearTimeout(timer);if(code!==0){reject(new Error(error||'Document could not be read.'));return}try{const result=JSON.parse(output);if(typeof result.text!=='string'||result.text.length>65000)throw new Error();resolve(result.text)}catch{reject(new Error('Invalid document text.'))}});child.stdin.end(bytes)
})}
export async function finishRelationshipAsset(w:string,r:string,u:string,receipt:unknown){
 const t=readDocumentTicket(receipt,getRequiredEnv('R2_SECRET_ACCESS_KEY'),w,r,u)
 const existing=await supabaseAdmin.from('relationship_context_assets').select('asset_id,detached_at').eq('workspace_id',w).eq('relationship_id',r).eq('asset_id',t.id).maybeSingle()
 if(existing.error)throw new Error('Could not confirm upload status.')
 if(existing.data){if(existing.data.detached_at)throw new Error('This asset was removed; select the file again.');return t.id}
 const client=getR2Client(),Bucket=getR2BucketName(),Key=path(t),signal=AbortSignal.timeout(25000)
 const head=await client.send(new HeadObjectCommand({Bucket,Key}),{abortSignal:signal})
 if(head.ContentLength!==t.file.size||head.ContentType!==t.file.type||!head.ETag)throw new Error('Upload incomplete; retry saving.')
 const object=await client.send(new GetObjectCommand({Bucket,Key,IfMatch:head.ETag}),{abortSignal:signal})
 const bytes=Buffer.from(await object.Body!.transformToByteArray())
 if(bytes.length!==t.file.size||!validSopAssetHeader(t.file.type,bytes.subarray(0,1024)))throw new Error('File content does not match its format.')
 const hash=createHash('sha256').update(bytes).digest('hex'),text=await extract(bytes,t.file.type)
 const finalPath=`${w}/relationship-context/${r}/${t.id}/${hash}/original`
 await client.send(new CopyObjectCommand({Bucket,Key:finalPath,CopySource:`${Bucket}/${Key}`,CopySourceIfMatch:head.ETag}),{abortSignal:AbortSignal.timeout(25000)})
 const result=await supabaseAdmin.rpc('attach_relationship_context_asset',{p_workspace:w,p_relationship:r,p_actor:u,p_asset:t.id,p_title:t.file.name,p_description:t.description,p_type:t.file.type,p_size:t.file.size,p_path:finalPath,p_hash:hash,p_text:text})
 if(result.error)throw new Error(result.error.code==='P0001'?result.error.message:'Could not attach the document; retry saving.')
 await client.send(new DeleteObjectCommand({Bucket,Key}),{abortSignal:AbortSignal.timeout(5000)}).catch(()=>undefined)
 return t.id
}
export async function relationshipAssetUrl(w:string,r:string,id:string){
 const q=await supabaseAdmin.from('relationship_context_assets').select('storage_path,title').eq('workspace_id',w).eq('relationship_id',r).eq('asset_id',id).is('detached_at',null).maybeSingle()
 if(q.error||!q.data)throw new Error('Asset not found.')
 if(!q.data.storage_path.startsWith(`${w}/relationship-context/${r}/${id}/`))throw new Error('Invalid asset location.')
 return getSignedUrl(getR2Client(),new GetObjectCommand({Bucket:getR2BucketName(),Key:q.data.storage_path,ResponseContentType:'application/octet-stream',ResponseContentDisposition:`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(q.data.title).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`}),{expiresIn:60})
}
