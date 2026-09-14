import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
const require = createRequire(import.meta.url)
function load(file: string, mocks: Record<string, unknown> = {}): Record<string, unknown> {
    const m = { exports: {} }
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function("require", "module", "exports", code)((name: string) => name in mocks ? mocks[name] : name === "server-only" ? {} : name.startsWith("./") ? load(path.join(path.dirname(file), name + ".ts"), mocks) : require(name), m, m.exports)
    return m.exports
}
const policy = load("lib/sops/records-policy.ts") as typeof import("../lib/sops/records-policy")
const tickets = load("lib/sops/asset-ticket.ts") as typeof import("../lib/sops/asset-ticket")
const interpretation = load("lib/sops/interpretation.ts") as typeof import("../lib/sops/interpretation")
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const file = { name: "Guidance.txt", size: 100, type: "text/plain" }
const ticket = { id: id(6), workspaceId: id(1), userId: id(2), sopId: id(3), file, role: "main" as const, notes: "Use after onboarding", expires: Date.now()+60_000 }
test("asset file policy supports documents, media and text with bounded sizes", () => {
    for (const name of ["SOP.docx","SOP.pdf","Shot.png","Shot.jpg","Clip.mov","Clip.mp4","Clip.webm","Notes.txt","Guide.md","Table.csv","Deck.pptx","Table.xlsx"]) assert.ok(policy.validateSopAsset({name,size:10,type:""}).type)
    for (const name of ["script.html","image.svg","archive.zip","macro.docm","../file.txt"]) assert.throws(()=>policy.validateSopAsset({name,size:10}))
    assert.throws(()=>policy.validateSopAsset({...file,size:0}))
    assert.throws(()=>policy.validateSopAsset({...file,size:51*1024*1024}))
    assert.doesNotThrow(()=>policy.validateSopAsset({name:"Demo.mp4",size:200*1024*1024}))
    assert.ok(policy.interpretationUnavailable({content_type:"video/mp4",file_size:100}))
    assert.equal(policy.interpretationUnavailable({content_type:"application/pdf",file_size:100}),null)
})
test("asset receipt binds the SOP, actor, workspace, file and guidance",()=>{
    const signed=tickets.signSopAssetTicket(ticket,"secret")
    assert.deepEqual(tickets.readSopAssetTicket(signed,"secret",ticket.workspaceId,ticket.userId,ticket.sopId),ticket)
    for(const [workspace,user,sop] of [[id(8),ticket.userId,ticket.sopId],[ticket.workspaceId,id(8),ticket.sopId],[ticket.workspaceId,ticket.userId,id(8)]]) assert.throws(()=>tickets.readSopAssetTicket(signed,"secret",workspace,user,sop))
    assert.throws(()=>tickets.readSopAssetTicket(signed,"secret",ticket.workspaceId,ticket.userId,ticket.sopId,ticket.expires))
    const altered=Buffer.from(JSON.stringify({...ticket,role:"example"})).toString("base64url")+"."+signed.split(".")[1]
    assert.throws(()=>tickets.readSopAssetTicket(altered,"secret",ticket.workspaceId,ticket.userId,ticket.sopId))
})
test("signature checking rejects disguised media and binary text",()=>{
    assert.equal(tickets.validSopAssetHeader("application/pdf",Buffer.from("%PDF-1.7")),true)
    assert.equal(tickets.validSopAssetHeader("image/png",Buffer.from("<html>")),false)
    assert.equal(tickets.validSopAssetHeader("text/plain",Buffer.from([0,1,2])),false)
    assert.equal(tickets.validSopAssetHeader("video/mp4",Buffer.from("0000ftypisom")),true)
})
const draft = {summary:"Set up tracking",applicability:["New accounts"],steps:[{title:"Check access",instruction:"Confirm account access.",condition:"Before setup",source_location:"Access",source_quote:"Confirm account access.",kind:"requirement" as const}],missing_information:[],warnings:[]}
test("interpretation validates source quotes for text and rejects oversized/malformed content",()=>{
    assert.deepEqual(interpretation.parseSopInterpretation(draft,"Confirm account access."),draft)
    assert.throws(()=>interpretation.parseSopInterpretation(draft,"Other text"),/quote/)
    assert.throws(()=>interpretation.parseSopInterpretation({...draft,steps:[{...draft.steps[0],source_quote:""}]}))
    assert.throws(()=>interpretation.parseSopInterpretation({...draft,steps:Array(81).fill(draft.steps[0])}))
    assert.throws(()=>interpretation.parseSopInterpretation({summary:"missing fields"}))
})
function uploadFixture() {
    let linked: { asset_id: string } | null = null, fail = false, headSize = file.size, etag="etag-one"
    const storage: { name: string; input: Record<string,unknown> }[]=[]
    const api=load("lib/sops/assets.ts",{
        "./records": { getSopAsset: async (w:string,s:string,a:string)=>w===ticket.workspaceId&&s===ticket.sopId&&a===ticket.id?linked:null,getSopRecord:async()=>({archived_at:null}) },
        "@/lib/supabase/admin":{supabaseAdmin:{rpc:async (_name:string,args:Record<string,unknown>)=>{ if(fail)return {error:{}}; assert.equal(args.p_asset,ticket.id);linked={asset_id:ticket.id};return {data:ticket.id,error:null} }}},
        "@/lib/env":{getRequiredEnv:()=>"secret"},"@/lib/onboarding/r2-cors":{ensurePlatformDirectUploads:async()=>{}},
        "@/lib/onboarding/uploads":{ getR2BucketName:()=>"bucket",getR2Client:()=>({send:async(cmd:{constructor:{name:string};input:Record<string,unknown>})=>{storage.push({name:cmd.constructor.name,input:cmd.input});if(cmd.constructor.name==="HeadObjectCommand")return {ContentLength:headSize,ContentType:file.type,ETag:etag};if(cmd.constructor.name==="GetObjectCommand")return {Body:{transformToByteArray:async()=>Buffer.from("Confirm account access.")}};return {}}})},
    }) as typeof import("../lib/sops/assets")
    return {api,storage,set fail(v:boolean){fail=v},set size(v:number){headSize=v},set etag(v:string){etag=v}}
}
test("asset finalization recovers lost acknowledgement and retains staging on database failure",async()=>{
    const f=uploadFixture(),receipt=tickets.signSopAssetTicket(ticket,"secret")
    f.fail=true;await assert.rejects(f.api.finishSopAssetUpload(ticket.workspaceId,ticket.userId,ticket.sopId,receipt),/Retry/)
    assert.equal(f.storage.some(c=>c.name==="DeleteObjectCommand"),false)
    f.fail=false;assert.equal(await f.api.finishSopAssetUpload(ticket.workspaceId,ticket.userId,ticket.sopId,receipt),ticket.id)
    const calls=f.storage.length
    await f.api.finishSopAssetUpload(ticket.workspaceId,ticket.userId,ticket.sopId,receipt)
    assert.equal(f.storage.length,calls)
})
test("different staging identities cannot overwrite an earlier final asset object",async()=>{
    const f=uploadFixture(),receipt=tickets.signSopAssetTicket(ticket,"secret");f.fail=true
    await assert.rejects(f.api.finishSopAssetUpload(ticket.workspaceId,ticket.userId,ticket.sopId,receipt));f.etag="etag-two"
    await assert.rejects(f.api.finishSopAssetUpload(ticket.workspaceId,ticket.userId,ticket.sopId,receipt))
    const copies=f.storage.filter(c=>c.name==="CopyObjectCommand")
    assert.notEqual(copies[0].input.Key,copies[1].input.Key)
    assert.equal(copies[0].input.CopySourceIfMatch,"etag-one")
    assert.equal(copies[1].input.CopySourceIfMatch,"etag-two")
    assert.throws(()=>f.api.assertSopAssetPath(ticket.workspaceId,ticket.sopId,ticket.id,`${id(99)}/other`))
})
test("invalid file size fails before final copy or database persistence",async()=>{
    const f=uploadFixture();f.size=2
    await assert.rejects(f.api.finishSopAssetUpload(ticket.workspaceId,ticket.userId,ticket.sopId,tickets.signSopAssetTicket(ticket,"secret")),/incomplete/)
    assert.equal(f.storage.some(c=>c.name==="CopyObjectCommand"),false)
})
test("every SOP mutation rejects staff before storage, database or model work",async()=>{
    const routes=[['sops/route.ts','POST'],['sops/[id]/route.ts','PATCH'],['sops/[id]/assets/route.ts','POST'],['sops/[id]/interpretations/route.ts','POST'],['sops/[id]/interpretations/[jobId]/route.ts','POST']]
    const fail=()=>{throw new Error("Unauthorized dependency reached")}
    for(const [file,method] of routes){
        const route=load(`app/api/workspaces/[workspaceSlug]/${file}`,{
            "@/lib/workspaces":{requireWorkspace:async()=>({workspace:{id:ticket.workspaceId},user:{id:ticket.userId},role:"staff"})},
            "@/lib/sops/policy":load("lib/sops/policy.ts"),"@/lib/sops/http":load("lib/sops/http.ts"),"@/lib/sops/records-policy":policy,"@/lib/sops/interpretation":interpretation,
            "@/lib/sops/records":{createSopRecord:fail,updateSopRecord:fail,getSopAsset:fail},"@/lib/sops/assets":{prepareSopAssetUpload:fail,finishSopAssetUpload:fail},"@/lib/supabase/admin":{supabaseAdmin:{rpc:fail}},"@/lib/sops/interpreter":{sopAiConfiguration:fail},"@/lib/sops/interpretation-worker":{processSopInterpretation:fail},"next/server":{after:fail},
        }) as Record<string,(r:Request,c:object)=>Promise<Response>>
        const result=await route[method](new Request("https://be.test/api",{method,body:'{}'}),{params:Promise.resolve({workspaceSlug:"acme",id:ticket.sopId,jobId:id(8)})})
        assert.equal(result.status,403,file)
    }
})
test("OpenAI adapter sends only the chosen source, disables storage/tools, and handles incomplete output",async()=>{
    const previous={enabled:process.env.SOP_AI_ENABLED,key:process.env.OPENAI_API_KEY}
    process.env.SOP_AI_ENABLED="true";process.env.OPENAI_API_KEY="fixture-key"
    const source=Buffer.from("Confirm account access.")
    const api=load("lib/sops/interpreter.ts",{
        "./assets":{assertSopAssetPath:()=>{}},
        "@/lib/onboarding/uploads":{getR2BucketName:()=>"fixture",getR2Client:()=>({send:async()=>({ContentLength:source.length,Body:{transformToByteArray:async()=>source}})})},
    }) as typeof import("../lib/sops/interpreter")
    const input={workspaceId:ticket.workspaceId,sopId:ticket.sopId,model:"fixture-model",linked:{asset_id:ticket.id,sop_id:ticket.sopId,role:ticket.role,notes:ticket.notes,created_at:new Date().toISOString(),asset:{id:ticket.id,title:file.name,content_type:file.type,file_size:source.length,storage_path:"fixture"}}}
    try {
        let calls=0
        const response:typeof fetch=async(url,options)=>{
            calls++;assert.equal(url,"https://api.openai.com/v1/responses")
            const body=JSON.parse(String(options?.body));assert.equal(body.store,false);assert.equal(body.tools,undefined);assert.equal(body.model,"fixture-model");assert.equal(body.text.format.strict,true);assert.equal(body.input.length,1)
            assert.equal(body.input[0].content[1].text,source.toString())
            return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(draft)}]}],usage:{input_tokens:100,output_tokens:50}})
        }
        const result=await api.interpretSopAsset(input,response)
        assert.equal(result.inputTokens,100);assert.equal(result.sourceHash.length,64);assert.equal(calls,1)
        await assert.rejects(api.interpretSopAsset(input,async()=>Response.json({status:"incomplete",output:[]})),/did not complete/)
        await assert.rejects(api.interpretSopAsset(input,async()=>Response.json({status:"completed",output:[{type:"message",content:[{type:"refusal"}]}]})),/did not complete/)
        process.env.SOP_AI_ENABLED="false"
        await assert.rejects(api.interpretSopAsset(input,response),/not enabled/)
        assert.equal(calls,1)
    } finally {
        if(previous.enabled===undefined)delete process.env.SOP_AI_ENABLED;else process.env.SOP_AI_ENABLED=previous.enabled
        if(previous.key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous.key
    }
})
test("interpretation result reads are scoped by workspace, SOP and job",async()=>{
    const filters:Record<string,string>={}
    const query={select:()=>query,eq:(key:string,value:string)=>{filters[key]=value;return query},maybeSingle:async()=>({data:null,error:null})}
    const route=load("app/api/workspaces/[workspaceSlug]/sops/[id]/interpretations/[jobId]/route.ts",{
        "@/lib/workspaces":{requireWorkspace:async()=>({workspace:{id:ticket.workspaceId},user:{id:ticket.userId},role:"staff"})},
        "@/lib/supabase/admin":{supabaseAdmin:{from:()=>query}},"@/lib/sops/policy":load("lib/sops/policy.ts"),"@/lib/sops/records-policy":policy,"@/lib/sops/http":load("lib/sops/http.ts"),
    }) as typeof import("../app/api/workspaces/[workspaceSlug]/sops/[id]/interpretations/[jobId]/route")
    const result=await route.GET(new Request("https://be.test/api"),{params:Promise.resolve({workspaceSlug:"acme",id:ticket.sopId,jobId:id(12)})})
    assert.equal(result.status,404);assert.deepEqual(filters,{workspace_id:ticket.workspaceId,sop_id:ticket.sopId,id:id(12)})
})
test("media ranges reject multi-range, out-of-bounds and malformed requests",()=>{
    assert.equal(policy.validSopMediaRange("bytes=0-99",1000),"bytes=0-99")
    assert.equal(policy.validSopMediaRange("bytes=100-",1000),"bytes=100-")
    assert.equal(policy.validSopMediaRange("bytes=-100",1000),"bytes=-100")
    for(const range of ["bytes=1000-","bytes=3-1","bytes=-0","bytes=0-10,20-30","bytes=-","bytes=NaN-","bytes=99999999999999999999-"]) assert.throws(()=>policy.validSopMediaRange(range,1000))
})
test("media seek streams only the requested bytes and fails closed before storage for unknown assets",async()=>{
    let allowed=true,calls=0
    const api=load("lib/sops/assets.ts",{
        "./records":{getSopAsset:async()=>allowed?{asset_id:ticket.id,asset:{id:ticket.id,title:"Demo.mp4",content_type:"video/mp4",file_size:1000,storage_path:`${ticket.workspaceId}/sops/${ticket.sopId}/assets/${ticket.id}/${"a".repeat(64)}/original`}}:null},
        "@/lib/supabase/admin":{},"@/lib/env":{},"@/lib/onboarding/r2-cors":{},
        "@/lib/onboarding/uploads": {
            getR2BucketName: () => "fixture",
            getR2Client: () => ({ send: async (cmd: { input: { Range: string } }) => {
                calls++; assert.equal(cmd.input.Range, "bytes=0-9")
                return { ContentLength: 10, ContentRange: "bytes 0-9/1000", Body: {
                    transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10)); controller.close() } }),
                } }
            } }),
        },
    }) as typeof import("../lib/sops/assets")
    const request=()=>new Request("https://be.test/asset",{headers:{range:"bytes=0-9"}})
    const result=await api.sopAssetResponse(ticket.workspaceId,ticket.sopId,ticket.id,request())
    assert.equal(result.status,206);assert.equal(result.headers.get("accept-ranges"),"bytes");assert.equal((await result.arrayBuffer()).byteLength,10)
    allowed=false;assert.equal((await api.sopAssetResponse(ticket.workspaceId,ticket.sopId,ticket.id,request())).status,404);assert.equal(calls,1)
})
test("background worker rechecks current admin access before downloading or sending a source",async()=>{
    let providerCalls=0;const finishes:Record<string,unknown>[]=[]
    const worker=load("lib/sops/interpretation-worker.ts",{
        "./interpreter":{sopAiConfiguration:()=>({ready:true}),interpretSopAsset:async()=>{providerCalls++;return {}}},
        "./records":{getSopAsset:async()=>({asset:{id:ticket.id}})},
        "@/lib/supabase/admin":{supabaseAdmin:{
            rpc:async(name:string,args:Record<string,unknown>)=>name==="claim_sop_interpretation"?{data:[{id:id(30),workspace_id:ticket.workspaceId,sop_id:ticket.sopId,asset_id:ticket.id,requested_by:ticket.userId,model:"fixture",lease_token:id(31)}]}:name==="assert_sop_admin"?{error:{message:"Revoked"}}:(finishes.push(args),{data:true}),
            from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{id:ticket.sopId,archived_at:null}})})})})}),
        }},
    }) as typeof import("../lib/sops/interpretation-worker")
    assert.deepEqual(await worker.processSopInterpretation(id(30)),{claimed:1,completed:0})
    assert.equal(providerCalls,0);assert.equal(finishes[0].p_result,null);assert.match(String(finishes[0].p_error),/no longer available/)
})

