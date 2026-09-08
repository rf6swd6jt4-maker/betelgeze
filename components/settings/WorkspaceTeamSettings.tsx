"use client"
import { useState, useTransition } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Assignee, Status } from "@/components/ui"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle } from "@/components/list/List"
import { saveWorkspaceOperations, saveMaintenanceAssignments } from "@/app/[workspaceSlug]/settings/team-actions"
import { ServiceStaffPermissionsEditor } from "@/components/settings/ServiceCatalogue"
import type { WorkspaceOperations } from "@/lib/teams/operations"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"

const options: Array<{ capability: WorkspaceCapability; label: string }> = [
    { capability: "relationships.view", label: "Relationships" }, { capability: "onboarding.manage", label: "Onboarding" }, { capability: "fulfilment.manage", label: "Fulfilment" },
]
export function WorkspaceTeamSettings({ workspaceSlug, operations, isOwner }: { workspaceSlug: string; operations: WorkspaceOperations; isOwner: boolean }) {
    const router = useRouter()
    const [maintenance, setMaintenance] = useState(Object.fromEntries(operations.maintenance.map((r) => [r.key,r.userId])))
    const [people, setPeople] = useState(operations.people)
    const [permissions, setPermissions] = useState(operations.permissions)
    const [search, setSearch] = useState("")
    const [serviceId, setServiceId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)
    const [pending, startTransition] = useTransition()
    const dirty = JSON.stringify(people) !== JSON.stringify(operations.people) || JSON.stringify(permissions) !== JSON.stringify(operations.permissions)
    const service = operations.services.find((s) => s.id === serviceId)
    const portalTarget = typeof window !== "undefined" ? window.parent.document.body : null
    function save() {
        setError(null); setSaved(false)
        startTransition(async () => {
            const result = await saveWorkspaceOperations(workspaceSlug, people.map((p) => ({ userId: p.id, canSell: p.canSell, canManage: p.canManage })), permissions)
            if (!result.ok) { setError(result.error); return }
            setSaved(true); router.refresh()
        })
    }
    return <div>
        <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-neutral-500">Choose who can sell and manage clients. Assemble each client’s team during POS.</p>
            <button type="button" disabled={pending || !dirty} onClick={save} className="h-9 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40">{pending ? "Saving…" : "Save roles"}</button>
        </div>
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : saved ? <div className="mt-3" role="status"><Status label="Saved" tone="green" /></div> : null}
        {people.length > 6 ? <input aria-label="Find workspace member" placeholder="Find a person…" value={search} onChange={(e) => setSearch(e.target.value)} className="mt-4 h-9 w-full max-w-sm rounded-lg border border-neutral-700 bg-black px-3 text-sm" /> : null}
        <List ariaLabel="Operational roles" className="!mt-3">
            {people.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).map((person) => <ListItem key={person.id}>
                <ListPrimaryRow className="!flex-wrap !whitespace-normal !border-0 !py-2">
                    <div className="min-w-0 flex-1"><Assignee userId={person.id} name={person.name} avatarSrc={person.avatarSrc} /><p className="mt-1 truncate text-xs text-neutral-500">{operations.eligible.filter((e) => e.user_id === person.id).map((e) => operations.services.find((s) => s.id === e.service_id)?.name).filter(Boolean).join(" · ") || "No service eligibility selected"}</p></div>
                    {([['canSell', 'Seller'], ['canManage', 'Manager']] as const).map(([key,label]) => <label key={key} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-neutral-300"><input aria-label={`${label}: ${person.name}`} type="checkbox" disabled={pending} checked={person[key]} onChange={(e) => { setSaved(false); setPeople((all) => all.map((p) => p.id === person.id ? { ...p, [key]: e.target.checked } : p)) }} className="h-4 w-4 accent-white" />{label}</label>)}
                </ListPrimaryRow>
            </ListItem>)}
        </List>
        <details className="mt-4 border-t border-neutral-800 pt-3">
            <summary className="cursor-pointer text-sm text-neutral-300">Position permissions</summary>
            <p className="mt-2 text-xs leading-5 text-neutral-500">Applies to assigned clients. Team chat is available to every member; client chat requires participation.</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">{(['seller','manager'] as const).map((position) => <fieldset key={position}>
                <legend className="mb-2 text-sm font-medium capitalize">{position}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">{options.map((option) => <label key={option.capability} className="flex items-center gap-2 text-sm text-neutral-400"><input type="checkbox" disabled={pending} checked={(permissions[position] ?? []).includes(option.capability)} onChange={(e) => { setSaved(false); setPermissions((all) => ({ ...all, [position]: e.target.checked ? [...(all[position] ?? []), option.capability] : (all[position] ?? []).filter((c) => c !== option.capability) })) }} className="h-4 w-4 accent-white" />{option.label}</label>)}</div>
            </fieldset>)}</div>
        </details>
        <details className="mt-4 border-t border-neutral-800 pt-3">
            <summary className="cursor-pointer text-sm text-neutral-300">Service fulfilment permissions</summary>
            <List ariaLabel="Service permissions" className="!mt-3">{operations.services.map((item) => <ListItem key={item.id}>
                <ListPrimaryRow><ListTitle className="flex-1">{item.name}</ListTitle><button type="button" onClick={() => setServiceId(item.id)} className="h-8 px-2 text-xs text-neutral-400 hover:text-white">Edit permissions</button></ListPrimaryRow>
                <ListSecondaryRow><span className="truncate text-xs text-neutral-500">{(operations.servicePermissions[item.id] ?? []).filter((c) => c !== 'communications.manage').map((c) => c.split('.')[0].replaceAll('_',' ')).join(' · ') || 'No delivery panels enabled'}</span></ListSecondaryRow>
            </ListItem>)}</List>
        </details>
        <details className="mt-4 border-t border-neutral-800 pt-3">
            <summary className="cursor-pointer text-sm text-neutral-300">Maintenance responsibility</summary>
            <p className="mt-2 text-xs leading-5 text-neutral-500">Route platform issues to the right person. Membership of the Maintenance group follows these assignments.</p>
            <List ariaLabel="Maintenance responsibility" className="!mt-3">{operations.maintenance.map((route) => <ListItem key={route.key}><ListPrimaryRow className="!flex-wrap !whitespace-normal"><ListTitle className="flex-1">{route.label}</ListTitle><select aria-label={`${route.label} responsible person`} disabled={!isOwner || pending} value={maintenance[route.key]} onChange={(e) => setMaintenance((all) => ({ ...all, [route.key]: e.target.value }))} className="h-8 max-w-48 rounded-md border border-neutral-800 bg-neutral-950 px-2 text-xs text-neutral-300"><option value="">Choose person</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></ListPrimaryRow></ListItem>)}</List>
            {isOwner ? <div className="mt-3 flex justify-end"><button type="button" disabled={pending || operations.maintenance.every((r) => maintenance[r.key] === r.userId)} onClick={() => { setError(null); setSaved(false); startTransition(async () => { const result = await saveMaintenanceAssignments(workspaceSlug,maintenance); if (!result.ok) setError(result.error); else { setSaved(true); router.refresh() } }) }} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-40">Save maintenance</button></div> : null}
        </details>
        {service && portalTarget ? createPortal(<ServiceStaffPermissionsEditor workspaceSlug={workspaceSlug} service={service} initialPermissions={operations.servicePermissions[service.id] ?? []} onClose={() => setServiceId(null)} />,portalTarget) : null}
    </div>
}
