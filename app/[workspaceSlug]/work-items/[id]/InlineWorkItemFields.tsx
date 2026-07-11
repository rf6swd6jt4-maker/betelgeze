"use client"

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Assignee, RoundPill, Status } from "@/components/ui"
import { Avatar } from "@/components/account/Avatar"
import {
    updateWorkItemAssignees,
    updateWorkItemDependencies,
    updateWorkItemParent,
    updateWorkItemPriority,
    updateWorkItemRelationships,
    updateWorkItemSchedule,
} from "./actions"

type Person = { user_id: string; username: string; avatar_url: string | null }
type WorkOption = { id: string; title: string; status: string }
type RelationshipOption = { id: string; label: string }

type Props = {
    workspaceSlug: string
    workItemId: string
    status: string
    statusLabel: string
    statusTone: "grey" | "yellow" | "green" | "red"
    plannedStartDate: string | null
    dueDate: string | null
    actualStartAt: string | null
    actualCompletedAt: string | null
    assignees: Person[]
    creator: Person | null
    members: Person[]
    parent: WorkOption | null
    parentId: string | null
    waitsForParent: boolean
    dependencies: WorkOption[]
    manualDependencyIds: string[]
    workOptions: WorkOption[]
    relationships: RelationshipOption[]
    relationshipOptions: RelationshipOption[]
    relationshipsLocked: boolean
    priority: number
}

function displayDate(value: string | null) {
    if (!value) return "Not set"
    return new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value))
}

function dateInputValue(value: string | null) {
    return value ? value.slice(0, 10) : ""
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <div className="grid min-h-10 grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]"><p className="pt-0.5 text-sm text-neutral-500">{label}</p><div className="min-w-0 text-sm text-neutral-200">{children}</div></div>
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
    return <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 w-full border-b border-neutral-800 bg-transparent px-3 text-sm text-white outline-none placeholder:text-neutral-600" />
}

function Popup({ children, className = "w-72" }: { children: ReactNode; className?: string }) {
    return <div className={`absolute left-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/60 ${className}`}>{children}</div>
}

function PopupFooter({ onSave, onCancel, pending }: { onSave: () => void; onCancel: () => void; pending: boolean }) {
    return <div className="flex justify-end gap-2 border-t border-neutral-800 p-2"><button type="button" onClick={onCancel} className="h-8 px-2 text-xs text-neutral-500 hover:text-white">Cancel</button><button type="button" disabled={pending} onClick={onSave} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save"}</button></div>
}

