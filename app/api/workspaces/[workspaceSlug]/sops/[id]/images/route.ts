import { requireWorkspace } from '@/lib/workspaces'
import { canAddSop } from '@/lib/sops/policy'
import { isSopId } from '@/lib/sops/records-policy'
import { getSopAsset } from '@/lib/sops/records'
import { queueSopExtraction,readSopExtraction,readExtractedImages } from '@/lib/sops/extraction'
import { sopPayload,sopPrivateHeaders } from '@/lib/sops/http'
export const dynamic='force-dynamic'
type Context={params:Promise<{workspaceSlug:string;id:string}>}
export async function GET(request:Request,{params}:Context){
 const {workspaceSlug,id}=await params,{workspace,role}=await requireWorkspace(workspaceSlug)
 const assetId=new URL(request.url).searchParams.get('assetId')
 if(!canAddSop(role)||!isSopId(assetId)||!await getSopAsset(workspace.id,id,assetId))return Response.json({error:'SOP source unavailable'},{status:404,headers:sopPrivateHeaders})
 const extraction=await readSopExtraction(workspace.id,id,assetId)
 return Response.json({extraction,images:extraction?.status==='ready'?await readExtractedImages(workspace.id,assetId):[]},{headers:sopPrivateHeaders})
}
export async function POST(request:Request,{params}:Context){
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403,headers:sopPrivateHeaders})
 const {workspaceSlug,id}=await params,{workspace,user,role}=await requireWorkspace(workspaceSlug)
 if(!canAddSop(role))return Response.json({error:'Only admins can extract SOP images'},{status:403,headers:sopPrivateHeaders})
 try{const body=await sopPayload(request);if(!isSopId(body.assetId)||typeof body.retry!=='boolean')throw new Error('Invalid extraction request.');return Response.json({id:await queueSopExtraction(workspace.id,user.id,id,body.assetId,body.retry)},{status:202,headers:sopPrivateHeaders})}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Could not queue extraction'},{status:400,headers:sopPrivateHeaders})}
}