test("SOP service assignment takes a service only and rejects staff, foreign origins and stale actors", async () => {
    let role="admin", calls=0, sent:unknown
    const route=load("app/api/workspaces/[workspaceSlug]/sops/[id]/services/route.ts",{
        "@/lib/workspace-access":{requireWorkspaceAccess:async()=>({workspace:{id:id(1)},user:{id:id(2)},role})},
        "@/lib/supabase/admin":{supabaseAdmin:{rpc:async(name:string,args:unknown)=>{calls++;assert.equal(name,"assign_sop_service");sent=args;return {error:null}}}},
        "@/lib/sops/policy":{canAddSop:(r:string)=>r==="admin"},
        "@/lib/sops/records-policy":policy,
        "@/lib/sops/http":load("lib/sops/http.ts"),
    }) as typeof import("../app/api/workspaces/[workspaceSlug]/sops/[id]/services/route")
    const context={params:Promise.resolve({workspaceSlug:"acme",id:id(3)})},body={serviceId:id(4),userId:id(2),unlink:false}
    const request=(payload=body,origin="https://fixture.test")=>new Request("https://fixture.test/api/services",{method:"POST",headers:{origin},body:JSON.stringify(payload)})
    assert.equal((await route.POST(request(),context)).status,200)
    assert.deepEqual(sent,{p_workspace:id(1),p_actor:id(2),p_sop:id(3),p_service:id(4),p_remove:false})
    role="staff";assert.equal((await route.POST(request(),context)).status,403)
    role="admin";assert.equal((await route.POST(request(body,"https://foreign.test"),context)).status,403)
    assert.equal((await route.POST(request({...body,userId:id(9)}),context)).status,400)
    assert.equal(calls,1)
})

