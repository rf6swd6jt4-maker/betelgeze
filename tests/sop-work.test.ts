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
const pricing=load("lib/sops/pricing.ts") as typeof import("../lib/sops/pricing")
const work=load("lib/sops/work-plan.ts") as typeof import("../lib/sops/work-plan")
const meter=load("lib/sops/metered-request.ts") as typeof import("../lib/sops/metered-request")
const source={summary:"Set up",applicability:[],steps:[{title:"Access",instruction:"Check access.",condition:"",source_location:"Page 1",source_quote:"Check access.",kind:"requirement" as const}],missing_information:[],warnings:[]}
const task={title:"Confirm access",instruction:"Check the client's access.",source_steps:[1],depends_on:[],blocked_reason:""}
const plan={summary:"Setup",warnings:[],tasks:[task,{...task,title:"Check tracking",depends_on:[1]}]}
test("work plan accepts a usable dependency graph and rejects unsupported/cyclic/duplicate work",()=>{
    assert.deepEqual(work.parseSopWorkPlan(plan,source),plan)
    for(const tasks of [[],[task,task],[{...task,source_steps:[2]}],[{...task,depends_on:[1]}],[task,{...task,title:"Other",depends_on:[2]}],Array(41).fill(task)]) assert.throws(()=>work.parseSopWorkPlan({...plan,tasks},source))
})
test("pricing applies cached input rates, includes reasoning only once, and leaves unknown prices unknown",()=>{
    const usage=pricing.sopUsage({input_tokens:10000,input_tokens_details:{cached_tokens:2000},output_tokens:2000,output_tokens_details:{reasoning_tokens:500}})
    assert.deepEqual(usage,{input:10000,cached:2000,output:2000,reasoning:500})
    assert.equal(pricing.sopCost(usage,pricing.sopRate("gpt-5.4-mini")),0.01515)
    assert.equal(pricing.sopCost(usage,pricing.sopRate("unpriced-model")),null)
    assert.equal(pricing.sopUsage({input_tokens:1,output_tokens:2,input_tokens_details:{cached_tokens:3}}),null)
    assert.equal(pricing.sopUsage(null),null)
})
test("cost report separates reused source processing, current generation, retries and unknown dispatches",()=>{
    const row={id:"1",stage:"interpretation" as const,run_id:"old",model:"gpt-5.4-mini",status:"received",usage:null,estimated_usd:0.03,rate:null,created_at:"now"}
    const result=pricing.sopCostReport([row,{...row,id:"2",run_id:"new",stage:"generation",estimated_usd:0.02},{...row,id:"3",run_id:"new",stage:"generation",estimated_usd:null}],"new")
    assert.deepEqual(result.thisRun,{calls:2,knownUsd:0.02,unknownCalls:1})
    assert.deepEqual(result.sourceHistory,{calls:1,knownUsd:0.03,unknownCalls:0})
})
test("no provider call can precede durable metering; usage survives incomplete and invalid output",async()=>{
    let calls=0
    const events:string[]=[]
    const failed=meter.meteredSopRequest("gpt-5.4-mini",{start:async()=>{throw new Error("Database offline")},finish:async()=>{}},async()=>{calls++;return new Response()})
    await assert.rejects(failed("https://fixture.test"),/Database/);assert.equal(calls,0)
    const captured:unknown[]=[]
    const request=meter.meteredSopRequest("gpt-5.4-mini",{start:async()=>{events.push("durable")},finish:async value=>{events.push("metered");captured.push(value)}},async()=>{events.push("provider");return Response.json({id:"resp_1",model:"gpt-5.4-mini-2026-03-17",status:"incomplete",usage:{input_tokens:1000,output_tokens:100},output:[]})})
    const response=await request("https://fixture.test")
    assert.deepEqual(events,["durable","provider","metered"])
    assert.equal(response.status,200)
    assert.equal((captured[0] as {estimated_usd:number}).estimated_usd,0.0012)
})
test("transport failure is unknown rather than free and never silently retried",async()=>{
    let calls=0,finish:unknown=null
    const request=meter.meteredSopRequest("gpt-5.4-mini",{start:async()=>{},finish:async value=>{finish=value}},async()=>{calls++;throw new Error("timeout")})
    await assert.rejects(request("https://fixture.test"),/cost is unknown/)
    assert.equal(calls,1);assert.equal((finish as unknown as {estimated_usd:null}).estimated_usd,null)
})
test("nonstandard service tiers and unknown models retain token counts without guessed costs",async()=>{
    let saved:unknown=null
    const request=meter.meteredSopRequest("gpt-5.4-mini",{start:async()=>{},finish:async value=>{saved=value}},async()=>Response.json({service_tier:"priority",usage:{input_tokens:1000,output_tokens:100}}))
    await request("https://fixture.test")
    assert.equal((saved as unknown as {estimated_usd:null}).estimated_usd,null)
    assert.equal((saved as unknown as {usage:{input:number}}).usage.input,1000)
})
test("generation sends bounded evidence and strict source-only instructions without browsing tools",async()=>{
    const generator=load("lib/sops/work-generator.ts") as typeof import("../lib/sops/work-generator")
    const request:typeof fetch=async(_url,init)=>{
        const body=JSON.parse(String(init?.body))
        assert.equal(body.store,false);assert.equal(body.service_tier,"default");assert.equal(body.tools,undefined)
        assert.deepEqual(JSON.parse(body.input[0].content[0].text),{source});assert.equal(body.text.format.strict,true);assert.equal(body.max_output_tokens,14000)
        assert.match(body.instructions,/no tools/i);assert.doesNotMatch(body.input[0].content[0].text,/super-secret/)
        return Response.json({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(plan)}]}]})
    }
    const result=await generator.generateSopWork({model:"gpt-5.4-mini",source},request,async()=>{})
    assert.equal(result.tasks.length,2);assert.deepEqual(result.warnings,[])
})

