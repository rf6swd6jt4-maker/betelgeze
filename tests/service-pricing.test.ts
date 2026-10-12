import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { servicePricingText, billingCadence, validBillingSchedule } from "../lib/service-pricing.ts"
import { validPriceCorrection } from "../lib/client-sales/price-correction-types.ts"
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`
test("additional fees and first recurring payments produce an explicit first payment",()=>{
 assert.equal(servicePricingText({upfrontCents:50000,recurringCents:150000,currency:"USD",billingInterval:"month",billingIntervalCount:1}),"$2,000.00 at checkout; then $1,500.00 every month")
 assert.equal(servicePricingText({upfrontCents:0,recurringCents:150000,currency:"USD",billingInterval:"month",billingIntervalCount:1}),"$1,500.00 at checkout; then $1,500.00 every month")
 assert.equal(servicePricingText({upfrontCents:50000,recurringCents:0,currency:"USD"}),"$500.00 at checkout; no recurring payments")
 assert.equal(billingCadence("year",1),"every year");assert.equal(billingCadence("month",3),"every 3 months")
 assert.equal(billingCadence(null,null),"per billing period");assert(!validBillingSchedule("month",0));assert(!validBillingSchedule("year",4))
})
const input={requestId:id(1),saleId:id(2),expectedVersion:0,reason:"Correct the agreed fee",terms:{billingInterval:"month",billingIntervalCount:1,upfrontTotal:50000,recurringTotal:150000,lines:[{id:id(3),upfrontCents:50000,recurringCents:150000}]}}
test("corrections reject mismatched first totals, missing identities and unsafe prices",()=>{
 assert(validPriceCorrection(input))
 for(const value of [null,{}, {...input,reason:""},{...input,expectedVersion:-1},{...input,terms:{...input.terms,upfrontTotal:200000}},{...input,terms:{...input.terms,billingIntervalCount:1.5}},{...input,terms:{...input.terms,lines:[...input.terms.lines,...input.terms.lines]}},{...input,terms:{...input.terms,lines:[{id:id(3),upfrontCents:-50000,recurringCents:150000}]}}])assert(!validPriceCorrection(value))
})
function compile(source:string,name:string,bindings:Record<string,unknown>){
 const js=ts.transpileModule(source.replace(/export async /g,"async "),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 return new Function(...Object.keys(bindings),`${js};return ${name}`)(...Object.values(bindings))
}
const src=readFileSync(new URL("../lib/client-sales/price-correction.ts",import.meta.url),"utf8")
const body=src.slice(src.indexOf("export async function correctUnpaidSalePrices"))
function fixture(options:{status?:string;payment?:string;expireFails?:boolean;afterFailure?:string;identity?:string;beginState?:string;finishFails?:boolean}={}){
 const calls:string[]=[],finished:boolean[]=[]
 let reads=0
 const raw=(status:string)=>({id:"cs_fixture",status,payment_status:options.payment??"unpaid",metadata:{client_sale_id:options.identity??id(2),workspace_id:"workspace"}})
 const run=compile(body,"correctUnpaidSalePrices",{
  supabaseAdmin:{rpc:async(name:string,args:Record<string,unknown>)=>{calls.push(name);if(name.startsWith("begin"))return{data:{previous_checkout_id:"cs_fixture",state:options.beginState??"pending"}};finished.push(Boolean(args.p_accept));return options.finishFails?{error:{message:"lost"}}:{data:{state:args.p_accept?"committed":"rejected"}}}},
  getWorkspaceProviderConfig:async()=>({secret_key:"fixture-only"}),
  retrieveStripeCheckoutSession:async()=>{calls.push("retrieve");return raw(++reads===1?options.status??"open":options.afterFailure??"open")},
  expireStripeCheckoutSession:async()=>{calls.push("expire");if(options.expireFails)throw Error("provider failure");return raw("expired")},
  getCheckoutFields:(x:ReturnType<typeof raw>)=>({checkoutSessionId:x.id,checkoutStatus:x.status,paymentStatus:x.payment_status,metadata:x.metadata}),
  handleCompletedStripeCheckout:async()=>{calls.push("record payment");return {ok:true}},
 })
 return {calls,finished,run:()=>run("workspace","relationship","actor",input)}
}
test("correction reserves before provider calls and commits only after verified expiry",async()=>{
 const f=fixture();assert((await f.run()).ok);assert.deepEqual(f.calls,["begin_client_sale_price_correction","retrieve","expire","finish_client_sale_price_correction"]);assert.deepEqual(f.finished,[true])
})
test("a payment winning the expiry race rejects the amendment",async()=>{
 const f=fixture({expireFails:true,afterFailure:"complete"});const result=await f.run();assert(!result.ok);assert.equal(result.uncertain,false);assert.deepEqual(f.finished,[false])
 const paid=fixture({status:"complete",payment:"paid"});assert(!(await paid.run()).ok);assert(paid.calls.includes("record payment"));assert(!paid.calls.includes("expire"));assert.deepEqual(paid.finished,[false])
})
test("unknown provider state and wrong identities leave correction reserved for recovery",async()=>{
 for(const options of [{expireFails:true},{identity:id(9)},{finishFails:true}]){const f=fixture(options);const result=await f.run();assert(!result.ok);assert.equal(result.uncertain,true);if(!options.finishFails)assert.deepEqual(f.finished,[])}
})
test("lost expiry acknowledgement recovers the expired session; committed replay makes no provider call",async()=>{
 const f=fixture({expireFails:true,afterFailure:"expired"});assert((await f.run()).ok);assert.deepEqual(f.finished,[true])
 const replay=fixture({beginState:"committed"});assert((await replay.run()).ok);assert.deepEqual(replay.calls,["begin_client_sale_price_correction"])
})

test("stale or missing payment-page revisions cannot reuse a corrected checkout",async()=>{
 const source=readFileSync(new URL("../lib/client-sales/onboarding-checkout.ts",import.meta.url),"utf8")
 const checkoutBody=source.slice(source.indexOf("export async function createOrReuseOnboardingCheckout"),source.indexOf("export async function retrieveOnboardingCheckout"))
 let version=1, correcting:string|null=null,paid=false,providerCalls=0
 const run=compile(checkoutBody,"createOrReuseOnboardingCheckout",{
  getOnboardingPaymentContext:async()=>({sale:{pricing_revision:version,pricing_correction_id:correcting,stripe_checkout_url:"https://checkout.stripe.test/saved",stripe_checkout_expires_at:new Date(Date.now()+3600000).toISOString()}}),
  onboardingPaymentReturnUrl:()=>"https://onboarding.test/return",onboardingPaymentPending:()=>!paid,
  CHECKOUT_PRICES_CHANGED:"Prices changed",getWorkspaceProviderConfig:async()=>{providerCalls++;throw Error("Unexpected provider call")},
 })
 await assert.rejects(run({token:"token",origin:"https://onboarding.test"}),/Prices changed/)
 await assert.rejects(run({token:"token",origin:"https://onboarding.test",pricingRevision:0}),/Prices changed/)
 assert.equal((await run({token:"token",origin:"https://onboarding.test",pricingRevision:1})).checkoutUrl,"https://checkout.stripe.test/saved")
 correcting=id(1);await assert.rejects(run({token:"token",origin:"https://onboarding.test",pricingRevision:1}),/being corrected/)
 correcting=null;version=0;assert.equal((await run({token:"token",origin:"https://onboarding.test"})).paid,false)
 paid=true;version=2;assert.equal((await run({token:"token",origin:"https://onboarding.test"})).paid,true)
 assert.equal(providerCalls,0)
})

test("Stripe receives the additional fee and full first recurring period with an explicit fee label",async()=>{
 const source=readFileSync(new URL("../lib/stripe/api.ts",import.meta.url),"utf8")
 const body=source.slice(source.indexOf("export async function createStripeMixedCheckout"),source.indexOf("export async function retrieveStripeCheckoutSession"))
 const calls:Array<{path:string;params:Record<string,unknown>}>=[]
 const run=compile(body,"createStripeMixedCheckout",{stripeRequest:async(path:string,{params}:{params:Record<string,unknown>})=>{calls.push({path,params});return{id:path==="/customers"?"cus_test":"cs_test"}},asStripeId:(x:{id:string})=>x.id,getStripeCustomerPhone:(x:string)=>x,getCheckoutFields:()=>({checkoutSessionId:"cs_test",checkoutUrl:"https://checkout.stripe.test/saved"})})
 const base={saleId:id(2),workspaceId:id(4),relationshipId:id(5),name:"Test",email:"test@example.test",currency:"usd",serviceKeys:["test"],interval:"month",intervalCount:1,secretKey:"fixture",successUrl:"https://example.test/success",cancelUrl:"https://example.test/cancel",expiresAt:1234567890}
 await run({...base,lineItems:[{serviceKey:"test",name:"Growth",description:"Growth service",amount:50000,billingComponent:"upfront"},{serviceKey:"test",name:"Growth",description:"Growth service",amount:150000,billingComponent:"recurring"}]})
 const params=calls[1].params
 assert.equal(params.mode,"subscription");assert.equal(params["line_items[0][price_data][unit_amount]"],50000);assert.equal(params["line_items[1][price_data][unit_amount]"],150000)
 assert.equal(params["line_items[0][price_data][product_data][name]"],"Growth (additional one-time fee)")
 assert.equal(params["line_items[0][price_data][recurring][interval]"],undefined)
 assert.equal(params["line_items[1][price_data][recurring][interval]"],"month")
 assert(!Object.keys(params).some(key=>/trial|billing_cycle_anchor/.test(key)))
 assert.equal(calls.length,2)
})

test("amended Checkout uses exact corrected frozen-line identities and totals",async()=>{
 const source=readFileSync(new URL("../lib/client-sales/onboarding-checkout.ts",import.meta.url),"utf8")
 const body=source.slice(source.indexOf("async function frozenCheckoutLineItems"),source.indexOf("export const CHECKOUT_PRICES_CHANGED"))
 const items=[1,2].map(n=>({id:id(n),service_code:`service-${n}`,service_name:`Service ${n}`,service_revision_id:null,description:'Service',upfront_amount_cents:75000,recurring_amount_cents:75000}))
 const run=compile(body,"frozenCheckoutLineItems",{
  supabaseAdmin:{from:(table:string)=>{assert.equal(table,"client_sale_items");const chain={select:()=>chain,eq:()=>chain,order:async()=>({data:items,error:null})};return chain}},
  resolveServiceThumbnailUrl:async()=>null,
 })
 const context={workspaceId:id(4),sale:{id:id(5),upfront_total_amount:150000,recurring_total_amount:150000,pricing_override:null as unknown}}
 assert.equal((await run(context,Date.now()/1000+3600,"https://example.test")).reduce((sum:number,line:{amount:number})=>sum+line.amount,0),300000)
 context.sale.upfront_total_amount=0
 context.sale.pricing_override={linePrices:{[id(1)]:{upfrontCents:0,recurringCents:75000},[id(2)]:{upfrontCents:0,recurringCents:75000}}}
 const corrected=await run(context,Date.now()/1000+3600,"https://example.test")
 assert.equal(corrected.length,2);assert(corrected.every((line:{billingComponent:string;amount:number})=>line.billingComponent==='recurring'&&line.amount===75000))
 context.sale.recurring_total_amount=149999
 await assert.rejects(run(context,Date.now()/1000+3600,"https://example.test"),/recorded total differs/)
 context.sale.recurring_total_amount=150000;context.sale.pricing_override={linePrices:{[id(1)]:{upfrontCents:0,recurringCents:150000}}}
 await assert.rejects(run(context,Date.now()/1000+3600,"https://example.test"),/corrected service prices need review/)
})
