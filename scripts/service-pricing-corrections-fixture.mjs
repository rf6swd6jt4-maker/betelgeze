import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { repositoryRoot } from './pglite-fixture.mjs'
export async function validatePricingCorrections({db,q,one,w,owner,seller,staff,relationship,service,revision,add,uuid,pass}) {
    await db.exec(`create or replace function record_workspace_admin_activity(p_workspace_id uuid,p_area text,p_event text,p_title text,p_entity_type text default null,p_entity_id text default null,p_actor_kind text default null,p_correlation_id uuid default null,p_idempotency_key text default null,p_metadata jsonb default '{}',p_actor_user_id uuid default null,p_source_href text default null) returns uuid language sql as $$ select gen_random_uuid() $$;`)
    await db.exec(`alter table client_sales add column initial_payment_received_at timestamptz, add column stripe_subscription_id text`)
    const measure = process.env.BE_PRICING_MEASURE === '1'
    for(const migration of ['20260922190000_client_sale_commercial_adjustments.sql','20260922200000_cancel_relationship_service.sql']) await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/${migration}`,'utf8'))
    if (measure) for (const [name,args] of [['read_relationship_service_pos','uuid,uuid,uuid,integer'],['read_relationship_service_cards','uuid,uuid,uuid,integer,text']]) {
        const {source}=await one('select pg_get_functiondef($1::regprocedure) source',[`public.${name}(${args})`])
        await db.exec(source.replace(`public.${name}(`,`public.pricing_baseline_${name}(`))
        await db.exec(source.replace(`public.${name}(`,`public.pricing_control_${name}(`))
    }
    // Reproduce Supabase's production table defaults, including server-role writes.
    await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role')
    await db.exec(await readFile(`${repositoryRoot}/supabase/migrations/20261012120000_service_pricing_review_and_corrections.sql`,'utf8'))
    for (const role of ['anon','authenticated','service_role']) assert.equal((await one("select has_table_privilege($1,'client_sale_price_corrections','UPDATE') allowed",[role])).allowed,false)
    assert.equal((await one("select has_table_privilege('service_role','client_sale_price_corrections','SELECT') allowed")).allowed,true)
    pass('pricing migration installs against actual sale, adjustment and card owners')
    const instance=await add(service,revision,uuid(1800))
    const input={uiVersion:2,relationshipVersion:(await one('select updated_at::text value from relationships where id=$1',[relationship])).value,managerId:owner,billingInterval:'month',billingIntervalCount:1,offered:[{id:instance,version:1}],delivery:[{provider:'meta_whatsapp',address:'+353850000001'}],lines:[{id:instance,version:1,assigneeId:staff,upfrontCents:75000,recurringCents:75000}]}
    const quote=(await one('select preview_relationship_service_sale($1,$2,$3,$4) result',[w,relationship,seller,input])).result
    const sale=(await one("select commit_relationship_service_sale($1,$2,$3,$4,$5,$6,'+353850000001',null) result",[w,relationship,seller,uuid(1801),input,quote.hash])).result
    const lines=await q('select * from client_sale_items where client_sale_id=$1',[sale.saleId])
    const token=(await one('select session_token from relationship_onboarding_sessions where id=$1',[sale.sessionId])).session_token
    const terms={lines:lines.map(line=>({id:line.id,upfrontCents:0,recurringCents:150000})),upfrontTotal:0,recurringTotal:150000,billingInterval:'month',billingIntervalCount:1}
    const begin=async(request,actor=owner,body=terms,version=0)=>(await one("select begin_client_sale_price_correction($1,$2,$3,$4,$5,$6,$7,'Correct duplicated first payment') result",[w,relationship,sale.saleId,actor,request,version,body])).result
    const finish=async(request,accept=true)=>(await one('select finish_client_sale_price_correction($1,$2,$3,$4) result',[w,owner,request,accept])).result
    const claim=async(version=0)=>(await one('select claim_selected_service_checkout($1,$2,$3,null,$4) result',[w,sale.saleId,token,{saleId:sale.saleId,workspaceId:w,lineItems:[{amount:150000}],idempotencyKey:'fixture-checkout',pricingRevision:version}])).result
    await assert.rejects(begin(uuid(1802),staff),/Owner or admin/)
    await assert.rejects(begin(uuid(1802),owner,{...terms,upfrontTotal:1}),/reviewed total/)
    await assert.rejects(begin(uuid(1802),owner,{...terms,lines:[...terms.lines,...terms.lines]}),/exactly once/)
    await assert.rejects(begin(uuid(1802),owner,{...terms,lines:[{...terms.lines[0],upfrontCents:-1}]}),/valid price/)
    pass('correction rejects staff, mismatched totals, duplicate lines and negative prices')
    await claim()
    await assert.rejects(begin(uuid(1802)),/previous checkout result/)
    await q("update client_sales set stripe_checkout_session_id='cs_open',stripe_checkout_status='open' where id=$1",[sale.saleId])
    const reserved=await begin(uuid(1802));assert.equal(reserved.previous_checkout_id,'cs_open')
    assert.equal((await begin(uuid(1802))).request_id,reserved.request_id)
    await assert.rejects(begin(uuid(1802),owner,{...terms,recurringTotal:100}),/does not match/)
    await assert.rejects(begin(uuid(1803)),/Resume/)
    await assert.rejects(claim(),/being corrected/)
    pass('in-flight checkout must reconcile; correction reserves one exact request and fences checkout')
    assert.equal((await finish(uuid(1802))).state,'committed')
    assert.equal((await finish(uuid(1802))).state,'committed')
    const effective=await one('select pricing_revision,pricing_override,stripe_checkout_session_id,service_checkout_request,upfront_total_amount,recurring_total_amount from client_sales where id=$1',[sale.saleId])
    assert.equal(effective.pricing_revision,1);assert.equal(effective.upfront_total_amount,75000);assert.equal(effective.recurring_total_amount,75000)
    assert.equal(effective.pricing_override.upfrontTotal,0);assert.equal(effective.pricing_override.recurringTotal,150000)
    assert.equal(effective.stripe_checkout_session_id,null);assert.equal(effective.service_checkout_request,null)
    assert.deepEqual(await q('select * from client_sale_items where client_sale_id=$1',[sale.saleId]),lines)
    assert.equal((await one('select session_token from relationship_onboarding_sessions where id=$1',[sale.sessionId])).session_token,token)
    assert.equal((await one('select count(*) n from client_sale_commercial_adjustments where sale_id=$1',[sale.saleId])).n,1)
    await assert.rejects(claim(0),/Prices changed/);await claim(1)
    pass('committed correction preserves frozen prices and onboarding, appends one audit and rejects stale checkout generations')
    const pos=(await one('select read_relationship_service_pos($1,$2,$3) result',[w,relationship,owner])).result
    const displayed=pos.sales.find(row=>row.id===sale.saleId)
    assert.equal(displayed.upfront_total_amount,0);assert.equal(displayed.recurring_total_amount,150000);assert.equal(displayed.billing_interval,'month');assert.equal(displayed.can_correct_prices,true)
    const cards=(await one('select read_relationship_service_cards($1,$2,$3,0,$4) result',[w,relationship,owner,instance])).result
    assert.equal(cards.items[0].sold_upfront_cents,0);assert.equal(cards.items[0].sold_recurring_cents,150000)
    const catalogue=(await one('select relationship_service_catalogue($1,$2) result',[w,owner])).result
    assert(catalogue.every(row=>['week','month','year'].includes(row.billing_interval)))
    pass('POS, service detail and catalogue read the effective prices and explicit cadence')
    await q("update client_sales set stripe_checkout_session_id='cs_next',stripe_checkout_status='open' where id=$1",[sale.saleId])
    await begin(uuid(1804),owner,terms,1)
    await q("update client_sales set status='paid',initial_payment_received_at=now() where id=$1",[sale.saleId])
    await assert.rejects(finish(uuid(1804)),/Payment state changed/)
    assert.equal((await finish(uuid(1804),false)).state,'rejected')
    assert.equal((await one('select pricing_revision from client_sales where id=$1',[sale.saleId])).pricing_revision,1)
    for(const role of ['anon','authenticated']) assert.equal((await one("select has_function_privilege($1,'begin_client_sale_price_correction(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text)','EXECUTE') allowed",[role])).allowed,false)
    pass('payment race rejects correction without rewriting terms; commands remain server-only')
    if (measure) {
        // Grow attached-service candidates beyond the existing 31-row page.
        for(let n=0;n<100;n++) await add(service,revision,uuid(3000+n))
        const dataset=await one('select (select count(*) from relationship_service_instances where relationship_id=$1) services,(select count(*) from client_sales where relationship_id=$1) sales',[relationship])
        for(const kind of ['pos','cards']) {
            const name=`read_relationship_service_${kind}`
            const args=kind==='pos'?[w,relationship,owner]:[w,relationship,owner,0,null]
            const call=arm=>`select ${arm==='candidate'?'':`pricing_${arm}_`}${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`
            const timing={baseline:[],control:[],candidate:[]},payload={}
            for(let i=0;i<57;i++) for(const arm of i%2?['candidate','control','baseline']:['baseline','control','candidate']) {
                const start=performance.now(),result=(await one(call(arm),args)).result,elapsed=performance.now()-start
                if(i>=16)timing[arm].push(elapsed)
                payload[arm]=Buffer.byteLength(JSON.stringify(result))
            }
            const stats=Object.fromEntries(Object.entries(timing).map(([arm,values])=>{values.sort((a,b)=>a-b);return[arm,{medianMs:values[20],p95Ms:values[38],bytes:payload[arm]}]}))
            console.log('PRICING_SPEED '+JSON.stringify({kind,dataset,warmups:16,samples:41,...stats}))
        }
    }

}
