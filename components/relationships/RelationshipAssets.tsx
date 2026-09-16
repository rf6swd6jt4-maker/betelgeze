"use client"
import {useCallback,useEffect,useRef,useState} from 'react'
import {CenteredDialog,AutoGrowTextarea} from '@/components/ui'
import {List,ListItem,ListPrimaryRow,ListTitle,ListSecondaryRow,ListTrailing} from '@/components/list/List'
import {useRelationshipBackground} from './RelationshipBackgroundEditor'
import {useWorkspaceTabActive} from '@/components/workspace/useWorkspaceTabActive'
import {registerWorkspaceAutosaveFlusher} from '@/lib/workspace-mutations'
type Asset={asset_id:string;title:string;description:string;file_size:number;content_type:string;created_at:string}
const button='min-h-10 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 disabled:opacity-40'
const field='mt-2 w-full rounded-lg border border-neutral-700 bg-black p-3 text-base text-white sm:text-sm'
export function RelationshipAssets({slug,relationshipId,userId}:{slug:string;relationshipId:string;userId:string}){
 const {canEdit,flush}=useRelationshipBackground(),active=useWorkspaceTabActive()
 const [items,setItems]=useState<Asset[]>([]),[loaded,setLoaded]=useState(false),[visible,setVisible]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[editing,setEditing]=useState<Asset|null>(null),[description,setDescription]=useState(''),[file,setFile]=useState<File|null>(null),[receipt,setReceipt]=useState(''),[message,setMessage]=useState('')
 const section=useRef<HTMLElement>(null),busyRef=useRef(false),dirtyRef=useRef(false)
 const endpoint=`/api/workspaces/${encodeURIComponent(slug)}/relationships/${relationshipId}/assets`,storageKey=`relationship-assets:${userId}:${slug}:${relationshipId}`
 const read=useCallback(async(signal?:AbortSignal)=>{const r=await fetch(endpoint,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),cache:'no-store'}),body=await r.json();if(!r.ok)throw new Error(body.error||'Could not load assets.');setItems(body.items);setLoaded(true)},[endpoint])
 useEffect(()=>{const node=section.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'200px'});observer.observe(node);return()=>observer.disconnect()},[])
 // The reader only sets state after the network response, never synchronously.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(!active||!visible||loaded)return;const abort=new AbortController();void read(abort.signal).catch(e=>{if(!abort.signal.aborted)setError(e.message)});return()=>abort.abort()},[active,visible,loaded,read])
 useEffect(()=>{const unregister=registerWorkspaceAutosaveFlusher(async()=>{if(busyRef.current||dirtyRef.current)throw new Error('Finish or close the asset editor before leaving.')});return()=>{unregister()}},[])
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(busyRef.current||dirtyRef.current){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler)},[])
 async function command(url:string,value:object,method='POST'){const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value),signal:AbortSignal.timeout(170000)}),body=await r.json();if(!r.ok)throw new Error(body.error||'Asset could not be saved.');return body}
 function close(){setOpen(false);setEditing(null);setFile(null);setDescription('');setReceipt('');dirtyRef.current=false;setMessage('')}
 function add(){setError('');setEditing(null);setDescription('');setFile(null);setReceipt('');try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.receipt){setReceipt(saved.receipt);setMessage(`Ready to retry saving ${saved.name}`)}}catch{setError('Could not restore the upload receipt on this device.')}setOpen(true)}
 async function save(remove=false){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{
  await flush()
  if(editing)await command(`${endpoint}/${editing.asset_id}`,{description,expectedDescription:editing.description,remove},'PATCH')
  else {
   let pending=receipt
   if(!pending){if(!file)throw new Error('Choose a document.');setMessage('Uploading document…');const p=await command(endpoint,{action:'prepare',file:{name:file.name,size:file.size,type:file.type},description});const upload=await fetch(p.uploadUrl,{method:'PUT',headers:{'Content-Type':p.file.type},body:file,signal:AbortSignal.timeout(120000)});if(!upload.ok)throw new Error('Upload failed; try again.');pending=p.receipt;setReceipt(pending);sessionStorage.setItem(storageKey,JSON.stringify({receipt:pending,name:file.name}))}
   setMessage('Reading document and attaching it…');await command(endpoint,{action:'finish',receipt:pending});sessionStorage.removeItem(storageKey)
  }
  close();await read()
 }catch(e){setError(e instanceof Error?e.message:'Asset could not be saved.')}finally{busyRef.current=false;setBusy(false)}}
 return <section ref={section} className="mt-6" aria-label="Relationship assets"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Assets</h2><div className="flex gap-2">{loaded?<button className={button} onClick={()=>void read().then(()=>setError('')).catch(e=>setError(e.message))}>Refresh</button>:null}{canEdit?<button className={button} onClick={add}>Attach file</button>:null}</div></div><p className="mb-3 text-xs leading-5 text-neutral-500">AI reads these documents when generating new work. Asset descriptions correct their documents; the relationship description overrides both. Existing work stays unchanged.</p>
 {error&&!open?<p role="alert" className="mb-3 text-sm text-red-300">{error} <button className="underline" onClick={()=>void read().then(()=>setError('')).catch(e=>setError(e.message))}>Retry</button></p>:null}
 {!loaded?<p className="py-4 text-sm text-neutral-500">{visible?'Loading assets…':'Assets load when this section is visible.'}</p>:items.length?<List embedded ariaLabel="Attached relationship assets">{items.map(a=><ListItem key={a.asset_id}><ListPrimaryRow><ListTitle external href={`${endpoint}/${a.asset_id}`}>{a.title}</ListTitle></ListPrimaryRow><ListSecondaryRow><span title={a.description} className="min-w-0 flex-1 truncate text-neutral-500">{a.description||'Document ready for AI context'} · {Math.ceil(a.file_size/1024)} KB</span><ListTrailing>{canEdit?<button className={button} onClick={()=>{setEditing(a);setDescription(a.description);setError('');setOpen(true)}}>Edit description</button>:null}<a className={button+' inline-flex items-center'} href={`${endpoint}/${a.asset_id}`}>Download</a></ListTrailing></ListSecondaryRow></ListItem>)}</List>:<p className="py-4 text-sm text-neutral-500">No attached documents yet.</p>}
 {open?<CenteredDialog title={editing?'Asset description':'Attach relationship document'} busy={busy} onClose={close} footer={<div className="flex flex-wrap justify-end gap-2">{editing?<button className={button} disabled={busy} onClick={()=>void save(true)}>Remove from context</button>:null}<button className={button} disabled={busy} onClick={close}>Cancel</button><button className={button} disabled={busy} onClick={()=>void save()}>{busy?'Saving…':editing?'Save description':receipt?'Retry attachment':'Attach file'}</button></div>}>
 {!editing&&!receipt?<label className="block text-sm text-neutral-300">Document<input className={field} type="file" accept=".pdf,.docx,.txt,.md,.csv" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]??null);dirtyRef.current=true}}/><span className="mt-2 block text-xs text-neutral-500">PDF, DOCX, TXT, Markdown or CSV, up to 20 MB. Text-searchable documents only; scanned pages need a transcript. Up to 20 documents and 100,000 characters total.</span></label>:null}
 <label className="mt-4 block text-sm text-neutral-300">Description / updates<AutoGrowTextarea className={field} rows={4} maxLength={5000} disabled={busy||!!receipt} value={description} onChange={e=>{setDescription(e.target.value);dirtyRef.current=true}} placeholder="What has changed since this document was written?"/></label>
 {message?<p role="status" className="mt-3 text-sm text-neutral-400">{message}</p>:null}{error?<p role="alert" className="mt-3 text-sm text-red-300">{error}</p>:null}
 </CenteredDialog>:null}</section>
}
