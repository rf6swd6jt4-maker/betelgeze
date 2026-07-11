"use client"

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react"
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
    plannedStartTime: string | null
    dueDate: string | null
    dueTime: string | null
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

function displayDate(value: string | null, time: string | null = null) {
    if (!value) return "Not set"
    const date = new Date(value.includes("T") ? value : `${value}T12:00:00`)
    const formatted = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(date)
    return time ? `${formatted}, ${time.slice(0, 5)}` : formatted
}

function dateInputValue(value: string | null) {
    return value ? value.slice(0, 10) : ""
}

function timeInputValue(value: string | null) {
    if (!value) return ""
    return value.includes("T") ? value.slice(11, 16) : value.slice(0, 5)
}

type FieldIcon = "status" | "schedule" | "user" | "parent" | "dependency" | "relationship" | "priority"

function Icon({ kind }: { kind: FieldIcon }) {
    const paths: Record<FieldIcon, ReactNode> = {
        status: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /></>,
        schedule: <><path d="M7 3v3M17 3v3M4 9h16" /><rect x="4" y="5" width="16" height="15" rx="2" /></>,
        user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>,
        parent: <><path d="M6 5h5v5H6zM13 14h5v5h-5zM8.5 10v2a4 4 0 0 0 4 4h.5" /></>,
        dependency: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="M9.5 9.5l5 5" /></>,
        relationship: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20c.5-3.3 2.3-5 5.5-5M21.5 20c-.5-3.3-2.3-5-5.5-5M10 17h4" /></>,
        priority: <><path d="M6 21V4M6 5h11l-2 4 2 4H6" /></>,
    }
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">{paths[kind]}</svg>
}

function Field({ label, icon, children }: { label: string; icon: FieldIcon; children: ReactNode }) {
    return <div className="grid min-h-10 grid-cols-[8rem_minmax(0,1fr)] items-start gap-2 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]"><p className="flex items-center gap-2 pt-0.5 text-sm text-neutral-500"><Icon kind={icon} /><span>{label}</span></p><div className="min-w-0 text-sm text-neutral-200">{children}</div></div>
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
    return <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 w-full border-b border-neutral-800 bg-transparent px-2.5 text-sm text-white outline-none placeholder:text-neutral-600" />
}

function Popup({ children, className = "w-72" }: { children: ReactNode; className?: string }) {
    return <div data-work-item-popup className={`absolute left-0 top-full z-[100] mt-1 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/60 ${className}`}>{children}</div>
}

function PopupFooter({ onSave, onClear, pending }: { onSave: () => void; onClear?: () => void; pending: boolean }) {
    return <div className="flex justify-end gap-1.5 border-t border-neutral-800 p-1.5">{onClear ? <button type="button" disabled={pending} onClick={onClear} className="h-8 px-2 text-xs text-neutral-400 hover:text-white disabled:opacity-50">Clear</button> : null}<button type="button" disabled={pending} onClick={onSave} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save"}</button></div>
}

function MinimalDateTimeInputs({ date, time, onDateChange, onTimeChange, timeLabel }: { date: string; time: string; onDateChange: (value: string) => void; onTimeChange: (value: string) => void; timeLabel: string }) {
    return <div className="grid grid-cols-[1fr_6rem] gap-1.5"><label className="relative"><input autoFocus type="date" value={date} onChange={(event) => onDateChange(event.target.value)} aria-label="Date" className={`h-9 min-w-0 w-full appearance-none rounded-md border border-neutral-700 bg-black px-2 text-sm outline-none [&::-webkit-calendar-picker-indicator]:hidden ${date ? "text-white" : "text-transparent"}`} />{date ? null : <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-neutral-500">--/--/----</span>}</label><label className="relative"><input type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} aria-label={timeLabel} className={`h-9 min-w-0 w-full appearance-none rounded-md border border-neutral-700 bg-black px-2 text-sm outline-none [&::-webkit-calendar-picker-indicator]:hidden ${time ? "text-white" : "text-transparent"}`} />{time ? null : <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-neutral-500">--:--</span>}</label></div>
}