export function InlineWorkItemFields(props: Props) {
    const router = useRouter()
    const rootRef = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const completed = props.status === "done"
    const [startDate, setStartDate] = useState(dateInputValue(completed ? props.actualStartAt : props.plannedStartDate))
    const [dueDate, setDueDate] = useState(dateInputValue(completed ? props.actualCompletedAt : props.dueDate))
    const [assigneeIds, setAssigneeIds] = useState(props.assignees.map((person) => person.user_id))
    const [parentId, setParentId] = useState(props.parentId ?? "")
    const [waitForParent, setWaitForParent] = useState(props.waitsForParent || !props.parentId)
    const [dependencyIds, setDependencyIds] = useState(props.manualDependencyIds)
    const [relationshipIds, setRelationshipIds] = useState(props.relationships.map((relationship) => relationship.id))

    useEffect(() => {
        function close(event: MouseEvent) { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(null) }
        document.addEventListener("mousedown", close)
        return () => document.removeEventListener("mousedown", close)
    }, [])

    function toggle(name: string) {
        setError(null); setQuery("")
        if (open !== name) {
            setStartDate(dateInputValue(completed ? props.actualStartAt : props.plannedStartDate))
            setDueDate(dateInputValue(completed ? props.actualCompletedAt : props.dueDate))
            setAssigneeIds(props.assignees.map((person) => person.user_id))
            setParentId(props.parentId ?? "")
            setWaitForParent(props.waitsForParent || !props.parentId)
            setDependencyIds(props.manualDependencyIds)
            setRelationshipIds(props.relationships.map((relationship) => relationship.id))
        }
        setOpen((current) => current === name ? null : name)
    }
    function save(action: () => Promise<void>) {
        setError(null)
        startTransition(async () => {
            try { await action(); setOpen(null); router.refresh() }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this field") }
        })
    }
    function toggleId(values: string[], id: string, setter: (values: string[]) => void) { setter(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]) }
    const filteredMembers = useMemo(() => props.members.filter((person) => person.username.toLowerCase().includes(query.toLowerCase())), [props.members, query])
    const filteredWork = useMemo(() => props.workOptions.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())), [props.workOptions, query])
    const filteredRelationships = useMemo(() => props.relationshipOptions.filter((relationship) => relationship.label.toLowerCase().includes(query.toLowerCase())), [props.relationshipOptions, query])

    return (
        <div ref={rootRef}>
            <section className="mt-5 border-y border-neutral-800 py-1">
                <div className="grid gap-x-10 lg:grid-cols-2">
                    <div className="divide-y divide-neutral-900">
                        <Field label="Status"><Status label={props.statusLabel} tone={props.statusTone} /></Field>
                        <Field label="Schedule">
                            <div className="flex flex-wrap items-center gap-1">
                                <div className="relative">
                                    <button type="button" onClick={() => toggle("start")} className="rounded px-1 py-0.5 hover:bg-neutral-900 hover:text-white">{props.status === "done" ? displayDate(props.actualStartAt) : displayDate(props.plannedStartDate)}</button>
                                    {open === "start" ? <Popup className="w-64 p-3"><p className="mb-2 text-xs text-neutral-500">{completed ? "Actual start" : "Planned start"}</p><input autoFocus type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><PopupFooter pending={pending} onCancel={() => setOpen(null)} onSave={() => save(() => updateWorkItemSchedule(props.workspaceSlug, props.workItemId, startDate || null, dueDate || null, completed))} /></Popup> : null}
                                </div>
                                <span className="px-1 text-neutral-600">→</span>
                                <span className="text-neutral-500">{props.status === "done" ? "Finished" : "Due"}</span>
                                <div className="relative">
                                    <button type="button" onClick={() => toggle("due")} className="rounded px-1 py-0.5 hover:bg-neutral-900 hover:text-white">{props.status === "done" ? displayDate(props.actualCompletedAt) : displayDate(props.dueDate)}</button>
                                    {open === "due" ? <Popup className="w-64 p-3"><p className="mb-2 text-xs text-neutral-500">{completed ? "Finished" : "Due date"}</p><input autoFocus type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><PopupFooter pending={pending} onCancel={() => setOpen(null)} onSave={() => save(() => updateWorkItemSchedule(props.workspaceSlug, props.workItemId, startDate || null, dueDate || null, completed))} /></Popup> : null}
                                </div>
                            </div>
                        </Field>
                        <Field label="Assigned to">
                            <div className="relative inline-flex max-w-full flex-wrap gap-1.5">
                                <button type="button" onClick={() => toggle("assignees")} className="flex max-w-full flex-wrap gap-1.5 rounded p-0.5 hover:bg-neutral-900">
                                    {props.assignees.length ? props.assignees.map((person) => <Assignee key={person.user_id} name={person.username} avatarSrc={person.avatar_url} />) : <span className="px-1 text-neutral-600">Unassigned</span>}
                                </button>
                                {open === "assignees" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search users…" /><div className="max-h-64 overflow-y-auto p-1.5">{filteredMembers.map((person) => <button type="button" key={person.user_id} onClick={() => toggleId(assigneeIds, person.user_id, setAssigneeIds)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-neutral-900"><Avatar src={person.avatar_url} name={person.username} className="h-7 w-7" /><span className="min-w-0 flex-1 truncate text-sm">{person.username}</span><span className="text-sm text-neutral-500">{assigneeIds.includes(person.user_id) ? "✓" : ""}</span></button>)}</div><PopupFooter pending={pending} onCancel={() => setOpen(null)} onSave={() => save(() => updateWorkItemAssignees(props.workspaceSlug, props.workItemId, assigneeIds))} /></Popup> : null}
                            </div>
                        </Field>
                        <Field label="Created by">{props.creator ? <Assignee name={props.creator.username} avatarSrc={props.creator.avatar_url} /> : <span className="text-neutral-600">System or imported</span>}</Field>
                    </div>
                    <div className="divide-y divide-neutral-900 lg:border-l lg:border-neutral-900 lg:pl-10">
                        <Field label="Parent"><div className="relative inline-block max-w-full"><button type="button" onClick={() => toggle("parent")} className="max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-neutral-900 hover:text-white">{props.parent?.title ?? "None"}</button>{open === "parent" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search work items…" /><div className="max-h-56 overflow-y-auto p-1.5"><button type="button" onClick={() => setParentId("")} className="w-full rounded-lg px-2 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-900">No parent</button>{filteredWork.map((item) => <button type="button" key={item.id} onClick={() => setParentId(item.id)} className="flex w-full gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-neutral-900"><span className="min-w-0 flex-1 truncate">{item.title}</span><span>{parentId === item.id ? "✓" : ""}</span></button>)}</div><label className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2 text-xs text-neutral-300"><input type="checkbox" checked={waitForParent} disabled={!parentId} onChange={(event) => setWaitForParent(event.target.checked)} /> Wait for parent</label><PopupFooter pending={pending} onCancel={() => setOpen(null)} onSave={() => save(() => updateWorkItemParent(props.workspaceSlug, props.workItemId, parentId || null, Boolean(parentId && waitForParent)))} /></Popup> : null}</div></Field>
                        <Field label="Dependencies"><div className="relative inline-block max-w-full"><button type="button" onClick={() => toggle("dependencies")} className="max-w-full rounded px-1 py-0.5 text-left hover:bg-neutral-900 hover:text-white">{props.dependencies.length ? props.dependencies.map((item) => item.title).join(", ") : "None"}</button>{open === "dependencies" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search work items…" /><div className="max-h-64 overflow-y-auto p-1.5">{filteredWork.map((item) => <button type="button" key={item.id} disabled={item.id === parentId} onClick={() => toggleId(dependencyIds, item.id, setDependencyIds)} className="flex w-full gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-neutral-900 disabled:opacity-40"><span className="min-w-0 flex-1 truncate">{item.title}</span><span>{dependencyIds.includes(item.id) ? "✓" : ""}</span></button>)}</div><PopupFooter pending={pending} onCancel={() => setOpen(null)} onSave={() => save(() => updateWorkItemDependencies(props.workspaceSlug, props.workItemId, dependencyIds))} /></Popup> : null}</div></Field>
                        <Field label="Relationships"><div className="relative inline-flex max-w-full flex-wrap gap-1.5"><button type="button" disabled={props.relationshipsLocked} onClick={() => toggle("relationships")} className="flex max-w-full flex-wrap gap-1.5 rounded p-0.5 hover:bg-neutral-900 disabled:cursor-default disabled:hover:bg-transparent">{props.relationships.length ? props.relationships.map((relationship) => <RoundPill key={relationship.id} tone="sky">{relationship.label}</RoundPill>) : <span className="px-1 text-neutral-600">Workspace only</span>}</button>{open === "relationships" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search relationships…" /><div className="max-h-64 overflow-y-auto p-1.5">{filteredRelationships.map((relationship) => <button type="button" key={relationship.id} onClick={() => toggleId(relationshipIds, relationship.id, setRelationshipIds)} className="flex w-full gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-neutral-900"><span className="min-w-0 flex-1 truncate">{relationship.label}</span><span>{relationshipIds.includes(relationship.id) ? "✓" : ""}</span></button>)}</div><PopupFooter pending={pending} onCancel={() => setOpen(null)} onSave={() => save(() => updateWorkItemRelationships(props.workspaceSlug, props.workItemId, relationshipIds))} /></Popup> : null}</div>{props.relationshipsLocked ? <p className="mt-1 text-xs text-neutral-600">Managed by onboarding</p> : null}</Field>
                        <Field label="Priority"><div className="relative inline-block"><button type="button" onClick={() => toggle("priority")} className="rounded px-1 py-0.5 hover:bg-neutral-900 hover:text-white">{["", "Urgent", "High", "Normal", "Low", "Lowest"][props.priority]}</button>{open === "priority" ? <Popup className="w-48"><div className="p-1.5">{["Urgent", "High", "Normal", "Low", "Lowest"].map((label, index) => <button type="button" key={label} onClick={() => save(() => updateWorkItemPriority(props.workspaceSlug, props.workItemId, index + 1))} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-neutral-900"><span>{label}</span><span>{props.priority === index + 1 ? "✓" : ""}</span></button>)}</div></Popup> : null}</div></Field>
                    </div>
                </div>
                {error ? <p className="border-t border-red-500/20 py-2 text-sm text-red-300">{error}</p> : null}
            </section>
        </div>
    )
}
