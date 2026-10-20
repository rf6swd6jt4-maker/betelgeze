import assert from 'node:assert/strict'
// Exercise the actual claim SELECTs with retained history and a large unrelated
// pending backlog. A transaction rolls all synthetic growth data back afterward.
export async function checkGhlGrowth(db) {
 const one=async(text,args=[])=>(await db.query(text,args)).rows[0]
 await db.exec('begin')
 try {
  await db.exec("update client_portal_secure.ghl_appointment_profiles set detection_enabled=false,sending_enabled=false")
  const p=await one('select * from client_portal_secure.ghl_appointment_profiles order by id limit 1')
  await db.query("update client_portal_secure.ghl_appointment_profiles set detection_enabled=true,sending_enabled=true,sending_activated_at=now()-interval '1 day',tested_at=now() where id=$1",[p.id])
  await db.query(`insert into client_portal_secure.ghl_appointment_inbox(profile_id,connection_revision,appointment_id,event_type,event_key,payload_hash,payload,available_at)
   select $1,$2,'growth-unrelated-'||n,'AppointmentUpdate','growth-'||n,repeat('a',64),'{}',now()-interval '1 hour' from generate_series(1,25000) n`,[p.id,p.connection_revision])
  await db.query(`insert into client_portal_secure.ghl_appointment_snapshots(profile_id,appointment_id,version,connection_revision,snapshot)
   select $1,'growth-'||n,1,$2,'{}' from generate_series(1,25001) n`,[p.id,p.connection_revision])
  await db.query(`insert into client_portal_secure.ghl_appointment_versions(profile_id,appointment_id,version,snapshot)
   select $1,'growth-'||n,1,'{}' from generate_series(1,25001) n`,[p.id])
  await db.query(`insert into client_portal_secure.ghl_appointment_outbox(profile_id,appointment_id,version,kind,connection_revision,snapshot,expires_at,available_at)
   select $1,'growth-'||n,1,'added',$2,'{}',case when n=25001 then now()+interval '1 hour' else now()-interval '1 hour' end,now()-interval '2 hours' from generate_series(1,25001) n`,[p.id,p.connection_revision])
  await db.exec('analyze client_portal_secure.ghl_appointment_inbox;analyze client_portal_secure.ghl_appointment_profiles;analyze client_portal_secure.ghl_appointment_outbox')
  const definition=(await one("select pg_get_functiondef('public.ghl_appointment_automation(text,jsonb)'::regprocedure) definition")).definition
  const failures=[]
  for(const [kind,expression,input] of [
   ['scoped event',/for e in (select i\.\* from client_portal_secure\.ghl_appointment_inbox[\s\S]+?) loop/,{locationId:p.location_id,appointmentId:'growth-25001'}],
   ['scoped notification',/for o in (select ob\.\* from client_portal_secure\.ghl_appointment_outbox ob join[\s\S]+?) loop/,{locationId:p.location_id,appointmentId:'growth-25001'}],
   ['recovery notification',/for o in (select ob\.\* from client_portal_secure\.ghl_appointment_outbox ob join[\s\S]+?) loop/,{}],
  ]) {
   const match=definition.match(expression);assert.ok(match,kind)
   const query=match[1].replaceAll('p_input',`'${JSON.stringify(input).replaceAll("'","''")}'::jsonb`).replaceAll('limit bound','limit 1')
   const result=await one(`explain (analyze,buffers,format json) ${query}`)
   const plan=result['QUERY PLAN'][0],nodes=[]
   const walk=node=>{nodes.push(node);for(const child of node.Plans??[])walk(child)};walk(plan.Plan)
   const removed=nodes.reduce((n,node)=>n+(node['Rows Removed by Filter']??0)*(node['Actual Loops']??1),0)
   console.log(JSON.stringify({growth:kind,unrelatedPending:25000,expiredNotifications:25000,rowsRemoved:removed,indexes:nodes.map(n=>n['Index Name']).filter(Boolean),executionMs:plan['Execution Time']}))
   if(removed>=1000) {console.log(JSON.stringify(plan));failures.push(`${kind} inspected ${removed} irrelevant rows`)}
  }
  assert.deepEqual(failures,[])
 } finally {await db.exec('rollback')}
}
