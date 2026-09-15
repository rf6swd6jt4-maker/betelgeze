'use client'
/* eslint-disable @next/next/no-img-element -- Authenticated source images bypass public optimizers. */
import { useState } from 'react'
import { AssetGallery,AssetGalleryCard,CenteredDialog,Status } from '@/components/ui'
import { sopCommand } from './client'
type Image={asset_id:string;attachable:boolean;location:string;method:string}
type Result={extraction:{status:string;image_count:number;error_summary:string|null;warnings:string[]}|null;images:Image[]}
export function SopExtractedImages({workspaceSlug,sopId,assetId}:{workspaceSlug:string;sopId:string;assetId:string}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Image|null>(null)
 const api=`/api/workspaces/${workspaceSlug}/sops/${sopId}/images`,url=(id:string)=>`/api/workspaces/${workspaceSlug}/sop-images/${id}`
 async function read(){setBusy(true);setError('');try{setData(await sopCommand(`${api}?assetId=${assetId}`,undefined,'GET'))}catch(e){setError(e instanceof Error?e.message:'Could not load images')}finally{setBusy(false)}}
 async function queue(){setBusy(true);setError('');try{await sopCommand(api,{assetId,retry:data?.extraction?.status==='failed'});setData({extraction:{status:'queued',image_count:0,warnings:[],error_summary:null},images:[]})}catch(e){setError(e instanceof Error?e.message:'Could not queue images')}finally{setBusy(false)}}
 return <><button type="button" className="min-h-10" onClick={()=>{setOpen(true);void read()}}>Extracted images</button>{open?<CenteredDialog title="SOP images" wide busy={busy} onClose={()=>setOpen(false)}>
 <p className="mb-3 text-sm text-neutral-400">Source images are saved once and can support relevant work instructions. Open the original document when context is unclear.</p>
 {error?<p role="alert" className="my-3 text-sm text-red-300">{error}</p>:null}
 {data?.extraction?<Status label={data.extraction.status==='ready'?`${data.images.length} visual references extracted`:data.extraction.status==='failed'?'Extraction needs attention':'Extraction queued or running'} tone={data.extraction.status==='ready'?'green':data.extraction.status==='failed'?'red':'yellow'}/>:null}
 {data?.extraction?.error_summary?<p className="my-3 text-sm text-amber-200">{data.extraction.error_summary}</p>:null}
 <div className="my-3 flex gap-4 text-sm">{!data?.extraction||data.extraction.status==='failed'?<button type="button" disabled={busy} className="min-h-11 disabled:opacity-40" onClick={()=>void queue()}>{data?.extraction?'Retry extraction':'Extract images'}</button>:null}<button type="button" disabled={busy} className="min-h-11 disabled:opacity-40" onClick={()=>void read()}>Refresh status</button></div>
 {selected?<div className="mb-4"><a href={url(selected.asset_id)} target="_blank" rel="noreferrer"><img src={url(selected.asset_id)} alt={selected.location} className="max-h-[65dvh] w-full object-contain"/></a><p className="mt-2 text-xs text-neutral-400">{selected.location} · {selected.method==='pdf_page'?'Rendered PDF page':'Embedded DOCX image'}</p></div>:null}
 {data?.images.length?<AssetGallery label="Extracted SOP images">{data.images.map(i=><AssetGalleryCard key={i.asset_id} title={i.location} subtitle={!i.attachable?'Preview only':i.method==='pdf_page'?'Page with visual content':'Embedded image'} previewUrl={url(i.asset_id)+'?thumbnail=1'} onClick={()=>setSelected(i)}/>)}</AssetGallery>:null}
 {data?.extraction?.warnings.length?<ul className="mt-4 list-disc space-y-2 pl-5 text-xs text-amber-200">{data.extraction.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>:null}
 </CenteredDialog>:null}</>
}
