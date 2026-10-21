// Isolated SQL plus actual reference/preview/download adapters; storage is synthetic.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {portalAssetFixture} from './validate-portal-upload-team-access.mjs'
import {id,workspace as w,users} from './validate-workspace-search-capability.mjs'
import {repositoryRoot as root} from './pglite-fixture.mjs'
const require=createRequire(root+'package.json'),ts=require('typescript')
const {db,query:q,actor,references,withRole}=await portalAssetFixture()
async function load(path,mocks){const exports={};const code=ts.transpileModule(await readFile(root+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',code)(name=>{assert.ok(name in mocks,`Unexpected import ${name}`);return mocks[name]},exports);return exports}
try{
 const downloads=await load('lib/assets/download.ts',{}),signed=[]
 const transfer=await load('lib/assets/download-response.ts',{'server-only':{},'./download':downloads,'@/lib/onboarding/uploads':{createPrivateResourceDownloadUrl:async(path,name)=>{signed.push({path,name});return 'https://fixture.invalid/private-original'}}})
 const preview=await load('lib/assets/preview.ts',{'server-only':{},'@/lib/onboarding/uploads':{createPrivateUploadSignedUrl:async path=>{signed.push({path,preview:true});return 'https://fixture.invalid/private-preview'}}})
 const formatting=await load('lib/chat-formatting.ts',{})
 const referenceModule=await load('lib/communications/references-server.ts',{'server-only':{},'@/lib/communications/references':formatting,'@/lib/relationships':{assetHref:(slug,asset)=>`/${slug}/assets/${asset}`,fulfilmentDetailHref:()=>'',onboardingDetailHref:()=>'',relationshipHubHref:()=>'',workItemHref:()=>''},'@/lib/supabase/admin':{supabaseAdmin:{rpc:(_name,args)=>withRole('service_role',async()=>({data:await references(args.p_user_id,{refs:args.p_references,conversation:args.p_conversation_id,slug:args.p_workspace_slug}),error:null}))}}})
 let currentUser=users.ordinary
 const getAsset=async(workspace,asset)=>actor(currentUser,async()=>(await q('select * from assets where workspace_id=$1 and id=$2',[workspace,asset])).rows[0]??null)
 const route=await load('app/api/workspaces/[workspaceSlug]/assets/[assetId]/download/route.ts',{'@/lib/workspace-access':{requireWorkspaceAccess:async()=>({workspace:{id:w},access:{}}),workspaceAccessHasCapability:()=>true},'@/lib/supabase/server':{createSupabaseServerClient:async()=>({})},'@/lib/relationships':{getAsset},'@/lib/assets/download-response':transfer})
 const request=new Request(`https://fixture.invalid/api/workspaces/synthetic/assets/${id(500)}/download`),context={params:Promise.resolve({workspaceSlug:'synthetic',assetId:id(500)})}
 for(const user of [users.partial,users.ordinary]){
  currentUser=user
  const resolved=await referenceModule.readCommunicationReferences({workspaceSlug:'synthetic',userId:user,conversationId:id(200),references:[{type:'asset',id:id(500)}]})
  assert.equal(resolved.results[0].href,`/synthetic/assets/${id(500)}`)
  const asset=await getAsset(w,id(500));assert.ok(asset)
  assert.equal(await preview.assetPreviewUrl(w,'synthetic',asset),'https://fixture.invalid/private-preview')
  const response=await route.GET(request,context);assert.equal(response.status,303);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('location'),'https://fixture.invalid/private-original')
 }
 assert.equal(signed.length,4)
 currentUser=users.other;assert.equal((await route.GET(request,context)).status,404);assert.equal(signed.length,4)
 currentUser=users.ordinary
 await q('delete from workspace_team_members where team_id=$1 and user_id=$2',[id(100),currentUser])
 assert.equal((await route.GET(request,context)).status,404);assert.equal(signed.length,4)
 await assert.rejects(referenceModule.readCommunicationReferences({workspaceSlug:'synthetic',userId:currentUser,conversationId:id(200),references:[{type:'asset',id:id(500)}]}),e=>e.status===403)
 console.log('PASS actual reference adapter -> current-viewer SQL -> asset RLS -> private preview/download; wrong team and revoked membership cannot sign originals')
} finally{await db.close()}
