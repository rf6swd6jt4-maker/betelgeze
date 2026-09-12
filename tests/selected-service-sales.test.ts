import test from "node:test"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import ts from "typescript"
import {validServiceSaleInput,serviceSaleTotals} from "../lib/service-pos.ts"
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const draft={relationshipVersion:"2026-09-12T12:00:00Z",managerId:id(1),billingInterval:"month",billingIntervalCount:1,lines:[{id:id(2),version:1,assigneeId:id(3),upfrontCents:50000,recurringCents:10000},{id:id(4),version:1,assigneeId:id(3),upfrontCents:30000,recurringCents:0}]}
test("sale drafts reject duplicate instances, fractional cents, invalid cadence and missing assignments",()=>{
 assert(validServiceSaleInput(draft))
 for(const input of [null,{}, {...draft,lines:[draft.lines[0],draft.lines[0]]},{...draft,billingIntervalCount:37},{...draft,lines:[{...draft.lines[0],upfrontCents:1.2}]},{...draft,lines:[{...draft.lines[0],assigneeId:""}]}])assert(!validServiceSaleInput(input))
 const rows=draft.lines.map(l=>({id:l.id,currency:"EUR"})) as Parameters<typeof serviceSaleTotals>[0]
 assert.deepEqual(serviceSaleTotals(rows,draft.lines),{upfront:80000,recurring:10000,currency:"EUR",mixedCurrencies:false})
 assert(serviceSaleTotals([{...rows[0],currency:"USD"},rows[1]],draft.lines).mixedCurrencies)
})
function compile(source:string,name:string,bindings:Record<string,unknown>){
 const js=ts.transpileModule(source.replace(/export async /g,"async "),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 return new Function(...Object.keys(bindings),`${js};return ${name}`)(...Object.values(bindings))
}
const checkoutSource=readFileSync(new URL("../lib/client-sales/onboarding-checkout.ts",import.meta.url),"utf8")
const createSource=checkoutSource.slice(checkoutSource.indexOf("export async function createOrReuseOnboardingCheckout"),checkoutSource.indexOf("export async function retrieveOnboardingCheckout"))
test("a lost Checkout acknowledgement retries identical parameters, including images and expiry",async()=>{
 let savedRequest:Record<string,unknown>|null=null,call=0
 const sent:Record<string,unknown>[]=[]
 const context={sessionId:"session",workspaceId:"workspace",relationshipId:"relationship",sale:{id:"sale",service_scope:"selected_services",status:"onboarding_payment_pending",client_name:"Client",client_email:"client@example.test",client_phone:"sms:+353850000000",currency:"eur",recurring_total_amount:10000,billing_interval:"month",billing_interval_count:1}}
 const db={rpc:async(_name:string,args:{p_request:Record<string,unknown>})=>{savedRequest??=args.p_request;return {data:{request:savedRequest}}},from:()=>{const chain:Record<string,unknown>={};for(const name of ["update","eq","select"])chain[name]=()=>chain;chain.maybeSingle=async()=>({data:{id:"sale"}});return chain}}
 const create=compile(createSource,"createOrReuseOnboardingCheckout",{
  supabaseAdmin:db,getOnboardingPaymentContext:async()=>context,onboardingPaymentReturnUrl:()=>"https://agency.example/onboarding/token",onboardingPaymentPending:()=>true,
  frozenCheckoutLineItems:async()=>[{name:"Meta Ads",amount:50000,imageUrl:`https://assets.example/signed-${++call}`},{name:"Landing page",amount:30000}],getWorkspaceProviderConfig:async()=>({secret_key:"fixture-only"}),
  createStripeMixedCheckout:async(request:Record<string,unknown>)=>{sent.push(request);if(sent.length===1)throw new Error("Acknowledgement lost");return {customerId:"cus_fixture",checkoutSessionId:"cs_fixture",checkoutStatus:"open",checkoutUrl:"https://checkout.example/fixture",expiresAt:"2026-09-13T12:00:00Z"}},
 })
 await assert.rejects(create({token:"token",origin:"https://agency.example"}),/Acknowledgement lost/)
 assert.equal((await create({token:"token",origin:"https://agency.example"})).checkoutUrl,"https://checkout.example/fixture")
 assert.deepEqual(sent[0],sent[1]);assert.equal(call,2)
})
test("a paid selected-service Checkout does not advance the legacy relationship workflow",async()=>{
 const source=readFileSync(new URL("../lib/client-sales/automation.ts",import.meta.url),"utf8")
 const body=source.slice(source.indexOf("export async function handleCompletedStripeCheckout"),source.indexOf("async function findPendingConfirmedSale"))
 let oldAdvances=0
 for(const scope of ["selected_services","relationship"]){
  const responses=[{data:{id:"sale",workspace_id:"workspace",status:"onboarding_payment_pending",service_scope:scope}},{data:{id:"sale"}}]
  const db={from:()=>{const response=responses.shift();const chain:Record<string,unknown>={};for(const n of ["select","eq","update","in"])chain[n]=()=>chain;chain.maybeSingle=async()=>response;return chain}}
  const run=compile(body,"handleCompletedStripeCheckout",{supabaseAdmin:db,ensurePaidOnboardingSession:async()=>({sessionId:"session",relationshipId:"relationship"}),activateRelationshipOnboardingAfterPayment:async()=>{oldAdvances++},reportSaleAutomationFailure:async()=>assert.fail("Unexpected failure")})
  assert((await run({id:"checkout",payment_status:"paid",metadata:{client_sale_id:"sale"}},"workspace")).ok)
  assert.equal(oldAdvances,scope==="selected_services"?0:1)
 }
})
test("confirmation webhook replay resolves its original sale before looking for another pending sale",async()=>{
 const source=readFileSync(new URL("../lib/client-sales/automation.ts",import.meta.url),"utf8")
 const body=source.slice(source.indexOf("async function findPendingConfirmedSale"),source.indexOf("async function firstUnarchivedRelationshipSale"))
 let queries=0
 const db={from:()=>{queries++;const chain:Record<string,unknown>={};for(const n of ["select","eq","limit"])chain[n]=()=>chain;chain.maybeSingle=async()=>({data:{id:"original-sale",consent_confirmed_at:"2026-09-12"}});return chain}}
 const find=compile(body,"findPendingConfirmedSale",{supabaseAdmin:db,firstUnarchivedRelationshipSale:async (rows:unknown[])=>rows[0]})
 assert.equal((await find("sms:+353850000000","workspace","message-id")).id,"original-sale")
 assert.equal(queries,1)
})