test("SOP autosave passes field baselines in the body and returns conflicts without overwriting", async () => {
    let role="admin", calls=0, conflict=false
    const route=load("app/api/workspaces/[workspaceSlug]/sops/[id]/route.ts",{
        "@/lib/workspaces":{requireWorkspace:async()=>({workspace:{id:id(1)},user:{id:id(2)},role})},
        "@/lib/supabase/admin":{supabaseAdmin:{rpc:async(name:string,args:{p_field:string;p_baseline:string})=>{calls++;assert.equal(name,"save_sop_text");assert.equal(args.p_field,"description");assert.equal(args.p_baseline,"Previous value");return {data:conflict?null:{version:"2026-09-14T12:00:00Z"}}}}},
        "@/lib/sops/policy":{canAddSop:(r:string)=>r==="admin"},"@/lib/sops/records-policy":policy,
        "@/lib/sops/records":{},"@/lib/sops/http":load("lib/sops/http.ts"),
    }) as typeof import("../app/api/workspaces/[workspaceSlug]/sops/[id]/route")
    const context={params:Promise.resolve({workspaceSlug:"acme",id:id(3)})}
    const request=()=>new Request("https://fixture.test/api/sop",{method:"PATCH",body:JSON.stringify({field:"description",value:"New value",baseline:"Previous value",userId:id(2)})})
    assert.equal((await route.PATCH(request(),context)).status,200)
    conflict=true;assert.equal((await route.PATCH(request(),context)).status,409)
    role="staff";assert.equal((await route.PATCH(request(),context)).status,403)
    assert.equal(calls,2)
})
