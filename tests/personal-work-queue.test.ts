import test from 'node:test'
import assert from 'node:assert/strict'
import { rankQueue, parseAssessment, type QueueItem } from '../lib/work-queue/ranking.ts'
const now = Date.parse('2026-09-15T12:00:00Z')
const item=(id:string,values:Partial<QueueItem>={}):QueueItem=>({id,title:id,description:null,status:'todo',created_at:'2026-09-14T00:00:00Z',updated_at:'2026-09-14T00:00:00Z',actual_start_at:null,due_at:null,planned_at:null,priority_override:null,blocked:false,paused:false,relationship:null,service:null,assessment:null,assessment_status:'queued',assessed_at:null,...values})
const a=(impact=50,urgency=50,effort_minutes=60)=>({impact,urgency,effort_minutes,confidence:80,reason:'Enables client delivery',uncertainty:''})
test('AI context assessment changes ranking among otherwise equal ready tasks',()=>{assert.equal(rankQueue([item('low',{assessment:a(10,10)}),item('high',{assessment:a(90,70)})],now)[0].id,'high')})
test('Started work stays above urgent arrivals and blockers cannot be recommended',()=>{
 const r=rankQueue([item('urgent',{due_at:'2026-09-15T11:00:00Z',assessment:a(100,100),priority_override:1}),item('working',{status:'doing',actual_start_at:'2026-09-15T10:00:00Z'}),item('blocked',{blocked:true,assessment:a(100,100),priority_override:1})],now)
 assert.deepEqual(r.map(i=>i.id),['working','urgent','blocked'])
})
test('Time can increase deadline urgency without another model assessment',()=>{
 const tasks=[item('routine',{assessment:a(80,60)}),item('due',{due_at:'2026-09-18T12:00:00Z',assessment:a(30,20)})]
 assert.equal(rankQueue(tasks,now)[0].id,'routine');assert.equal(rankQueue(tasks,now+71*3600000)[0].id,'due')
})
test('Paused, waiting and future work stay separate from ready work',()=>{
 const r=rankQueue([item('paused',{paused:true}),item('future',{planned_at:'2026-09-16T00:00:00Z'}),item('waiting',{status:'waiting'}),item('ready')],now)
 assert.equal(r[0].id,'ready');assert.deepEqual(new Set(r.slice(1).map(x=>x.state)),new Set(['Service paused','Scheduled','Waiting']))
})
test('Tiny tasks cannot defeat substantial value solely through a duration ratio',()=>assert.equal(rankQueue([item('tiny',{assessment:a(10,10,1)}),item('substantial',{assessment:a(90,60,240)})],now)[0].id,'substantial'))
test('Manual overrides are respected and ties are deterministic',()=>{
 assert.equal(rankQueue([item('high',{assessment:a(100,100)}),item('override',{priority_override:1})],now)[0].id,'override')
 assert.deepEqual(rankQueue([item('b'),item('a')],now).map(x=>x.id),['a','b'])
})
test('Malformed, unbounded or nonfinite assessments are rejected',()=>{
 for(const v of [null,{...a(),impact:NaN},{...a(),urgency:101},{...a(),effort_minutes:0},{...a(),reason:'x'.repeat(301)}]) assert.throws(()=>parseAssessment(v))
 assert.deepEqual(parseAssessment(a()),a())
})
