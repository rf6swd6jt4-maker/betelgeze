import {relationshipAssetAccess,relationshipAssetOrigin} from '@/lib/relationship-assets/authorization'
import {relationshipAssetUrl} from '@/lib/relationship-assets/server'
import {documentDescription} from '@/lib/relationship-assets/policy'
import {supabaseAdmin} from '@/lib/supabase/admin'
import {sopPayload,sopPrivateHeaders,sopError} from '@/lib/sops/http'
export const dynamic='force-dynamic'
type Context={params:Promise<{workspaceSlug:string;relationshipId:string;assetId:string}>}
export async function GET(_request:Request,{params}:Context){const p=await params;try{const {workspace}=await relationshipAssetAccess(p.workspaceSlug,p.relationshipId);return new Response(null,{status:303,headers:{...sopPrivateHeaders,Location:await relationshipAssetUrl(workspace.id,p.relationshipId,p.assetId)}})}catch{return new Response('Asset unavailable',{status:404,headers:sopPrivateHeaders})}}
export async function PATCH(request:Request,{params}:Context){
 if(!relationshipAssetOrigin(request))return new Response(null,{status:403})
 const p=await params
 try{const {workspace,user}=await relationshipAssetAccess(p.workspaceSlug,p.relationshipId,true);const body=await sopPayload(request)
 const description=documentDescription(body?.description),expected=documentDescription(body?.expectedDescription)
 const q=await supabaseAdmin.rpc('edit_relationship_context_asset',{p_workspace:workspace.id,p_relationship:p.relationshipId,p_actor:user.id,p_asset:p.assetId,p_description:description,p_remove:body?.remove===true,p_expected_description:expected})
 if(q.error)throw new Error(q.error.code==='P0001'?q.error.message:'Could not save asset changes.')
 return Response.json({ok:true},{headers:sopPrivateHeaders})
 }catch(e){return sopError(e,'Could not update document.')}
}
