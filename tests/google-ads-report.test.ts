import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { generateKeyPairSync } from "node:crypto"
import ts from "typescript"
const require = createRequire(import.meta.url)
function load(file: string): Record<string, unknown> {
    const m = { exports: {} }
    new Function("require", "module", "exports", ts.transpileModule(readFileSync(`lib/${file}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((p: string) => p === "./google-ads-report" ? load("google-ads-report") : require(p), m, m.exports)
    return m.exports
}
const { googleAdsDateRange, googleAdsReportKindsForServices, isGoogleAdsService, isLegacyGoogleAdsServiceName, parseGoogleAdsMetrics, parseGoogleAdsCampaignMetrics, parseGoogleLocalServicesLeads } = load("google-ads-report") as typeof import('../lib/google-ads-report')
const { fetchGoogleAdsReport, normalizeGoogleAdsConfig } = load("google-ads") as typeof import('../lib/google-ads')
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const config = { manager_customer_id: '1234567890', client_email: 'report@project.iam.gserviceaccount.com', private_key: keys.privateKey.export({type:'pkcs8',format:'pem'}).toString() }
test('rolling report dates include today in the account timezone across UTC and DST boundaries', () => {
    assert.deepEqual(googleAdsDateRange('last7','America/Chicago',new Date('2026-09-12T02:00:00Z')), {startDate:'2026-09-05',endDate:'2026-09-11'})
    assert.deepEqual(googleAdsDateRange('month','Pacific/Auckland',new Date('2026-09-30T20:00:00Z')), {startDate:'2026-10-01',endDate:'2026-10-01'})
    assert.deepEqual(googleAdsDateRange('last30','America/Chicago',new Date('2026-03-09T10:00:00Z')), {startDate:'2026-02-08',endDate:'2026-03-09'})
})
test('service identities select separate Search and Local Services reports with a legacy Search fallback', () => {
    assert.deepEqual(googleAdsReportKindsForServices([{serviceKey:'generated',templateId:'google-local-services-ads'}]),['local_services'])
    assert.deepEqual(googleAdsReportKindsForServices([{serviceKey:'generated-a',templateId:'google-search-ads'},{serviceKey:'generated-b',templateId:'google-local-services-ads'}]),['search','local_services'])
    assert.deepEqual(googleAdsReportKindsForServices([{serviceKey:'google-ads'}]),['search'])
    assert.deepEqual(googleAdsReportKindsForServices([]),['search'])
    assert.equal(isGoogleAdsService({serviceKey:'generated',templateId:'google-search-ads'}),true)
    assert.equal(isGoogleAdsService({serviceKey:'google-local-services-ads'}),true)
    assert.equal(isGoogleAdsService({serviceKey:'meta-ads-setup',templateId:'meta-ads-setup'}),false)
    assert.equal(isLegacyGoogleAdsServiceName('Google Search Ads'),true)
    assert.equal(isLegacyGoogleAdsServiceName('Meta Ads Setup'),false)
})
test('reports preserve fractional conversions, micros, zero versus failures and reject unsafe numbers', () => {
    assert.deepEqual(parseGoogleAdsMetrics({results:[{metrics:{costMicros:'1500001',clicks:'3',impressions:'10',conversions:0.5}}]}),{spend:1.500001,clicks:3,impressions:10,conversions:0.5,costPerConversion:3.000002})
    assert.equal(parseGoogleAdsMetrics({results:[]}).costPerConversion,null)
    for (const bad of [null,{results:[{}]},{results:[{},{}]},{nextPageToken:'more'}, {results:[{metrics:{clicks:'9007199254740993'}}]}, {results:[{metrics:{conversions:'bad'}}]}]) assert.throws(()=>parseGoogleAdsMetrics(bad))
})
test('campaign and Local Services report parsers stay bounded and preserve service-specific totals', () => {
    assert.deepEqual(parseGoogleAdsCampaignMetrics({results:[{metrics:{costMicros:'1000000',clicks:'2',impressions:'10',conversions:0.5}},{metrics:{costMicros:'2000000',clicks:'3',impressions:'20',conversions:1}}]}),{spend:3,clicks:5,impressions:30,conversions:1.5,costPerConversion:2})
    assert.deepEqual(parseGoogleLocalServicesLeads({results:[
        {localServicesLead:{leadCharged:true,leadStatus:'BOOKED',leadType:'PHONE_CALL',creditDetails:{creditState:'CREDITED'}}},
        {localServicesLead:{leadCharged:false,leadStatus:'NEW',leadType:'MESSAGE',creditDetails:{creditState:'PENDING'}}},
        {localServicesLead:{leadCharged:true,leadStatus:'ACTIVE',leadType:'BOOKING'}},
    ]},30),{leads:3,chargedLeads:2,bookedLeads:1,creditedLeads:1,phoneLeads:1,messageLeads:1,bookingLeads:1,costPerLead:10})
    assert.throws(()=>parseGoogleAdsCampaignMetrics({results:Array.from({length:1001},()=>({metrics:{}}))}),/too large/)
    assert.throws(()=>parseGoogleLocalServicesLeads({results:[],nextPageToken:'more'},0),/too large/)
})
test('Search reporting queries only Search campaigns for the verified customer without developer tokens', async () => {
    assert.equal(normalizeGoogleAdsConfig(config).developer_token,'')
    const calls: Array<{url:string;body:Record<string,unknown>}> = []
    const fetcher: typeof fetch = async (url,init) => {
        calls.push({url:String(url),body:typeof init?.body==='string'?JSON.parse(init.body):{}})
        assert.equal(new Headers(init?.headers).has('developer-token'),false)
        if(calls.length===1)return Response.json({access_token:'secret'})
        if(calls.length===2)return Response.json({results:[{customer:{id:'2345678901',currencyCode:'USD',timeZone:'America/Chicago'}}]})
        return Response.json({results:[{metrics:{costMicros:'24000000',clicks:'12',impressions:'120',conversions:3}}]})
    }
    const r=await fetchGoogleAdsReport(config,'2345678901','last7','search',fetcher,new Date('2026-09-12T02:00:00Z'))
    assert.equal(r.kind,'search');if(r.kind==='search'){assert.equal(r.spend,24);assert.equal(r.costPerConversion,8)}assert.equal(calls.length,3)
    assert.ok(calls.slice(1).every(c=>c.url.includes('/customers/2345678901/')))
    assert.match(String(calls[2].body.query),/FROM campaign WHERE campaign\.advertising_channel_type = 'SEARCH'/)
    assert.match(String(calls[2].body.query),/LIMIT 1001/)
    assert.doesNotMatch(JSON.stringify(r),/secret|PRIVATE KEY/)
})
test('Local Services reporting combines bounded campaign spend with dedicated lead records', async () => {
    const calls: Array<Record<string,unknown>>=[]
    const fetcher: typeof fetch = async (_url,init) => {
        const body=typeof init?.body==='string'?JSON.parse(init.body):{};calls.push(body)
        if(calls.length===1)return Response.json({access_token:'secret'})
        if(calls.length===2)return Response.json({results:[{customer:{id:'2345678901',currencyCode:'USD',timeZone:'America/Chicago'}}]})
        if(String(body.query).includes("advertising_channel_type = 'LOCAL_SERVICES'"))return Response.json({results:[{metrics:{costMicros:'18000000'}}]})
        return Response.json({results:[{localServicesLead:{leadCharged:true,leadStatus:'BOOKED',leadType:'PHONE_CALL'}}]})
    }
    const report=await fetchGoogleAdsReport(config,'2345678901','last30','local_services',fetcher,new Date('2026-09-12T02:00:00Z'))
    assert.equal(report.kind,'local_services');if(report.kind==='local_services'){assert.equal(report.spend,18);assert.equal(report.leads,1);assert.equal(report.costPerLead,18)}
    assert.equal(calls.length,4)
    assert.match(String(calls[2].query),/pmax_campaign_settings\.local_services_enabled = TRUE/)
    assert.match(String(calls[3].query),/FROM local_services_lead/)
})
test('wrong account identity, Google test accounts and failed reports never become zero metrics', async () => {
    for(const account of [{id:'9999999999'},{id:'2345678901',testAccount:true}]) {
        let calls=0
        await assert.rejects(fetchGoogleAdsReport(config,'2345678901','last30','search',async()=>++calls===1?Response.json({access_token:'secret'}):Response.json({results:[{customer:{currencyCode:'USD',timeZone:'America/Chicago',...account}}]})),/reporting settings/)
        assert.equal(calls,2)
    }
    let calls=0
    await assert.rejects(fetchGoogleAdsReport(config,'2345678901','last30','search',async()=>++calls===1?Response.json({access_token:'secret'}):calls===2?Response.json({results:[{customer:{id:'2345678901',currencyCode:'USD',timeZone:'America/Chicago'}}]}):Response.json({error:{message:'private'}},{status:403})),/denied API access/)
})

test('connection HTTP boundary rejects cross-site requests and bounds streamed request bodies', async () => {
    const { googleAdsBody } = load('google-ads/http') as typeof import('../lib/google-ads/http')
    const req=(headers:Record<string,string>,body:string)=>new Request('https://portal.example/api/connection',{method:'POST',headers,body})
    await assert.rejects(googleAdsBody(req({'content-type':'application/json',origin:'https://evil.example'},'{}')),/connection form/)
    await assert.rejects(googleAdsBody(req({'content-type':'application/json','sec-fetch-site':'cross-site'},'{}')),/connection form/)
    await assert.rejects(googleAdsBody(req({'content-type':'application/json'},JSON.stringify({extra:'x'.repeat(3000)}))),/too long/)
    await assert.rejects(googleAdsBody(req({'content-type':'application/json'},'[]')),/valid connection/)
    assert.deepEqual(await googleAdsBody(req({'content-type':'application/json',origin:'https://portal.example'},'{"action":"verify"}')),{action:'verify'})
})
