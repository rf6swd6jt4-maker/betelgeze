// Isolated HTTP boundary for the complete production Next app. Never connects
// to Supabase or any provider. Auth and surrounding REST metadata are synthetic; Comms RPCs execute real SQL.
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
const { WebSocketServer } = createRequire(import.meta.url)('next/dist/compiled/ws')
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
export const ids = { workspace:id(1), me:id(2), other:id(5), deviceA:id(6), deviceB:id(7), sessionA:id(8), sessionB:id(9) }
export function sessionCookie(sessionId=ids.sessionA) {
 const now=Math.floor(Date.now()/1000), user={id:ids.me,aud:'authenticated',role:'authenticated',email:'fixture@example.invalid',email_confirmed_at:'2026-10-01T00:00:00Z',created_at:'2026-10-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},factors:[{id:id(8),factor_type:'totp',status:'verified'}]}
 const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({sub:ids.me,aud:'authenticated',role:'authenticated',aal:'aal2',session_id:sessionId,exp:now+86400,iat:now,iss:'http://127.0.0.1:45679/auth/v1'})).toString('base64url')
 const token=`${head}.${body}.${createHmac('sha256','synthetic-local-only').update(`${head}.${body}`).digest('base64url')}`
 return {user,token,value:'base64-'+Buffer.from(JSON.stringify({access_token:token,refresh_token:'synthetic-refresh',expires_in:86400,expires_at:now+86400,token_type:'bearer',user})).toString('base64url')}
}
export async function startFixture({port=45679,chats=48,backlog=100,rpcOverride}={}) {
 const {createDeviceUnreadFixture}=await import('../device-unread-progressive/production-fixture.mjs');const sql=await createDeviceUnreadFixture({chats,backlog});let sqlQueue=Promise.resolve();const control={readDelayMs:0,previewDelayMs:0,failRead:false};const pendingRpc=new Set();const calls=[],unexpected=[],tables={},messages=[],conversations=[],user=sessionCookie().user
 const workspace={id:ids.workspace,slug:'fixture',name:'Isolated workspace',status:'active',banner_path:null,logo_path:null,banner_height:192,banner_position:50}
 const profiles=[{user_id:ids.me,username:'fixture',display_name:'Fixture reader',avatar_path:null,mfa_reenrollment_required:false},{user_id:ids.other,username:'colleague',display_name:'Fixture colleague',avatar_path:null,mfa_reenrollment_required:false}]
 const date=n=>new Date(Date.UTC(2026,9,1)+n*1000).toISOString()
 Object.assign(tables,{workspaces:[workspace],user_profiles:profiles,workspace_memberships:profiles.map(p=>({workspace_id:ids.workspace,user_id:p.user_id,role:p.user_id===ids.me?'owner':'staff',created_at:date(0)})),relationships:[],workspace_teams:[],workspace_team_members:[],workspace_native_conversations:[],workspace_native_conversation_participants:[]})
 for(let n=0;n<chats;n++){
  const kind=n%2?'native':'client',cid=id(1000+n),teamId=id(500+n),name=`${kind==='client'?'Client':'Team'} ${String(n+1).padStart(3,'0')}`,latestAt=`2026-10-01 00:${String(Math.floor(backlog/60)).padStart(2,'0')}:${String(backlog%60).padStart(2,'0')}.123456+00`
  conversations.push({id:cid,kind,name,latestAt})
  if(kind==='client')tables.relationships.push({id:cid,workspace_id:ids.workspace,client_id:null,primary_person_name:name,business_name:null,primary_email:`person${n}@example.invalid`,primary_phone:null,whatsapp_phone:null,status:'active',source_metadata:{is_test:true},communication_pinned_message_id:null,communication_primary_provider:'meta_whatsapp',seller_user_id:ids.me,fulfilment_manager_user_id:null,lifecycle_phase:'lead',created_at:date(0),updated_at:latestAt})
  else {tables.workspace_teams.push({id:teamId,workspace_id:ids.workspace,name,kind:'custom',archived_at:null,created_at:date(n)});for(const uid of [ids.me,ids.other]){tables.workspace_team_members.push({workspace_id:ids.workspace,team_id:teamId,user_id:uid});tables.workspace_native_conversation_participants.push({workspace_id:ids.workspace,conversation_id:cid,user_id:uid})};tables.workspace_native_conversations.push({id:cid,workspace_id:ids.workspace,kind:'team',team_id:teamId,is_system:false,direct_user_one:null,direct_user_two:null,archived_at:null,pinned_message_id:null,updated_at:latestAt})}
  for(let m=0;m<=backlog;m++)messages.push({id:id(100000+n*10000+m),workspace_id:ids.workspace,...(kind==='client'?{relationship_id:cid,direction:'inbound',provider:'meta_whatsapp',status:'received',sender_kind:'client'}:{conversation_id:cid,sender_user_id:ids.other,sender_workspace_role:'staff'}),body:`${name} message ${m}${m===backlog?' searchable-needle':''}`,created_at:`2026-10-01 00:${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}.123456+00`,attachment:null,edited_at:null})
 }
 async function rpc(name,args,request){
  if(rpcOverride){const result=await rpcOverride(name,args,request);if(result!==undefined)return result}
  if(name.startsWith('communication_')||name.startsWith('advance_communication_')){
   if(control.readGate&&name.startsWith('advance_'))await control.readGate
   if(control.readDelayMs&&name.startsWith('advance_'))await new Promise(r=>setTimeout(r,control.readDelayMs))
   if(control.previewGate&&name.includes('preview'))await control.previewGate
   if(control.previewDelayMs&&name.includes('preview'))await new Promise(r=>setTimeout(r,control.previewDelayMs))
   if(control.failRead&&name.startsWith('advance_'))throw Object.assign(Error('Synthetic rejected read'),{code:'08006'})
   const operation=sqlQueue.then(async()=>{let claims;try{claims=JSON.parse(Buffer.from(String(request.headers.authorization).split('.')[1],'base64url').toString())}catch{claims=sql.claims};await sql.setClaims(claims);const keys=Object.keys(args);if(keys.some(k=>!/^p_[a-z_]+$/.test(k))||!/^\w+$/.test(name))throw Error('Invalid fixture RPC');const rows=(await sql.db.query(`select to_jsonb(r) result from public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) r`,Object.values(args))).rows;return /communication_(client|native)_messages(_bounded)?$/.test(name)?rows.map(r=>r.result):rows[0]?.result});sqlQueue=operation.catch(()=>{});return operation
  }
  if(['record_workspace_admin_activity','report_platform_failure','record_chat_reading_activity','clear_read_chat_push_notifications'].includes(name))return null
  if(name==='workspace_shell_bootstrap')return {workspace_id:ids.workspace,workspace_name:workspace.name,workspace_slug:'fixture',role:'owner',username:'fixture',capabilities:['communications.manage','relationships.view'],allowed_service_ids:[],service_access_schema_ready:true}
  if(name==='account_devices')return {device_id:args.p_device,devices:[]}
  if(name==='client_conversation_rosters')return tables.relationships.map(r=>({relationship_id:r.id,manager_id:null,member_ids:[ids.me],optional_ids:[],eligible_ids:[]}))
  if(['client_conversation_can_access','native_conversation_can_read','native_conversation_can_write'].includes(name))return true
  if(['workspace_notifications','workspace_notification_count','workspace_shell_secondary'].includes(name))return []
  unexpected.push(`RPC ${name}`);throw Error(`Unhandled synthetic RPC ${name}`)
 }
 const emptyTables=new Set(['onboarding_services','onboarding_service_revisions','workspace_team_service_responsibilities','workspace_maintenance_routing','workspace_native_reactions','communication_reactions','communication_stickers','client_communication_channels','workspace_integrations','account_user_attributions','relationship_services','workspace_member_service_access','workspace_operational_roles','appointment_setting_setup_assignees','notifications','workspace_notifications','user_notification_preferences','workspace_notification_preferences','clients','communication_message_deliveries','workspace_admin_activity','workspace_launch_metrics','workspace_interaction_metrics'])
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1'),chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null
  const call={at:Date.now(),method:req.method,path:url.pathname,query:url.search,body};calls.push(call);res.once('finish',()=>{call.completedAt=Date.now();call.status=res.statusCode})
  res.setHeader('Content-Type','application/json');res.setHeader('Access-Control-Allow-Origin',req.headers.origin??'*');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,x-client-info,content-type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS')
  if(req.method==='OPTIONS'){res.end();return}
  let value
  if(url.pathname==='/__fixture/state')value={calls,unexpected,conversations}
  else if(url.pathname==='/__fixture/control'){Object.assign(control,body);value={ok:true}}
  else if(url.pathname==='/auth/v1/user'||url.pathname===`/auth/v1/admin/users/${ids.me}`)value=user
  else if(url.pathname==='/auth/v1/.well-known/jwks.json')value={keys:[]}
  else if(url.pathname.startsWith('/rest/v1/rpc/')){const operation=rpc(url.pathname.split('/').at(-1),body??{},req);pendingRpc.add(operation);try{value=await operation}finally{pendingRpc.delete(operation)}}
  else if(url.pathname.startsWith('/rest/v1/')){
   const table=url.pathname.split('/').at(-1)
   let rows=table==='communication_read_cursors'?(await sql.db.query('select *,last_read_at::text as last_read_at from communication_read_cursors')).rows:table==='workspace_native_read_cursors'?(await sql.db.query('select *,last_read_at::text as last_read_at from workspace_native_read_cursors')).rows:table==='client_messages'?messages.filter(m=>m.relationship_id):table==='workspace_native_messages'?messages.filter(m=>m.conversation_id):tables[table]??(emptyTables.has(table)?[]:null)
   if(rows===null){unexpected.push(`TABLE ${table}`);throw Error(`Unhandled synthetic table ${table}`)}
   for(const [key,filter]of url.searchParams){if(filter.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===filter.slice(3));else if(filter.startsWith('in.(')){const vals=filter.slice(4,-1).split(',').map(v=>v.replaceAll('"',''));rows=rows.filter(r=>vals.includes(String(r[key])))}else if(filter==='not.is.null')rows=rows.filter(r=>r[key]!=null)}
   const limit=Number(url.searchParams.get('limit'));if(limit>0)rows=rows.slice(0,limit)
   value=String(req.headers.accept).includes('vnd.pgrst.object')?rows[0]??null:rows
  }else{unexpected.push(url.pathname);throw Error(`Unhandled synthetic path ${url.pathname}`)}
  res.end(JSON.stringify(value))
 }catch(e){res.statusCode=500;res.end(JSON.stringify({message:e.message,code:e.code??'FIXTURE_UNHANDLED'}))}})
 const realtimeEvents=[]
 const sockets=new WebSocketServer({server})
 sockets.on('connection',socket=>socket.on('message',(bytes,binary)=>{
  let data,v2=true
  if(binary){
   // The installed SDK uses v2 binary envelopes for broadcasts. Only the
   // routing fields are needed to acknowledge this synthetic transport.
   if(bytes[0]!==3){unexpected.push('Unsupported Realtime binary envelope');return}
   let offset=7;const field=length=>{const value=bytes.subarray(offset,offset+length).toString();offset+=length;return value}
   data={join_ref:field(bytes[1]),ref:field(bytes[2]),topic:field(bytes[3]),event:'broadcast'}
  }else{
   const value=JSON.parse(bytes.toString());v2=Array.isArray(value)
   data=v2?{join_ref:value[0],ref:value[1],topic:value[2],event:value[3],payload:value[4]}:value
  }
  realtimeEvents.push({event:data.event,topic:data.topic})
  const send=(event,payload,ref=data.ref)=>socket.send(JSON.stringify(v2?[data.join_ref??null,ref??null,data.topic,event,payload]:{join_ref:data.join_ref,ref,topic:data.topic,event,payload}))
  if(['phx_join','phx_leave','heartbeat','presence','broadcast'].includes(data.event)){
   send('phx_reply',{status:'ok',response:data.event==='phx_join'?{postgres_changes:(data.payload?.config?.postgres_changes??[]).map((x,i)=>({...x,id:i+1}))}:{}})
   if(data.event==='phx_join'&&data.payload?.config?.presence?.enabled)send('presence_state',{},null)
  }
 }))
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve))
 return {server,sql,control,calls,unexpected,realtimeEvents,idle:async()=>{while(pendingRpc.size)await Promise.allSettled([...pendingRpc]);await sqlQueue},conversations,messages,tables,close:async()=>{for(const socket of sockets.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));await sql.close()}}
}
if(process.argv[1]===new URL(import.meta.url).pathname){await startFixture();console.log('Synthetic Supabase: http://127.0.0.1:45679')}
