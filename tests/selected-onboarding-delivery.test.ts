import test from "node:test"
import assert from "node:assert/strict"
import { selectedOnboardingDestinations } from "../lib/onboarding/selected-delivery.ts"
import type { MessagingChoice } from "../lib/relationship-contacts.ts"
const wa: MessagingChoice={provider:"meta_whatsapp",address:"+353850000001",added:true,enabled:true,state:"active",confirmedAt:"2026-09-13T10:00:00Z",confirmationStatus:"confirmed",optedIn:true,canSend:true}
const sms: MessagingChoice={...wa,provider:"twilio_sms",address:"+353850000002"}
test("onboarding delivery uses the frozen chosen channels and leaves legacy routing alone",()=>{
 assert.equal(selectedOnboardingDestinations({},[wa,sms]),null)
 assert.deepEqual(selectedOnboardingDestinations({delivery_choices:[{provider:sms.provider,address:sms.address}]},[wa,sms]),[{provider:"twilio_sms",address:"sms:+353850000002",channelId:null,primary:true}])
 assert.equal(selectedOnboardingDestinations({delivery_choices:[{provider:wa.provider,address:wa.address},{provider:sms.provider,address:sms.address}]},[wa,sms])?.length,2)
})
test("changed addresses, missing confirmations, disabled providers and invalid snapshots cannot redirect a saved link",()=>{
 const payload={delivery_choices:[{provider:wa.provider,address:wa.address}]}
 for(const current of [[{...wa,address:"+353850000099"}],[{...wa,state:"inactive" as const}],[{...wa,canSend:false}],[{...wa,state:"broken" as const}],[]]) assert.throws(()=>selectedOnboardingDestinations(payload,current),/changed or is unavailable/)
 for(const delivery_choices of [[],null,[payload.delivery_choices[0],payload.delivery_choices[0]]]) assert.throws(()=>selectedOnboardingDestinations({delivery_choices},[wa]),/need review/)
})
