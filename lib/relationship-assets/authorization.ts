import 'server-only'
import {requireWorkspaceAccess,requireRelationshipAccess} from '@/lib/workspace-access'
import {getRelationship} from '@/lib/relationships'
import {supabaseAdmin} from '@/lib/supabase/admin'
export async function relationshipAssetAccess(slug:string,id:string,edit=false){
 const auth=await requireWorkspaceAccess(slug);await requireRelationshipAccess(auth.access,id)
 const r=await getRelationship(auth.workspace.id,id);if(!r)throw new Error('Relationship not found.')
 if(edit){
  let allowed=auth.role==='owner'||auth.role==='admin'||r.seller_user_id===auth.user.id||r.fulfilment_manager_user_id===auth.user.id
  if(!allowed&&!r.pos_started_at){const q=await supabaseAdmin.rpc('workspace_user_can_sell',{p_workspace_id:auth.workspace.id,p_user_id:auth.user.id});allowed=!q.error&&q.data===true}
  if(!allowed||r.status==='archived')throw new Error('Only the relationship seller, manager or an admin can change assets.')
 }
 return auth
}

export function relationshipAssetOrigin(request:Request){return request.headers.get('origin')===new URL(request.url).origin&&request.headers.get('sec-fetch-site')!=='cross-site'}
