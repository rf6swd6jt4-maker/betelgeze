import {relationshipAssetAccess,relationshipAssetOrigin} from '@/lib/relationship-assets/authorization'
import {relationshipAssetList,prepareRelationshipAsset,finishRelationshipAsset} from '@/lib/relationship-assets/server'
import {sopPayload,sopPrivateHeaders,sopError} from '@/lib/sops/http'
export const dynamic='force-dynamic'
export const maxDuration=180
type Context={params:Promise<{workspaceSlug:string;relationshipId:string}>}
export async function GET(_request:Request,{params}:Context){const p=await params;try{const {workspace}=await relationshipAssetAccess(p.workspaceSlug,p.relationshipId);return Response.json({items:await relationshipAssetList(workspace.id,p.relationshipId)},{headers:sopPrivateHeaders})}catch{return Response.json({error:'Could not load relationship assets.'},{status:403,headers:sopPrivateHeaders})}}
export async function POST(request:Request,{params}:Context){
 if(!relationshipAssetOrigin(request))return new Response(null,{status:403})
 const p=await params
 try{const {workspace,user}=await relationshipAssetAccess(p.workspaceSlug,p.relationshipId,true);const body=await sopPayload(request)
 if(body?.action==='prepare')return Response.json(await prepareRelationshipAsset(workspace.id,p.relationshipId,user.id,body),{headers:sopPrivateHeaders})
 if(body?.action==='finish')return Response.json({id:await finishRelationshipAsset(workspace.id,p.relationshipId,user.id,body.receipt)},{headers:sopPrivateHeaders})
 throw new Error('Unknown upload action.')
 }catch(e){return sopError(e,'Could not attach document.')}
}
