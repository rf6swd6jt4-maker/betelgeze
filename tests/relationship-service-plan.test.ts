import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import { resolve } from "node:path"
import ts from "typescript"
import * as stages from "../lib/service-stages.ts"
import type { ServicePlanSnapshot, ServicePlanWork } from "../lib/relationship-service-plan"
function load() {
    const path=resolve('lib/relationship-service-plan.ts')
    const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
    const require=createRequire(path)
    const loadedModule=new Module(path) as Module & {_compile:(source:string,filename:string)=>void}
    loadedModule.require=((name:string)=>name==='./service-stages'?stages:require(name)) as typeof loadedModule.require
    loadedModule._compile(compiled,path)
    return loadedModule.exports as typeof import('../lib/relationship-service-plan')
}
const {buildRelationshipServicePlan:build,servicePlanRootId:root}=load()
const service=(id:string,name:string,stage:stages.ServiceStageKey,legacy=false)=>({id,name,stage,legacy,service_id:'catalogue',service_revision_id:'revision',origin:legacy?'legacy':'negotiation',assignee_user_id:'person',assignee_name:'Delivery person',version:1,upfront_cents:100,recurring_cents:0,currency:'EUR',created_at:'2026-09-01T10:00:00Z'})
const work=(id:string,values:Partial<ServicePlanWork>={}):ServicePlanWork=>({id,title:id,status:'todo',lifecycle_phase:'fulfilment',workflow_role:'task',workflow_action:null,parent_work_item_id:null,planned_start_date:null,planned_start_time:null,due_date:null,due_time:null,actual_start_at:null,actual_start_has_time:false,actual_completed_at:null,actual_completed_has_time:false,sort_order:0,created_at:'2026-09-01T10:00:00Z',updated_at:'2026-09-01T10:00:00Z',service_id:null,native_key:null,shared:false,assignees:[],...values})
const fixture=(values:Partial<ServicePlanSnapshot>={}):ServicePlanSnapshot=>({services:[service('one','Ads','setup'),service('two','Website','completed')],events:[{instance_id:'one',new_stage:'setup',created_at:'2026-09-09T10:00:00Z',ended_at:null},{instance_id:'two',new_stage:'completed',created_at:'2026-09-10T10:00:00Z',ended_at:null}],work:[],links:[],dependencies:[],workTruncated:false,...values})

test('same catalogue can have separate service lifecycles without inferred past dates',()=>{
 const plan=build(fixture())
 assert.equal(plan.items.filter(i=>i.serviceRoot).length,2)
 assert.equal(plan.items.find(i=>i.id===root('one'))?.title,'Ads')
 assert.equal(plan.items.find(i=>i.id===root('two'))?.status,'done')
 assert.equal(plan.items.find(i=>i.id===`${root('one')}:negotiating`)?.actualStartAt,null)
 assert.equal(plan.items.find(i=>i.id===`${root('one')}:setup`)?.actualStartAt,'2026-09-09T10:00:00Z')
 assert.ok(plan.items.every(i=>i.virtual))
 assert.ok(plan.dependencies.every(d=>d.workItemId.startsWith(root('one')) && d.dependsOnWorkItemId.startsWith(root('one'))))
})
test('legacy timelines repeat stage dates, while shared work remains one real record',()=>{
 const plan=build(fixture({services:[service('legacy:ads','Ads','onboarding',true),{...service('legacy:website','Website','onboarding',true),service_id:'web'}],events:[],work:[work('old-stage',{workflow_role:'lifecycle_stage',lifecycle_phase:'onboarding',status:'doing',actual_start_at:'2026-09-04T10:00:00Z'}),work('shared-form',{parent_work_item_id:'old-stage',lifecycle_phase:'onboarding'}),work('ads-copy',{service_id:'catalogue',parent_work_item_id:null})]}))
 const phases=plan.items.filter(i=>i.virtual && !i.serviceRoot && i.serviceStage==='onboarding')
 assert.equal(phases.length,2)
 assert.ok(phases.every(i=>i.actualStartAt==='2026-09-04T10:00:00Z'))
 assert.equal(plan.items.filter(i=>i.id==='shared-form').length,1)
 assert.equal(plan.items.find(i=>i.id==='shared-form')?.section,'shared')
 assert.equal(plan.items.find(i=>i.id==='ads-copy')?.parentWorkItemId,`${root('legacy:ads')}:setup`)
 assert.ok(!plan.items.some(i=>i.id==='old-stage'))
})
test('one legacy service keeps its tasks within that lifecycle and preserves real IDs',()=>{
 const plan=build(fixture({services:[service('legacy:ads','Ads','setup',true)],events:[],work:[work('stage',{workflow_role:'lifecycle_stage'}),work('task',{parent_work_item_id:'stage'})]}))
 assert.equal(plan.items.find(i=>i.id==='task')?.parentWorkItemId,`${root('legacy:ads')}:setup`)
 assert.equal(plan.items.find(i=>i.id==='task')?.virtual,undefined)
})
test('explicit instance links distinguish repeat services; shared multi-instance work is not cloned',()=>{
 const plan=build(fixture({work:[work('first'),work('both'),work('child',{parent_work_item_id:'first'})],links:[{instance_id:'one',work_item_id:'first'},{instance_id:'one',work_item_id:'both'},{instance_id:'two',work_item_id:'both'}]}))
 assert.equal(plan.items.find(i=>i.id==='first')?.parentWorkItemId,`${root('one')}:setup`)
 assert.equal(plan.items.find(i=>i.id==='child')?.parentWorkItemId,'first')
 assert.equal(plan.items.filter(i=>i.id==='both').length,1)
 assert.equal(plan.items.find(i=>i.id==='both')?.section,'shared')
})
test('history from another instance cannot alter the visible service stage',()=>{
 const plan=build(fixture({services:[service('one','Ads','setup')],events:[{instance_id:'other',new_stage:'setup',created_at:'2020-01-01T10:00:00Z',ended_at:null}]}))
 assert.equal(plan.items.find(i=>i.id===`${root('one')}:setup`)?.actualStartAt,null)
})