function workerFixture(options:{revoked?:boolean;cached?:boolean;savedPlan?:boolean;failPublish?:boolean;acceptNone?:boolean}={}) {
    const calls={accepted:0,source:0,generation:0,publish:0,prepares:0,saves:[] as Record<string,unknown>[]}
    const job={id:"run",workspace_id:"workspace",relationship_id:"relationship",sop_id:"sop",interpretation_id:"interpretation",requested_by:"admin",model:"gpt-5.4-mini",lease_token:"lease",plan:options.savedPlan?plan:null,source_snapshot:options.savedPlan?source:null}
    let sourceReady=Boolean(options.cached)
    const query=(table:string)=>{
        const q={select:()=>q,eq:()=>q,gt:()=>q,update:(v:Record<string,unknown>)=>{calls.saves.push(v);return q},maybeSingle:async()=>table==="sop_interpretations"?{data:{id:"interpretation",status:sourceReady?"ready":"queued",result:source}}:table==="workspaces"?{data:{slug:"test"}}:{data:{id:"run"}}}
        return q
    }
    const worker=load("lib/sops/work-worker.ts",{
        "next/cache":{revalidatePath:()=>{}},
        "./interpreter":{sopAiConfiguration:()=>({ready:true})},
        "./interpretation-worker":{processSopInterpretation:async()=>{calls.source++;sourceReady=true}},
        "./work-generator":{generateSopWork:async()=>{calls.generation++;return plan}},
        "./usage-ledger":{sopLedgerRequest:()=>async()=>new Response()},
        "@/lib/supabase/admin":{supabaseAdmin:{from:query,rpc:async(name:string)=>{
            if(name==="accept_sop_work_request"){calls.accepted++;return {data:options.acceptNone?null:"run"}}
            if(name==="claim_sop_work")return {data:[job]}
            if(name==="prepare_sop_work"){calls.prepares++;return options.revoked?{error:{message:"revoked"}}:{data:{goal:"Bookings"}}}
            if(name==="publish_sop_work"){calls.publish++;return options.failPublish?{error:{message:"offline"}}:{data:["work1","work2"]}}
            throw new Error(name)
        }}},
    }) as typeof import("../lib/sops/work-worker")
    return {worker,calls}
}
test("worker interprets once, generates and saves before atomic publication; cached source incurs no read call",async()=>{
    const previous=process.env.SOP_WORK_PILOT_ENABLED;process.env.SOP_WORK_PILOT_ENABLED="true"
    try {
        const first=workerFixture();assert.deepEqual(await first.worker.processSopWork("run"),{claimed:1,published:1})
        assert.equal(first.calls.source,1);assert.equal(first.calls.generation,1);assert.equal(first.calls.publish,1);assert.deepEqual(first.calls.saves.find(s=>s.plan)?.plan,plan)
        const cached=workerFixture({cached:true});await cached.worker.processSopWork("run");assert.equal(cached.calls.source,0)
        const retry=workerFixture({savedPlan:true});await retry.worker.processSopWork("run");assert.equal(retry.calls.generation,0);assert.equal(retry.calls.source,0);assert.equal(retry.calls.publish,1)
    } finally { if(previous===undefined)delete process.env.SOP_WORK_PILOT_ENABLED;else process.env.SOP_WORK_PILOT_ENABLED=previous }
})
test("worker revocation blocks every provider call; publication failure preserves the paid result",async()=>{
    const previous=process.env.SOP_WORK_PILOT_ENABLED;process.env.SOP_WORK_PILOT_ENABLED="true"
    try {
        const revoked=workerFixture({revoked:true});await revoked.worker.processSopWork("run")
        assert.equal(revoked.calls.source,0);assert.equal(revoked.calls.generation,0);assert.equal(revoked.calls.publish,0);assert.equal(revoked.calls.saves[0].status,"failed")
        const failed=workerFixture({cached:true,failPublish:true});await failed.worker.processSopWork("run")
        assert.deepEqual(failed.calls.saves.find(s=>s.plan)?.plan,plan);assert.equal(failed.calls.saves.at(-1)?.status,"failed");assert.equal("plan" in failed.calls.saves.at(-1)!,false)
    } finally { if(previous===undefined)delete process.env.SOP_WORK_PILOT_ENABLED;else process.env.SOP_WORK_PILOT_ENABLED=previous }
})
test("pilot routes reject staff and foreign origins before queuing or dispatching",async()=>{
    let role="staff",dispatched=0
    const route=load("app/api/workspaces/[workspaceSlug]/sops/[id]/work-runs/route.ts",{
        "next/server":{after:()=>{dispatched++}},
        "@/lib/workspace-access":{requireWorkspacePanel:async()=>({workspace:{id:"w"},user:{id:"actor"},role})},
        "@/lib/supabase/admin":{supabaseAdmin:{rpc:()=>{throw new Error("Must not queue")}}},
        "@/lib/sops/policy":{canAddSop:(v:string)=>v==="admin"},
        "@/lib/sops/records":{getSopAsset:()=>{throw new Error("Must not read assets")}},
        "@/lib/sops/records-policy":load("lib/sops/records-policy.ts"),
        "@/lib/sops/work-worker":{sopWorkConfiguration:()=>({ready:true}),processSopWork:()=>{dispatched++}},
        "@/lib/sops/work-server":{SOP_RUN_SUMMARY:"id"},
        "@/lib/sops/http":load("lib/sops/http.ts"),
    }) as typeof import("../app/api/workspaces/[workspaceSlug]/sops/[id]/work-runs/route")
    const context={params:Promise.resolve({workspaceSlug:"acme",id:"sop"})}
    assert.equal((await route.POST(new Request("https://be.test/api",{method:"POST",body:"{}"}),context)).status,403)
    role="admin"
    assert.equal((await route.POST(new Request("https://be.test/api",{method:"POST",headers:{origin:"https://foreign.test"},body:"{}"}),context)).status,403)
    assert.equal(dispatched,0)
})
test("downloaded cost reports retain workspace/SOP/run authorization and contain no evidence packet",async()=>{
    const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`
    let found=true,scope:unknown[]=[]
    const route=load("app/api/workspaces/[workspaceSlug]/sops/[id]/work-runs/[runId]/route.ts",{
        "next/server":{after:()=>{throw new Error("Reads must not dispatch work")}},
        "@/lib/workspace-access":{requireWorkspacePanel:async()=>({workspace:{id:id(1)},role:"admin"})},
        "@/lib/supabase/admin":{supabaseAdmin:{}},
        "@/lib/sops/policy":{canAddSop:()=>true},
        "@/lib/sops/records-policy":load("lib/sops/records-policy.ts"),
        "@/lib/sops/work-worker":{},
        "@/lib/sops/work-server":{sopWorkReport:async(...args:unknown[])=>{scope=args;return found?{id:id(3),entries:[],costs:{}}:null}},
        "@/lib/sops/http":load("lib/sops/http.ts"),
    }) as typeof import("../app/api/workspaces/[workspaceSlug]/sops/[id]/work-runs/[runId]/route")
    const context={params:Promise.resolve({workspaceSlug:"acme",id:id(2),runId:id(3)})}
    const response=await route.GET(new Request("https://be.test/api?download=1"),context)
    assert.deepEqual(scope,[id(1),id(2),id(3)])
    assert.equal(response.headers.get("Cache-Control"),"private, no-store")
    assert.match(response.headers.get("Content-Disposition")??"",/^attachment;/)
    assert.equal("evidence" in await response.json(),false)
    found=false
    const missing=await route.GET(new Request("https://be.test/api?download=1"),context)
    assert.equal(missing.status,404);assert.equal(missing.headers.get("Content-Disposition"),null)
})

test("sparse client context keeps generic SOP tasks and dispatch usage for reporting", async () => {
    const generator=load("lib/sops/work-generator.ts") as typeof import("../lib/sops/work-generator")
    const calls: {body:Record<string,unknown>}[]=[]
    const records: unknown[]=[]
    const request=meter.meteredSopRequest("gpt-5.4-mini",{start:async()=>{records.push("dispatched")},finish:async result=>{records.push(result)}},async (_url,init)=>{
        calls.push({body:JSON.parse(init?.body as string)})
        return Response.json({id:"resp_sparse",model:"gpt-5.4-mini",service_tier:"default",status:"completed",usage:{input_tokens:2100,output_tokens:900,input_tokens_details:{cached_tokens:100},output_tokens_details:{reasoning_tokens:50}},output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(plan)}]}]})
    })
    const result=await generator.generateSopWork({model:"gpt-5.4-mini",source},request,async()=>{})
    assert.equal(result.tasks.length,2)
    assert.equal(result.tasks[0].blocked_reason,"")
    assert.deepEqual(result.tasks[1].depends_on,[1])
    assert.equal(calls.length,1)
    assert.equal(records.length,2)
    assert.match(calls[0].body.instructions as string,/MUST NOT cause an empty plan/)
    assert.equal(calls[0].body.tools,undefined)
})


test("automatic wake-up accepts the durable service request before any provider work",async()=>{
    const previous=process.env.SOP_WORK_PILOT_ENABLED;process.env.SOP_WORK_PILOT_ENABLED="true"
    try {
        const first=workerFixture();await first.worker.processSopWork(undefined,"instance")
        assert.equal(first.calls.accepted,1);assert.equal(first.calls.generation,1)
        const replay=workerFixture({acceptNone:true});await replay.worker.processSopWork(undefined,"instance")
        assert.equal(replay.calls.accepted,1);assert.equal(replay.calls.generation,0);assert.equal(replay.calls.source,0)
    } finally {if(previous===undefined)delete process.env.SOP_WORK_PILOT_ENABLED;else process.env.SOP_WORK_PILOT_ENABLED=previous}
})

test("cron acknowledges only authenticated wakeups and defers all processing",async()=>{
    const previous=process.env.SOP_WORK_CRON_SECRET;process.env.SOP_WORK_CRON_SECRET="fixture-worker-secret"
    const callbacks:(()=>Promise<void>)[]=[];let calls=0
    try {
        const route=load("app/api/cron/sop-work/route.ts",{"next/server":{after:(fn:()=>Promise<void>)=>callbacks.push(fn)},"@/lib/sops/work-worker":{processSopWork:async()=>{calls++}}}) as typeof import("../app/api/cron/sop-work/route")
        assert.equal((await route.POST(new Request("https://be.test/api/cron/sop-work",{method:"POST"}))).status,401)
        assert.equal(callbacks.length,0)
        assert.equal((await route.POST(new Request("https://be.test/api/cron/sop-work",{method:"POST",headers:{authorization:"Bearer fixture-worker-secret"}}))).status,202)
        assert.equal(calls,0);await callbacks[0]();assert.equal(calls,1)
    } finally {if(previous===undefined)delete process.env.SOP_WORK_CRON_SECRET;else process.env.SOP_WORK_CRON_SECRET=previous}
})

test("dependency normalization preserves a valid graph, deduplicates edges and reorders forward references",()=>{
    const value=work.parseSopWorkPlan({...plan,tasks:[{...task,title:"Launch",depends_on:[3,3,2]},{...task,title:"Validate",depends_on:[3]},{...task,title:"Access"}]},source)
    assert.deepEqual(value.tasks.map(t=>[t.title,t.depends_on]),[["Access",[]],["Validate",[1]],["Launch",[1,2]]])
    const many=Array.from({length:15},(_,index)=>({...task,title:`Task ${index+1}`,depends_on:index===14?Array.from({length:14},(_,i)=>i+1):[]}))
    assert.equal(work.parseSopWorkPlan({...plan,tasks:many},source).tasks[14].depends_on.length,14)
    assert.throws(()=>work.parseSopWorkPlan({...plan,tasks:[{...task,depends_on:[2]},{...task,title:"Two",depends_on:[1]}]},source),/cycle involving tasks 1, 2/)
    assert.throws(()=>work.parseSopWorkPlan({...plan,tasks:[{...task,depends_on:[47]}]},source),/task 1 refers to nonexistent task 47/)
})
test("a rejected provider plan is retained before dependency validation, with usage intact",async()=>{
    const generator=load("lib/sops/work-generator.ts") as typeof import("../lib/sops/work-generator")
    const raw=JSON.stringify({...plan,tasks:[{...task,depends_on:[99]}]})
    let retained="",paid=0
    const request=meter.meteredSopRequest("gpt-5.4-mini",{start:async()=>{},finish:async()=>{paid++}},async()=>Response.json({status:"completed",usage:{input_tokens:100,output_tokens:100},output:[{type:"message",content:[{type:"output_text",text:raw}]}]}))
    await assert.rejects(generator.generateSopWork({model:"gpt-5.4-mini",source},request,async text=>{retained=text}),/nonexistent task 99/)
    assert.equal(retained,raw);assert.equal(paid,1)
})
