"use client"
import { useEffect, useRef, useState } from "react"
import { CenteredDialog, Selector } from "@/components/ui"
import { ServicePriceSummary } from "@/components/services/ServicePriceSummary"
import { MoneyField } from "./ServicePriceInput"
import { correctUnpaidServiceSale } from "@/app/[workspaceSlug]/relationships/price-correction-actions"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { validPriceCorrection, type CorrectedSaleTerms, type PriceCorrectionPage, type PriceCorrectionRequest } from "@/lib/client-sales/price-correction-types"

export function ServicePriceCorrection({ workspaceSlug, relationshipId, userId, saleId, onClose, onSaved }: {workspaceSlug:string;relationshipId:string;userId:string;saleId:string;onClose:()=>void;onSaved:()=>void}) {
    const [page,setPage]=useState<PriceCorrectionPage|null>(null),[terms,setTerms]=useState<CorrectedSaleTerms|null>(null)
    const [reason,setReason]=useState(""),[error,setError]=useState(""),[pending,setPending]=useState(false),[accepted,setAccepted]=useState(false),[retry,setRetry]=useState(0)
    const [recovery,setRecovery]=useState<PriceCorrectionRequest|null>(null)
    const gate=useRef(false)
    const key=`be:price-correction:${userId}:${workspaceSlug}:${relationshipId}:${saleId}`
    useEffect(()=>{
        const controller=new AbortController()
        let saved: PriceCorrectionRequest | null = null
        async function load() {
            const value = JSON.parse(sessionStorage.getItem(key) ?? "null")
            if (value && (!validPriceCorrection(value) || value.saleId !== saleId)) throw Error("The saved correction could not be recovered. Ask an administrator to review the sale.")
            saved = value
            const response = await fetch(`/api/workspaces/${workspaceSlug}/relationships/${relationshipId}/pos/prices?sale=${saleId}${saved ? `&recovery=${saved.requestId}` : ""}`,{headers:{"x-workspace-user":userId},cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])})
            const data = await response.json() as PriceCorrectionPage & { error?: string }
            if (!response.ok) throw Error(data.error ?? "Could not load the saved prices.")
            if (controller.signal.aborted) return
            const durable=data.pending ? {requestId:data.pending.request_id,saleId,expectedVersion:data.pending.expected_version,terms:data.pending.terms,reason:data.pending.reason} : saved
            setPage(data);setRecovery(durable);setTerms(durable?.terms??data.terms);setReason(durable?.reason??"");setError("")
        }
        void load().catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error ? cause.message : "Could not load the saved prices.")})
        return()=>controller.abort()
    },[workspaceSlug,relationshipId,userId,saleId,key,retry])
    function change(next:CorrectedSaleTerms){setTerms({...next,upfrontTotal:next.lines.reduce((sum,l)=>sum+l.upfrontCents,0),recurringTotal:next.lines.reduce((sum,l)=>sum+l.recurringCents,0)});setAccepted(false)}
    async function save(){
        if(gate.current||!terms||!page||(!recovery&&!accepted))return
        const request=recovery??{requestId:crypto.randomUUID(),saleId,expectedVersion:page.version,terms,reason:reason.trim()}
        if(!validPriceCorrection(request)){setError("Set a valid price for every service and a reason of at least 10 characters.");return}
        try{sessionStorage.setItem(key,JSON.stringify(request))}catch{setError("This browser could not save the recovery request. Enable site storage before correcting prices.");return}
        gate.current=true;setRecovery(request);setPending(true);setError("")
        try{
            const result=await runWorkspaceMutation(()=>correctUnpaidServiceSale(workspaceSlug,relationshipId,userId,request))
            if(result.ok){sessionStorage.removeItem(key);onSaved();return}
            setError(result.error??"Could not confirm the correction.")
            if(!result.uncertain){sessionStorage.removeItem(key);setRecovery(null);setAccepted(false);setPage(null);setTerms(null)}
        }catch{setError("The result is unknown. Retry this same correction to recover its saved outcome.")}
        finally{gate.current=false;setPending(false)}
    }
    const locked=pending||Boolean(recovery)
    return <CenteredDialog title="Correct unpaid prices" short onClose={pending?()=>{}:onClose} footer={<div className="flex justify-end gap-3"><button className="min-h-11 px-3 text-sm" disabled={pending} onClick={onClose}>Close</button><button className="min-h-11 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40" disabled={pending||!page||!terms||(!recovery&&(!accepted||reason.trim().length<10))} onClick={()=>void save()}>{pending?"Confirming correction…":recovery?"Retry same correction":"Save corrected prices"}</button></div>}>
        <p className="text-sm leading-6 text-neutral-400">The client’s existing onboarding link stays the same. Any open Stripe checkout will be expired before these prices take effect. Completed or processing payments cannot be corrected here.</p>
        {recovery?<p role="status" className="mt-3 text-sm text-amber-200">A correction needs confirmation. Retry it to recover the result before making further changes.</p>:null}
        {!page||!terms ? <p role="status" className="py-5 text-sm">{error?"Prices are unavailable.":"Loading saved prices…"}</p> : <>
            <div className="mt-4 space-y-4">{page.lines.map(line=>{const price=terms.lines.find(item=>item.id===line.id)!;return <fieldset key={line.id} className="min-w-0 border-b border-neutral-800 pb-4"><legend className="mb-2 font-semibold">{line.name}</legend><div className="grid grid-cols-2 gap-3"><MoneyField label={`${line.recurringAllowed?"Additional one-time fee":"One-time fee"} for ${line.name}`} value={price.upfrontCents} disabled={locked} onChange={upfrontCents=>change({...terms,lines:terms.lines.map(item=>item.id===line.id?{...item,upfrontCents}:item)})}/>{line.recurringAllowed?<MoneyField label={`Recurring payment for ${line.name}`} value={price.recurringCents} disabled={locked} onChange={recurringCents=>change({...terms,lines:terms.lines.map(item=>item.id===line.id?{...item,recurringCents}:item)})}/>:null}</div></fieldset>})}</div>
            {terms.recurringTotal>0?<div className="mt-4 grid grid-cols-2 gap-3"><label className="text-sm">Repeat every<input aria-label="Billing interval count" type="number" min="1" max={terms.billingInterval==="week"?156:terms.billingInterval==="month"?36:3} disabled={locked} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-700 bg-black px-3" value={terms.billingIntervalCount} onChange={event=>change({...terms,billingIntervalCount:Number(event.target.value)})}/></label><div><p className="mb-1 text-sm">Period</p><Selector ariaLabel="Billing period" value={terms.billingInterval} disabled={locked} onChange={value=>change({...terms,billingInterval:value as CorrectedSaleTerms["billingInterval"],billingIntervalCount:1})} options={[{value:"week",label:"Week"},{value:"month",label:"Month"},{value:"year",label:"Year"}]}/></div></div>:null}
            <ServicePriceSummary pricing={{upfrontCents:terms.upfrontTotal,recurringCents:terms.recurringTotal,currency:page.currency,billingInterval:terms.billingInterval,billingIntervalCount:terms.billingIntervalCount}}/>
            <label className="mt-4 block text-sm">Reason for correction<textarea className="mt-1 w-full rounded-lg border border-neutral-700 bg-black p-3" maxLength={1000} minLength={10} disabled={locked} value={reason} onChange={event=>{setReason(event.target.value);setAccepted(false)}}/></label>
            {!recovery?<label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={accepted} disabled={locked} onChange={event=>setAccepted(event.target.checked)}/><span>I reviewed the corrected amount due at checkout and subsequent payments with the client.</span></label>:null}
        </>}
        {error?<p role="alert" className="mt-4 text-sm text-red-300">{error}{!page?<button className="ml-2 min-h-11 underline" onClick={()=>setRetry(v=>v+1)}>Retry loading</button>:null}</p>:null}
    </CenteredDialog>
}
