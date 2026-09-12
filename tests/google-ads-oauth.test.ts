import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
function load(runner: unknown = async () => ({ status: "pending" })) {
    const m = { exports: {} }
    new Function("require", "module", "exports", ts.transpileModule(readFileSync("lib/google-ads/oauth-provider.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((p: string) => { assert.equal(p, "@/lib/google-ads"); return { connectGoogleAdsClient: runner } }, m, m.exports)
    return m.exports as typeof import('../lib/google-ads/oauth-provider')
}
const client = '2345678901', manager = '1234567890', other = '3456789012'
const account = {id: client, descriptiveName:'Advertising account',status:'ENABLED',manager:false,testAccount:false}
test('OAuth discovery only exposes exact real enabled accounts and prefers direct access',async()=>{
    const {discoverAdsAccounts}=load()
    const result=await discoverAdsAccounts('user-secret',async(url,init)=>{
        assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer user-secret')
        assert.equal(new Headers(init?.headers).has('developer-token'),false)
        if(String(url).includes('listAccessible'))return Response.json({resourceNames:[`customers/${manager}`,`customers/${client}`,'malformed']})
        const q=JSON.parse(String(init?.body)).query
        if(q.includes('FROM customer_client'))return Response.json({results:[{customerClient:account},{customerClient:{...account,id:other,testAccount:true}},{customerClient:{...account,id:'4567890123',status:'CANCELED'}}]})
        return Response.json({results:[{customer:String(url).includes(manager)?{id:manager,manager:true}:account}]})
    })
    assert.deepEqual(result.choices,[{id:client,name:account.descriptiveName,loginId:client}])
    assert.equal(result.limited,false)
    assert.doesNotMatch(JSON.stringify(result),/user-secret/)
})
test('OAuth discovery caps roots and marks inaccessible branches instead of guessing',async()=>{
    let count=0
    const result=await load().discoverAdsAccounts('secret',async(url)=>{
        if(String(url).includes('listAccessible'))return Response.json({resourceNames:Array.from({length:20},(_,i)=>`customers/${1000000000+i}`)})
        count++;return Response.json({error:'private provider payload'},{status:403})
    })
    assert.equal(count,8);assert.equal(result.limited,true);assert.deepEqual(result.choices,[])
})
test('OAuth accepts only the selected account and exact invited manager, then verifies through agency',async()=>{
    let managerCalls=0,accepted=false
    const {oauthConnectionRunner}=load(async()=>{managerCalls++;return managerCalls===1?{status:'pending'}:{status:'connected',accountName:'Account'}})
    const fetcher:typeof fetch=async(url,init)=>{
        const body=JSON.parse(String(init?.body));assert.equal(new Headers(init?.headers).get('login-customer-id'),client)
        if(String(url).includes('customerManagerLinks:mutate')){assert.deepEqual(body,{operations:[{update:{resourceName:`customers/${client}/customerManagerLinks/${manager}~42`,status:'ACTIVE'},updateMask:'status'}]});accepted=true;return Response.json({results:[{}]})}
        if(body.query.includes('FROM customer_manager_link'))return Response.json({results:[{customerManagerLink:{resourceName:`customers/${client}/customerManagerLinks/${manager}~42`,status:'PENDING'}}]})
        return Response.json({results:[{customer:account}]})
    }
    const runner=oauthConnectionRunner('user-secret',{id:client,name:'Account',loginId:client})
    assert.equal((await runner({manager_customer_id:manager},client,true,fetcher)).status,'connected');assert.equal(accepted,true);assert.equal(managerCalls,2)
    await assert.rejects(runner({manager_customer_id:manager},other,true,fetcher),/Choose an account/)
})
test('insufficient client approval access remains pending and never appears connected',async()=>{
    let count=0
    const runner=load().oauthConnectionRunner('secret',{id:client,name:'Account',loginId:client})
    assert.equal((await runner({manager_customer_id:manager},client,true,async()=>++count===1?Response.json({results:[{customer:account}]}):Response.json({error:'sensitive'},{status:403}))).status,'pending')
})
test('wrong selected identity fails before agency invitation',async()=>{
    let called=false
    const runner=load(async()=>{called=true}).oauthConnectionRunner('secret',{id:client,name:'Account',loginId:client})
    await assert.rejects(runner({manager_customer_id:manager},client,true,async()=>Response.json({results:[{customer:{...account,id:other}}]})),/unavailable/)
    assert.equal(called,false)
})

async function serverFixture() {
    const crypto = await import('node:crypto')
    const rows: Array<Record<string,unknown>>=[];const jar=new Map<string,string>();let revoked=false, encrypted='manager-config', providerCalls=0
    const cfg={id:process.env.GOOGLE_ADS_OAUTH_CLIENT_ID,secret:process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET}
    process.env.GOOGLE_ADS_OAUTH_CLIENT_ID='test-client';process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET='test-secret'
    const integration=()=>{if(revoked)throw new Error('revoked');return {access:{workspace:{id:'workspace',name:'Agency'},relationship:{id:'relationship'}},integration:{config_encrypted:encrypted,config_hint:{},connected_account_id:manager}}}
    const admin={rpc:async(_name:string,args:Record<string,unknown>)=>{rows.splice(0,rows.length,{state_hash:args.p_state_hash,context_encrypted:args.p_context,phase:'prepared',expires_at:new Date(Date.now()+600000).toISOString(),choices:[],limited:false});return {error:null}},from:()=>{
        const filters:Array<(r:Record<string,unknown>)=>boolean>=[];let update:Record<string,unknown>|null=null
        const q={select:()=>q,update:(v:Record<string,unknown>)=>{update=v;return q},eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q},gt:(k:string,v:string)=>{filters.push(r=>String(r[k])>v);return q},maybeSingle:async()=>{const row=rows.find(r=>filters.every(f=>f(r)));if(row&&update)Object.assign(row,update);return {data:row?{...row}:null,error:null}}};return q
    }}
    const m={exports:{}}
    const deps:Record<string,unknown>={
        'node:crypto':crypto,'next/headers':{cookies:async()=>({get:(key:string)=>jar.has(key)?{value:jar.get(key)}:undefined})},
        '@/lib/supabase/admin':{supabaseAdmin:admin},
        '@/lib/workspace-integrations':{encryptIntegrationCredential:(v:unknown)=>JSON.stringify(v),decryptWorkspaceIntegration:(v:string)=>JSON.parse(v)},
        '@/lib/onboarding/google-ads-server':{},'@/lib/client-portal/google-ads-server':{portalGoogleAdsContext:async()=>integration()},
        './connection-server':{runGoogleAdsConnection:async()=>{providerCalls++;return {status:'connected'}}},
        './oauth-provider':{ADS_SCOPE:'https://www.googleapis.com/auth/adwords',discoverAdsAccounts:async()=>{providerCalls++;return {choices:[{id:client,name:'Account',loginId:client}],limited:false}},oauthConnectionRunner:()=>{}}
    }
    new Function('require','module','exports',ts.transpileModule(readFileSync('lib/google-ads/oauth-server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)((p:string)=>{assert.ok(p in deps,p);return deps[p]},m,m.exports)
    const api=m.exports as typeof import('../lib/google-ads/oauth-server')
    const prepared=await api.prepareOAuth({token:'portal-bearer'},'https://portal.example.com'),state=new URL(prepared.url).searchParams.get('state')!
    return {api,state,rows,jar,revoke:()=>{revoked=true},rotate:()=>{encrypted='rotated'},calls:()=>providerCalls,restore:()=>{for(const [key,value] of [['GOOGLE_ADS_OAUTH_CLIENT_ID',cfg.id],['GOOGLE_ADS_OAUTH_CLIENT_SECRET',cfg.secret]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value}}}
}
test('OAuth state is single-use, browser-bound, expiring and revoked sources cannot proceed',async()=>{
    for(const scenario of ['missing-browser','wrong-browser','expired','revoked','rotated','replay']){
        const f=await serverFixture()
        try{
            const started=await f.api.startOAuth(f.state)
            const authorization=new URL(started.url)
            assert.equal(authorization.searchParams.get('redirect_uri'),'https://app.betelgeze.com/api/google-ads/oauth/callback')
            assert.equal(authorization.searchParams.get('code_challenge_method'),'S256')
            assert.equal(authorization.searchParams.get('access_type'),'online')
            assert.doesNotMatch(started.url,/portal-bearer|test-secret/)
            await assert.rejects(f.api.startOAuth(f.state),/expired/)
            if(scenario!=='missing-browser')f.jar.set(f.api.oauthCookieName(f.state),scenario==='wrong-browser'?'different':started.browser)
            if(scenario==='expired')f.rows[0].expires_at=new Date(0).toISOString()
            if(scenario==='revoked')f.revoke()
            if(scenario==='rotated')f.rotate()
            if(scenario==='replay')f.rows[0].phase='exchanging'
            await assert.rejects(f.api.callbackOAuth(f.state,'code',false))
            assert.equal(f.calls(),0)
        }finally{f.restore()}
    }
})
test('OAuth selection requires explicit consent and an account from the saved Google response',async()=>{
    const f=await serverFixture()
    try{
        const start=await f.api.startOAuth(f.state);f.jar.set(f.api.oauthCookieName(f.state),start.browser)
        Object.assign(f.rows[0],{phase:'ready',credential_encrypted:JSON.stringify({payload:JSON.stringify({token:'user-token'})}),choices:[{id:client,name:'Account',loginId:client}]})
        await assert.rejects(f.api.connectOAuth(f.state,client,false));await assert.rejects(f.api.connectOAuth(f.state,other,true),/Choose an account/)
        assert.equal(f.calls(),0)
        assert.equal((await f.api.connectOAuth(f.state,client,true)).status,'connected')
        assert.equal(f.rows[0].credential_encrypted,null);assert.deepEqual(f.rows[0].choices,[])
        await assert.rejects(f.api.connectOAuth(f.state,client,true))
        assert.equal(f.calls(),1)
    }finally{f.restore()}
})
