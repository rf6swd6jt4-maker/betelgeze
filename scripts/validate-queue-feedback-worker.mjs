import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const require=createRequire(import.meta.url)
const compile=(path,imports)=>{const module={exports:{}};runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:n=>n in imports?imports[n]:require(n),process:{env:{OPENAI_API_KEY:'fixture'}},fetch,AbortSignal,console});return module.exports}
const policy=compile('../lib/work-queue/feedback-policy.ts',{});let enabled=true,kind='dispute',usage=[],finishes=[],calls=0,notify=0,stored=null,plans=[]
const job={id:'job',entity_id:'dispute',workspace_id:'workspace',lease_token:'lease'}
const db={async rpc(n,args){if(n==='claim_queue_feedback_job')return{data:[job]};if(n==='finish_queue_feedback_job'){finishes.push(args);return{data:true}};if(n==='calibrate_queue_effort')return{};if(n==='queue_schedule_context')return{data:{timezone:'Europe/Dublin',tasks:[{id:'task',effort:60,factor:1.05,horizon:'today',anchor_day:null,old_horizon:null,ready:true}]}};if(n==='publish_queue_schedule'){plans=args.p_plans;return{data:true}};throw new Error(n)},from(n){let values;const chain={select(){return chain},update(v){values=v;return chain},eq(){return chain},is(){return chain},async single(){return{data:{id:'dispute',reason:'Estimate seems unrealistic',note:'Missing validation',snapshot:{title:'Task',instructions:'Check the result'},assessment:stored}}},then(resolve){if(n==='work_queue_ai_usage')usage.push(values);if(n==='work_queue_disputes'&&values)stored=values.assessment;resolve({error:null})}};return chain}}
const worker=compile('../lib/work-queue/feedback-worker.ts',{'server-only':{},'@/lib/supabase/admin':{supabaseAdmin:db},'./worker':{queueAiConfiguration:()=>({enabled,dailyLimit:500})},'./ranking':{QUEUE_MODEL:'gpt-5.4-mini'},'./feedback-policy':policy,'@/lib/push/chat-notifications':{notifyQueueDispute:async()=>notify++}})
const provider=async(url,o)=>{calls++;const b=JSON.parse(o.body);assert.equal(b.store,false);assert.equal(b.model,'gpt-5.4-mini');assert.equal(b.tools,undefined);return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:200},output:[{content:[{type:'output_text',text:JSON.stringify({category:'estimate',summary:'Review scope',suggestion:'Check validation effort',confidence:70})}]}]})}
await worker.processQueueFeedback(kind,provider);assert.equal(calls,1);assert.ok(stored);await worker.processQueueFeedback(kind,provider);assert.equal(calls,1);assert.equal(usage.at(-1).cost_usd,0)
stored=null;await worker.processQueueFeedback(kind,async()=>{throw new Error('Unknown')});assert.equal(usage.at(-1).status,'unknown');assert.ok(finishes.at(-1).p_error)
enabled=false;const before=finishes.length;await worker.processQueueFeedback(kind,provider);assert.equal(finishes.length,before)
await worker.processQueueFeedback('schedule',provider);assert.equal(calls,1);assert.equal(plans[0].effort_minutes,63);assert.equal(plans[0].expected_at,undefined)
await worker.processQueueFeedback('notify',provider);assert.equal(notify,1);assert.equal(calls,1)
console.log('PASS: one assessment per saved dispute, reuse, unknown usage, disabled provider, qualitative summaries and independent internal notification')
