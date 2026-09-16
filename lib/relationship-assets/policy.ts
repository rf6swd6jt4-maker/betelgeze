import { createHmac, timingSafeEqual } from 'node:crypto'
export const DOCUMENT_ACCEPT = '.pdf,.docx,.txt,.md,.csv'
const types: Record<string,string> = {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',md:'text/markdown',csv:'text/csv'}
export type DocumentFile = {name:string;type:string;size:number}
export type DocumentTicket = {id:string;workspaceId:string;relationshipId:string;userId:string;file:DocumentFile;description:string;expires:number}
export function documentFile(value: unknown): DocumentFile {
 const f=value as DocumentFile
 if(!f || typeof f.name!=='string' || !f.name.trim() || f.name.length>240 || /[\x00-\x1f/\\]/.test(f.name))throw new Error('Choose a file with a valid name.')
 const type=types[f.name.split('.').at(-1)?.toLowerCase()??'']
 if(!type)throw new Error('Choose PDF, DOCX, TXT, Markdown or CSV.')
 if(!Number.isSafeInteger(f.size)||f.size<=0||f.size>20*1024*1024)throw new Error('Choose a non-empty document up to 20 MB.')
 return {name:f.name.trim(),type,size:f.size}
}
export function documentDescription(value:unknown){if(typeof value!=='string'||value.length>5000)throw new Error('Keep the asset description under 5,000 characters.');return value.trim()}
const mac=(body:string,secret:string)=>createHmac('sha256',secret).update('relationship-document-v1:'+body).digest()
export function signDocumentTicket(ticket:DocumentTicket,secret:string){const body=Buffer.from(JSON.stringify(ticket)).toString('base64url');return body+'.'+mac(body,secret).toString('base64url')}
export function readDocumentTicket(value:unknown,secret:string,workspaceId:string,relationshipId:string,userId:string){
 if(typeof value!=='string'||value.length>16000)throw new Error('Invalid upload receipt.')
 const [body,sig,extra]=value.split('.'), actual=Buffer.from(sig??'','base64url'),expected=mac(body,secret)
 if(extra||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('Invalid upload receipt.')
 const t=JSON.parse(Buffer.from(body,'base64url').toString()) as DocumentTicket
 if(t.workspaceId!==workspaceId||t.relationshipId!==relationshipId||t.userId!==userId||!Number.isFinite(t.expires)||t.expires<=Date.now()||!/^[-0-9a-f]{36}$/i.test(t.id))throw new Error('This upload expired or belongs to another relationship or account.')
 return {...t,file:documentFile(t.file),description:documentDescription(t.description)}
}