export function InlineWorkItemFields(props: Props) {
    const router = useRouter()
    const [open, setOpen] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const completed = props.status === "done"
    const [startDate, setStartDate] = useState(dateInputValue(completed ? props.actualStartAt : props.plannedStartDate))
    const [startTime, setStartTime] = useState(timeInputValue(completed ? props.actualStartAt : props.plannedStartTime))
    const [dueDate, setDueDate] = useState(dateInputValue(completed ? props.actualCompletedAt : props.dueDate))
    const [dueTime, setDueTime] = useState(timeInputValue(completed ? props.actualCompletedAt : props.dueTime))
    const [assigneeIds, setAssigneeIds] = useState(props.assignees.map((person) => person.user_id))
    const [parentId, setParentId] = useState(props.parentId ?? "")
    const [waitForParent, setWaitForParent] = useState(props.waitsForParent || !props.parentId)
    const [dependencyIds, setDependencyIds] = useState(props.manualDependencyIds)
    const [relationshipIds, setRelationshipIds] = useState(props.relationships.map((relationship) => relationship.id))

    useEffect(() => {
        function close(event: MouseEvent) {
            const target = event.target as Element
            if (!target.closest("[data-work-item-popup]") && !target.closest("[data-work-item-popup-trigger]")) setOpen(null)
        }
        document.addEventListener("mousedown", close)
        return () => document.removeEventListener("mousedown", close)
    }, [])

    function toggle(name: string) {
        setError(null); setQuery("")
        if (open !== name) {
            setStartDate(dateInputValue(completed ? props.actualStartAt : props.plannedStartDate))
            setStartTime(timeInputValue(completed ? props.actualStartAt : props.plannedStartTime))
            setDueDate(dateInputValue(completed ? props.actualCompletedAt : props.dueDate))
            setDueTime(timeInputValue(completed ? props.actualCompletedAt : props.dueTime))
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
        setOpen(null)
        startTransition(async () => {
            try { await action(); router.refresh() }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this field") }
        })
    }
    function toggleId(values: string[], id: string, setter: (values: string[]) => void) { setter(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]) }
    const filteredMembers = useMemo(() => props.members.filter((person) => person.username.toLowerCase().includes(query.toLowerCase())), [props.members, query])
    const filteredWork = useMemo(() => props.workOptions.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())), [props.workOptions, query])
    const filteredRelationships = useMemo(() => props.relationshipOptions.filter((relationship) => relationship.label.toLowerCase().includes(query.toLowerCase())), [props.relationshipOptions, query])

    return (
        <div className="relative">
            <section className="mt-5 border-b border-neutral-800 py-1">
                <div className="grid gap-x-10 lg:grid-cols-2">
                    <div className="divide-y divide-neutral-900">
                        <Field label="Status" icon="status"><Status label={props.statusLabel} tone={props.statusTone} /></Field>
                        <Field label="Schedule" icon="schedule">
                            <div className="flex flex-wrap items-center gap-1">
                                <div className="relative">
                                    <button data-work-item-popup-trigger type="button" onClick={() => toggle("start")} className="rounded py-0.5 hover:text-white">{completed ? displayDate(props.actualStartAt, timeInputValue(props.actualStartAt)) : displayDate(props.plannedStartDate, props.plannedStartTime)}</button>
                                    {open === "start" ? <Popup className="w-64"><div className="p-2.5"><p className="mb-1.5 text-xs text-neutral-500">{completed ? "Actual start" : "Planned start"}</p><MinimalDateTimeInputs date={startDate} time={startTime} onDateChange={setStartDate} onTimeChange={setStartTime} timeLabel="Optional start time" /></div><PopupFooter pending={pending} onClear={startDate || startTime ? () => { setStartDate(""); setStartTime("") } : undefined} onSave={() => save(() => updateWorkItemSchedule(props.workspaceSlug, props.workItemId, startDate || null, startTime || null, dueDate || null, dueTime || null, completed))} /></Popup> : null}
                                </div>
                                <span className="px-1 text-neutral-600">→</span>
                                <span className="text-neutral-500">{props.status === "done" ? "Finished" : "Due"}</span>
                                <div className="relative">
                                    <button data-work-item-popup-trigger type="button" onClick={() => toggle("due")} className="rounded py-0.5 hover:text-white">{completed ? displayDate(props.actualCompletedAt, timeInputValue(props.actualCompletedAt)) : displayDate(props.dueDate, props.dueTime)}</button>
                                    {open === "due" ? <Popup className="w-64"><div className="p-2.5"><p className="mb-1.5 text-xs text-neutral-500">{completed ? "Finished" : "Due date"}</p><MinimalDateTimeInputs date={dueDate} time={dueTime} onDateChange={setDueDate} onTimeChange={setDueTime} timeLabel="Optional finish time" /></div><PopupFooter pending={pending} onClear={dueDate || dueTime ? () => { setDueDate(""); setDueTime("") } : undefined} onSave={() => save(() => updateWorkItemSchedule(props.workspaceSlug, props.workItemId, startDate || null, startTime || null, dueDate || null, dueTime || null, completed))} /></Popup> : null}
                                </div>
                            </div>
                        </Field>
                        <Field label="Assigned to" icon="user">
                            <div className="relative inline-flex max-w-full flex-wrap gap-1.5">
                                <button data-work-item-popup-trigger type="button" onClick={() => toggle("assignees")} className="flex max-w-full flex-wrap gap-1.5 rounded p-0 hover:opacity-90">
                                    {props.assignees.length ? props.assignees.map((person) => <Assignee key={person.user_id} name={person.username} avatarSrc={person.avatar_url} />) : <span className="text-neutral-600">Unassigned</span>}
                                </button>
                                {open === "assignees" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search users…" /><div className="max-h-64 overflow-y-auto p-1">{filteredMembers.map((person) => <button type="button" key={person.user_id} onClick={() => toggleId(assigneeIds, person.user_id, setAssigneeIds)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left hover:bg-neutral-900"><Avatar src={person.avatar_url} name={person.username} className="h-7 w-7" /><span className="min-w-0 flex-1 truncate text-sm">{person.username}</span><span className="text-sm text-neutral-500">{assigneeIds.includes(person.user_id) ? "✓" : ""}</span></button>)}</div><PopupFooter pending={pending} onClear={assigneeIds.length ? () => setAssigneeIds([]) : undefined} onSave={() => save(() => updateWorkItemAssignees(props.workspaceSlug, props.workItemId, assigneeIds))} /></Popup> : null}
                            </div>
                        </Field>
                        <Field label="Created by" icon="user">{props.creator ? <Assignee name={props.creator.username} avatarSrc={props.creator.avatar_url} /> : <span className="text-neutral-600">System or imported</span>}</Field>
                    </div>
                    <div className="divide-y divide-neutral-900 lg:border-l lg:border-neutral-900 lg:pl-10">
                        <Field label="Parent" icon="parent"><div className="relative inline-block max-w-full"><button data-work-item-popup-trigger type="button" onClick={() => toggle("parent")} className="block max-w-full rounded py-0.5 text-left hover:text-white">{props.parent ? <span className="block truncate">{props.parent.title}</span> : "None"}</button>{open === "parent" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search work items…" /><div className="max-h-56 overflow-y-auto p-1"><button type="button" onClick={() => setParentId("")} className="w-full rounded-lg px-1.5 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-900">No parent</button>{filteredWork.map((item) => <button type="button" key={item.id} onClick={() => setParentId(item.id)} className="flex w-full gap-2 rounded-lg px-1.5 py-2 text-left text-sm hover:bg-neutral-900"><span className="min-w-0 flex-1 truncate">{item.title}</span><span>{parentId === item.id ? "✓" : ""}</span></button>)}</div><label className="flex items-center gap-2 border-t border-neutral-800 px-2.5 py-2 text-xs text-neutral-300"><input type="checkbox" checked={waitForParent} disabled={!parentId} onChange={(event) => setWaitForParent(event.target.checked)} /> Wait for parent</label><PopupFooter pending={pending} onClear={parentId ? () => { setParentId(""); setWaitForParent(false) } : undefined} onSave={() => save(() => updateWorkItemParent(props.workspaceSlug, props.workItemId, parentId || null, Boolean(parentId && waitForParent)))} /></Popup> : null}</div></Field>
                        <Field label="Dependencies" icon="dependency"><div className="relative inline-block max-w-full"><button data-work-item-popup-trigger type="button" onClick={() => toggle("dependencies")} className="max-w-full rounded py-0.5 text-left hover:text-white">{props.dependencies.length ? props.dependencies.map((item) => item.title).join(", ") : "None"}</button>{open === "dependencies" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search work items…" /><div className="max-h-64 overflow-y-auto p-1">{filteredWork.map((item) => <button type="button" key={item.id} disabled={item.id === parentId} onClick={() => toggleId(dependencyIds, item.id, setDependencyIds)} className="flex w-full gap-2 rounded-lg px-1.5 py-2 text-left text-sm hover:bg-neutral-900 disabled:opacity-40"><span className="min-w-0 flex-1 truncate">{item.title}</span><span>{dependencyIds.includes(item.id) ? "✓" : ""}</span></button>)}</div><PopupFooter pending={pending} onClear={dependencyIds.length ? () => setDependencyIds([]) : undefined} onSave={() => save(() => updateWorkItemDependencies(props.workspaceSlug, props.workItemId, dependencyIds))} /></Popup> : null}</div></Field>
                        <Field label="Relationships" icon="relationship"><div className="relative inline-flex max-w-full flex-wrap gap-1.5"><button data-work-item-popup-trigger type="button" aria-disabled={props.relationshipsLocked} onClick={() => { if (!props.relationshipsLocked) toggle("relationships") }} className={`flex max-w-full flex-wrap gap-1.5 rounded p-0 ${props.relationshipsLocked ? "cursor-not-allowed" : "hover:opacity-90"}`}>{props.relationships.length ? props.relationships.map((relationship) => <RoundPill key={relationship.id} tone="sky">{relationship.label}</RoundPill>) : <span className="text-neutral-600">Workspace only</span>}</button>{open === "relationships" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search relationships…" /><div className="max-h-64 overflow-y-auto p-1">{filteredRelationships.map((relationship) => <button type="button" key={relationship.id} onClick={() => toggleId(relationshipIds, relationship.id, setRelationshipIds)} className="flex w-full gap-2 rounded-lg px-1.5 py-2 text-left text-sm hover:bg-neutral-900"><span className="min-w-0 flex-1 truncate">{relationship.label}</span><span>{relationshipIds.includes(relationship.id) ? "✓" : ""}</span></button>)}</div><PopupFooter pending={pending} onClear={relationshipIds.length ? () => setRelationshipIds([]) : undefined} onSave={() => save(() => updateWorkItemRelationships(props.workspaceSlug, props.workItemId, relationshipIds))} /></Popup> : null}</div></Field>
                        <Field label="Priority" icon="priority"><div className="relative inline-block"><button data-work-item-popup-trigger type="button" onClick={() => toggle("priority")} className="rounded py-0.5 hover:text-white">{["", "Urgent", "High", "Normal", "Low", "Lowest"][props.priority]}</button>{open === "priority" ? <Popup className="w-48"><div className="p-1">{["Urgent", "High", "Normal", "Low", "Lowest"].map((label, index) => <button type="button" key={label} onClick={() => save(() => updateWorkItemPriority(props.workspaceSlug, props.workItemId, index + 1))} className="flex w-full items-center justify-between rounded-lg px-1.5 py-2 text-left text-sm hover:bg-neutral-900"><span>{label}</span><span>{props.priority === index + 1 ? "✓" : ""}</span></button>)}</div></Popup> : null}</div></Field>
                    </div>
                </div>
                {error ? <p className="border-t border-red-500/20 py-2 text-sm text-red-300">{error}</p> : null}
            </section>
        </div>
    )
}
