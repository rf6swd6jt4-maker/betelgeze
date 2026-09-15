import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const require=createRequire(import.meta.url)
const compile=(path,imports,env={})=>{
 const module={exports:{}}
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 runInNewContext(code,{module,exports:module.exports,require:name=>name in imports?imports[name]:require(name),process:{env},fetch,AbortSignal,console})
 return module.exports
}
const ranking=compile('../lib/work-queue/ranking.ts',{})
const result={impact:75,urgency:50,effort_minutes:30,confidence:80,reason:'Enables campaign launch',uncertainty:''}
let context={item:{title:'Configure campaign',instructions:'Use the approved campaign plan.'}}
let job={work_item_id:'fixture-task',workspace_id:'fixture-workspace',lease_token:'fixture-lease',assessment:null,fingerprint:null}
let providerCalls=0,claims=0,usage=[],finishes=[]
const db={
 async rpc(name,args){
  if(name==='claim_queue_assessment'){claims++;return {data:[{...job}],error:null}}
  if(name==='queue_assessment_context')return {data:context,error:null}
  if(name==='finish_queue_assessment'){finishes.push(args);if(!args.p_error){job={...job,fingerprint:args.p_fingerprint,assessment:args.p_assessment}}return {data:true,error:null}}
  throw Error('Unexpected RPC '+name)
 },
 from(name){assert.equal(name,'work_queue_ai_usage');return {update(values){return {async eq(){usage.push(values);return {error:null}}}}}}
}
const env={QUEUE_AI_ENABLED:'true',OPENAI_API_KEY:'fixture-only-not-a-real-key'}
const worker=compile('../lib/work-queue/worker.ts',{'server-only':{},'@/lib/supabase/admin':{supabaseAdmin:db},'./ranking':ranking},env)
const provider=async(url,options)=>{providerCalls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.model,'gpt-5.4-mini');assert.equal(body.store,false);return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:200},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]})}
await worker.processQueueAssessment(provider);assert.equal(providerCalls,1);assert.equal(finishes.at(-1).p_assessment.reason,result.reason)
await worker.processQueueAssessment(provider);assert.equal(providerCalls,1);assert.equal(usage.at(-1).cost_usd,0)
console.log('PASS: identical saved context reuses assessment without a second provider call')
context={item:{...context.item,instructions:'Updated approved campaign plan.'}};await worker.processQueueAssessment(provider);assert.equal(providerCalls,2)
console.log('PASS: changed source context makes one new fixed-model assessment')
context={item:{title:'Different work'}}
await worker.processQueueAssessment(async()=>{throw Error('Network response unknown')});assert.equal(usage.at(-1).status,'unknown');assert.ok(finishes.at(-1).p_error)
console.log('PASS: uncertain dispatch records unknown usage and marks the attempt failed')
await worker.processQueueAssessment(async()=>Response.json({status:'completed',usage:{input_tokens:20,output_tokens:30},output:[{type:'message',content:[{type:'output_text',text:'{"impact":999}'}]}]}));assert.equal(usage.at(-1).status,'received');assert.ok(finishes.at(-1).p_error)
console.log('PASS: malformed model output is rejected while billed usage remains recorded')
env.QUEUE_AI_ENABLED='false';const before=claims;await worker.processQueueAssessment(provider);assert.equal(claims,before)
console.log('PASS: disabled AI does not claim work or contact a provider')
