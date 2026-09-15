import { GetObjectCommand } from '@aws-sdk/client-s3'
import { requireWorkspace } from '@/lib/workspaces'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getR2Client,getR2BucketName } from '@/lib/onboarding/uploads'
import { isSopId } from '@/lib/sops/records-policy'
export const dynamic='force-dynamic'
export async function GET(request:Request,{params}:{params:Promise<{workspaceSlug:string;assetId:string}>}){
 const {workspaceSlug,assetId}=await params,{workspace,user}=await requireWorkspace(workspaceSlug)
 const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}
 if(!isSopId(assetId))return new Response('Image unavailable',{status:404,headers})
 const access=await supabaseAdmin.rpc('workspace_user_can_access_asset',{p_workspace_id:workspace.id,p_asset_id:assetId,p_user_id:user.id})
 if(access.error||access.data!==true)return new Response('Image unavailable',{status:404,headers})
 const read=await supabaseAdmin.from('sop_extracted_images').select('sop_id,extraction_id,content_hash').eq('workspace_id',workspace.id).eq('asset_id',assetId).maybeSingle()
 if(read.error||!read.data)return new Response('Image unavailable',{status:404,headers})
 const i=read.data
 if(!isSopId(i.sop_id)||!isSopId(i.extraction_id)||! /^[a-f0-9]{64}$/.test(i.content_hash))return new Response('Image unavailable',{status:404,headers})
 const suffix=new URL(request.url).searchParams.get('thumbnail')==='1'?'.thumbnail':''
 try{const object=await getR2Client().send(new GetObjectCommand({Bucket:getR2BucketName(),Key:`${workspace.id}/sops/${i.sop_id}/extractions/${i.extraction_id}/${i.content_hash}.webp${suffix}`}),{abortSignal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)])})
 if(!object.Body)return new Response('Image unavailable',{status:404,headers})
 return new Response(object.Body.transformToWebStream(),{headers:{...headers,'Content-Type':'image/webp','Content-Disposition':'inline',...(object.ContentLength?{'Content-Length':String(object.ContentLength)}:{})}})
 }catch{return new Response('Image unavailable',{status:503,headers})}
}
