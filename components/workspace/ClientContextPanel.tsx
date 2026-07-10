"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { WORKSPACE_TAB_FRAME_PARAM } from "@/lib/workspace-tabs"

type RelationshipPhase =
    | "lead"
    | "nurturing"
    | "potential_client"
    | "invoiced"
    | "onboarding"
    | "onboarding_complete"
    | "fulfilment"
    | "retention"
    | "completed_lost"

type ContextRelationship = {
    id: string
    primary_person_name: string
    primary_email: string | null
    primary_phone: string | null
    business_name: string | null
    website_url: string | null
    industry_value: string | null
    location_value: string | null
    source_label: string | null
    primary_contact_role: string | null
    notes_summary: string | null
    lifecycle_phase: RelationshipPhase
}

type ContextMetric = {
    label: string
    value: string | number
}

type Props = {
    workspaceSlug: string
    relationship: ContextRelationship | null
    metrics?: ContextMetric[]
}

function phaseLabel(phase: string) {
    return phase.replace(/_/g, " ")
}

function workspaceHref(workspaceSlug: string, suffix: string) {
    return `/${workspaceSlug}/${suffix.replace(/^\/+/, "")}`
}

function displayValue(value: string | null | undefined, fallback = "Not saved") {
    return value?.trim() || fallback
}

function RelationshipContextIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2">
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="M15 5v14" />
        </svg>
    )
}

export function ClientContextPanel({ workspaceSlug, relationship, metrics = [] }: Props) {
    const searchParams = useSearchParams()
    const tabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM) ?? "standalone"
    const storageKey = useMemo(() => `betelgeze:client-context:${workspaceSlug}:${tabId}:open`, [tabId, workspaceSlug])
    const [open, setOpen] = useState(() => typeof window === "undefined" ? true : sessionStorage.getItem(storageKey) !== "false")

    useEffect(() => {
        sessionStorage.setItem(storageKey, open ? "true" : "false")
    }, [open, storageKey])

    if (!relationship) return null

    if (!open) {
        return (
            <aside className="hidden w-10 shrink-0 xl:block">
                <div className="sticky top-16 flex justify-end">
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        aria-label="Show relationship context"
                        aria-expanded={false}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-400 shadow-lg shadow-black/20 hover:border-neutral-700 hover:bg-neutral-900 hover:text-white"
                    >
                        <RelationshipContextIcon />
                    </button>
                </div>
            </aside>
        )
    }

    return (
        <aside className="hidden w-80 shrink-0 xl:block">
            <div className="sticky top-16 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 text-white shadow-lg shadow-black/20">
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Relationship Context</p>
                        <h2 className="truncate text-sm font-semibold">{relationship.primary_person_name}</h2>
                    </div>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Hide relationship context"
                        aria-expanded={true}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-900 hover:text-white"
                    >
                        <RelationshipContextIcon />
                    </button>
                </div>

                <div className="max-h-[calc(100vh-5rem)] overflow-y-auto border-t border-neutral-900 px-4 py-4">
                    <section>
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Relationship</p>
                        <dl className="mt-3 space-y-3 text-sm">
                            <div>
                                <dt className="text-neutral-500">Company</dt>
                                <dd className="mt-1 text-neutral-100">{displayValue(relationship.business_name)}</dd>
                            </div>
                            <div>
                                <dt className="text-neutral-500">Lifecycle</dt>
                                <dd className="mt-1 capitalize text-neutral-100">{phaseLabel(relationship.lifecycle_phase)}</dd>
                            </div>
                            <div>
                                <dt className="text-neutral-500">Role</dt>
                                <dd className="mt-1 text-neutral-100">{displayValue(relationship.primary_contact_role)}</dd>
                            </div>
                        </dl>
                    </section>

                    <section className="mt-5 border-t border-neutral-900 pt-4">
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Contact</p>
                        <dl className="mt-3 space-y-3 text-sm">
                            <div>
                                <dt className="text-neutral-500">Phone</dt>
                                <dd className="mt-1 text-neutral-100">{displayValue(relationship.primary_phone)}</dd>
                            </div>
                            <div>
                                <dt className="text-neutral-500">Email</dt>
                                <dd className="mt-1 truncate text-neutral-100">{displayValue(relationship.primary_email)}</dd>
                            </div>
                            <div>
                                <dt className="text-neutral-500">Website</dt>
                                <dd className="mt-1 truncate text-neutral-100">{displayValue(relationship.website_url)}</dd>
                            </div>
                        </dl>
                    </section>

                    <section className="mt-5 border-t border-neutral-900 pt-4">
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Context</p>
                        <dl className="mt-3 space-y-3 text-sm">
                            <div>
                                <dt className="text-neutral-500">Industry</dt>
                                <dd className="mt-1 capitalize text-neutral-100">{displayValue(relationship.industry_value?.replace(/_/g, " "))}</dd>
                            </div>
                            <div>
                                <dt className="text-neutral-500">Location</dt>
                                <dd className="mt-1 capitalize text-neutral-100">{displayValue(relationship.location_value?.replace(/_/g, " "))}</dd>
                            </div>
                            <div>
                                <dt className="text-neutral-500">Source</dt>
                                <dd className="mt-1 text-neutral-100">{displayValue(relationship.source_label)}</dd>
                            </div>
                        </dl>
                        {relationship.notes_summary && (
                            <p className="mt-4 rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm leading-6 text-neutral-300">
                                {relationship.notes_summary}
                            </p>
                        )}
                    </section>

                    {metrics.length > 0 && (
                        <section className="mt-5 border-t border-neutral-900 pt-4">
                            <p className="text-xs uppercase tracking-wide text-neutral-500">Current view</p>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                {metrics.map((metric) => (
                                    <div key={metric.label} className="rounded-lg border border-neutral-800 bg-black px-3 py-2">
                                        <p className="text-xs text-neutral-500">{metric.label}</p>
                                        <p className="mt-1 text-sm font-medium text-neutral-100">{metric.value}</p>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <section className="mt-5 border-t border-neutral-900 pt-4">
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Open</p>
                        <div className="mt-3 grid gap-2 text-sm">
                            <Link href={workspaceHref(workspaceSlug, `relationships/${relationship.id}`)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                                Relationship summary
                            </Link>
                            <Link href={workspaceHref(workspaceSlug, `onboarding/${relationship.id}`)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                                Onboarding
                            </Link>
                            <Link href={workspaceHref(workspaceSlug, `work/${relationship.id}`)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                                Project work
                            </Link>
                        </div>
                    </section>
                </div>
            </div>
        </aside>
    )
}
