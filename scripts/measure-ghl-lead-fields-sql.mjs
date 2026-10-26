import assert from 'node:assert/strict'

const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]}
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,medianMs:median(values),p95Ms:sorted[Math.ceil(sorted.length*.95)-1]}}
let randomState=45671
const random=()=>((randomState=(Math.imul(randomState,1664525)+1013904223)>>>0)/4294967296)
function evidence(name,pairs,extra={}) {
 const delta=pairs.map(pair=>pair.candidate-pair.baseline),bootstrap=[]
 for(let i=0;i<2000;i++) bootstrap.push(median(Array.from({length:delta.length},()=>delta[Math.floor(random()*delta.length)])))
 bootstrap.sort((a,b)=>a-b)
 const result={measurement:name,baseline:summary(pairs.map(x=>x.baseline)),candidate:summary(pairs.map(x=>x.candidate)),pairedMedianDeltaMs:median(delta),pairedMedian95IntervalMs:[bootstrap[50],bootstrap[1949]],...extra}
 console.log(JSON.stringify(result));return result
}

// Optional isolated diagnostics, never a production benchmark or test threshold.
export async function measureGhlLeadFields({db,profile,baselineDefinition}) {
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0]
 const timing=async(sql,args=[])=>Number((await one(`explain (analyze,format json) ${sql}`,args))['QUERY PLAN'][0]['Execution Time'])
 const results=[]
 await db.exec('begin')
 try {
  const candidateDefinition=(await one("select pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure) value")).value
  const mapping=Array.from({length:8},(_,i)=>({fieldId:`approved_${i}`,label:`Question ${i} ${'x'.repeat(150)}`}))
  if(process.env.BE_GHL_LEAD_MEASURE_APPLY_ONLY!=='1') {
  await db.exec(`create temporary table lead_baseline_profiles (like client_portal_secure.ghl_appointment_profiles including all);
   alter table lead_baseline_profiles alter column lead_field_mapping type jsonb using lead_field_mapping::jsonb;
   create temporary table lead_candidate_profiles (like client_portal_secure.ghl_appointment_profiles including all);`)
  await db.query(`with records as materialized (select jsonb_populate_record(null::lead_baseline_profiles,to_jsonb(p)||jsonb_build_object('id',gen_random_uuid(),'relationship_id',gen_random_uuid(),'workspace_id',gen_random_uuid(),'lead_field_mapping',$2::jsonb)) value from client_portal_secure.ghl_appointment_profiles p cross join generate_series(1,25000) n where p.id=$1) insert into lead_baseline_profiles select (value).* from records`,[profile.id,JSON.stringify(mapping)])
  await db.exec('insert into lead_candidate_profiles select * from lead_baseline_profiles;analyze lead_baseline_profiles;analyze lead_candidate_profiles;')
  const target=(await one('select id from lead_baseline_profiles limit 1')).id
  const paired=async(run,count=120)=>{const pairs=[];for(let i=0;i<count+20;i++){const pair={};for(const arm of random()<.5?['baseline','candidate']:['candidate','baseline'])pair[arm]=await run(arm);if(i>=20)pairs.push(pair)}return pairs}
  for(const [label,value] of [['unmapped',[]],['eight mapped',mapping]]) {
   for(const arm of ['baseline','candidate'])await db.query(`update lead_${arm}_profiles set lead_field_mapping=$1::jsonb where id=$2`,[JSON.stringify(value),target])
   const pairs=await paired(arm=>timing(`update lead_${arm}_profiles set reconcile_due_at=reconcile_due_at+interval '1 second',reconcile_lease=gen_random_uuid(),reconcile_lease_until=now()+interval '2 minutes' where id=$1`,[target]))
   results.push(evidence(`unrelated profile bookkeeping: ${label}`,pairs,{rowsPerArm:25000,order:'seeded random paired'}))
  }
  results.push(evidence('explicit eight-field mapping assignment',await paired(arm=>timing(`update lead_${arm}_profiles set lead_field_mapping=$1::jsonb where id=$2`,[JSON.stringify(mapping),target])),{rowsPerArm:25000,order:'seeded random paired',note:'New configuration action; isolates validation cost, not an existing unmapped write'}))
  }
  await db.query('update client_portal_secure.ghl_appointment_profiles set lead_field_mapping=$1::jsonb where id=$2',[JSON.stringify(mapping),profile.id])
  const rpc=async(action,input)=>(await one('select public.ghl_appointment_automation($1,$2::jsonb) value',[action,JSON.stringify({processorVersion:2,portalSyncVersion:1,...input})])).value
  const id='measured-lead-appointment',snapshot={id,locationId:profile.locationId,calendarId:profile.calendarId,calendarName:profile.calendarName,contactId:'measured_contact',contactName:'Synthetic lead',title:'Synthetic appointment',startTime:'2026-11-01T13:00:00.000Z',endTime:'2026-11-01T14:00:00.000Z',timezone:'UTC',status:'confirmed',contactDetails:'synthetic@example.com',meetingDetails:'Office',bookingDetails:'Booking details are not configured.',sourceUpdatedAt:'2026-10-26T12:00:00.000Z',observedAt:'2026-10-26T12:00:00.000Z',deleted:false,details:{schemaVersion:1,contact:{phone:null}}}
  let seq=0,version=0
  const apply=async(withLead)=>{
   await rpc('ingest',{locationId:profile.locationId,calendarId:profile.calendarId,appointmentId:id,eventType:'AppointmentUpdate',eventKey:`lead-measure-${++seq}`,payloadHash:'a'.repeat(64),payload:{baseline:true}})
   const event=(await rpc('claim_events',{locationId:profile.locationId,appointmentId:id,limit:1})).items[0]
   const lead={source:'Referral',type:'lead',capturedAt:new Date(Date.parse('2026-10-26T12:00:00.000Z')+seq*1000).toISOString(),fields:mapping.map(x=>({...x,value:'A bounded synthetic answer'}))}
   const next=withLead?{...snapshot,details:{...snapshot.details,lead}}:snapshot
   const params={processorVersion:2,portalSyncVersion:1,id:event.id,leaseToken:event.leaseToken,expectedVersion:version,snapshot:next,sourceUpdatedAt:snapshot.sourceUpdatedAt,kinds:[]}
   const duration=await timing("select public.ghl_appointment_automation('apply_event',$1::jsonb)",[JSON.stringify(params)])
   version=(await one('select version from client_portal_secure.ghl_appointment_snapshots where profile_id=$1 and appointment_id=$2',[profile.id,id])).version
   return duration
  }
  await apply(false)
  for(const withLead of [false,true]) {
   const pairs=[]
   for(let round=0;round<30;round++) {
    const batch={baseline:[],candidate:[]}
    for(const arm of random()<.5?['baseline','candidate']:['candidate','baseline']) {
     await db.exec(arm==='baseline'?baselineDefinition:candidateDefinition)
     await apply(withLead);await apply(withLead)
     for(let i=0;i<3;i++)batch[arm].push(await apply(withLead))
    }
    for(let i=0;i<3;i++)pairs.push({baseline:batch.baseline[i],candidate:batch.candidate[i]})
   }
   results.push(evidence(withLead?'latest lead-only apply_event':'legacy no-lead apply_event',pairs,{order:'seeded random definition order, two warmups per arm/round'}))
  }
  assert.equal(Number(version),1,'Measurement updates enrich only the latest version')
  console.log(JSON.stringify({measurement:'lead projection size',mappingBytes:Buffer.byteLength(JSON.stringify(mapping)),limits:'Isolated PostgreSQL execution only; excludes network, provider, auth and full page latency. No production load.'}))
 } finally {await db.exec('rollback')}
 return results
}
