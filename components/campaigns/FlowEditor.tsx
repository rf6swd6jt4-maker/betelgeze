"use client"

/* eslint-disable @next/next/no-img-element -- flow pictures are private, authorized and already under 500 KB */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "@/components/workspace/WorkspaceLink"
import { useRouter } from "@/components/workspace/WorkspaceNavigation"
import { Button, CenteredDialog, RoundPill, Selector } from "@/components/ui"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, SectionHeading } from "@/components/detail"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { deleteFlowAction, duplicateFlowAction, removeFromFlowAction, saveFlowAction, sendFlowTestAction, uploadFlowImageAction } from "@/app/[workspaceSlug]/campaigns/flow-actions"
import {
    FLOW_ACTIONS, FLOW_CONDITIONS, FLOW_FIELD_INFO, FLOW_IMAGE_MAX_BYTES, FLOW_REPLY_ACTIONS, FLOW_STOPS, FLOW_TRIGGERS, FLOW_WINDOW_DAYS, FLOW_WINDOW_ENDS, FLOW_WINDOW_STARTS,
    RESERVED_WORDS, actionText, defaultStep, fillFlowText, flowFields, flowHasAppointment, flowWarnings, minuteText, smsSegments, stepSummary, triggerText, waitText,
    type FlowField, type FlowReply, type FlowSettings, type FlowSourceFacts, type FlowStep, type FlowTrigger, type FlowWindowDays,
} from "@/lib/campaigns/flows"
import { CAMPAIGN_STAGES, campaignStageLabels, type CampaignStage, type CampaignTagTone } from "@/lib/campaigns/model"

type Source = FlowSourceFacts & { name: string; tone: string }
type Preview = { id: string; name: string; company: string | null; sourceId: string | null; fields: Partial<Record<FlowField, string | null>> }
type InFlow = { runId: string; leadId: string; stepIndex: number; startedAt: string }

const inputClass = "h-10 min-w-0 rounded-lg border border-neutral-700 bg-black px-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 hover:border-neutral-500 focus:border-neutral-400"
const rowClass = "grid grid-cols-1 items-start gap-2 border-t border-card-border py-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10"
const options = <K extends string>(map: Record<K, string>, keys?: readonly K[]) => (keys ?? (Object.keys(map) as K[])).map(key => ({ value: key, label: map[key] }))

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
    return <section aria-label={label} className={rowClass}>
        <div><h2 className="text-sm font-medium text-neutral-200">{label}</h2><p className="mt-1 max-w-[34ch] text-xs leading-5 text-neutral-500">{hint}</p></div>
        <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
}

const ICONS: Record<FlowStep["kind"] | "start", ReactNode> = {
    start: <path d="M9 2 4 9h4l-1 5 5-7H8z" />,
    text: <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />,
    wait: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></>,
    if: <path d="M4 3v4c0 2 2 3 4 3M12 3v4c0 2-2 3-4 3M8 10v3" />,
    act: <path d="M5.5 3h5a1 1 0 0 1 1 1v8.5h-7V4a1 1 0 0 1 1-1zM6.5 7l1.2 1.2L10 6" />,
}
const TITLES: Record<FlowStep["kind"], string> = { text: "Send a text", wait: "Wait", if: "Only continue if", act: "Then" }

function StepIcon({ kind, selected }: { kind: FlowStep["kind"] | "start" | "end"; selected?: boolean }) {
    return <span aria-hidden="true" className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${selected ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]" : "bg-white/[0.075] text-neutral-400"}`}>
        {kind === "end" ? <span className="h-2 w-2 bg-current" /> : <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={1.5}>{ICONS[kind]}</svg>}
    </span>
}

function Bubble({ text, image, imageSrc }: { text: string; image: boolean; imageSrc?: string | null }) {
    return <div className="flex justify-end">
        <p className="max-w-[min(84%,26rem)] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-neutral-100 px-3 py-2 text-[13px] leading-5 text-neutral-950">
            {image ? imageSrc ? <img src={imageSrc} alt="" className="mb-1.5 max-h-40 rounded-lg" /> : <span className="mb-1.5 block rounded-lg bg-neutral-300 px-3 py-4 text-center text-[11px] text-neutral-600">Picture</span> : null}
            {text || <i className="text-neutral-500">Nothing yet</i>}
        </p>
    </div>
}

/**
 * A text flow's editor (docs/text-flows.md), as in the Campaigns mockup. Every change saves as it is made: typing after a
 * short pause, choices at once, one save at a time. Leads already in the flow get the new version from their next step.
 */
export function FlowEditor({ workspaceSlug, campaignId, base, initial, sources, setters, previews, inFlow, numberName }: {
    workspaceSlug: string; campaignId: string; base: string; initial: FlowSettings; sources: Source[]; setters: { id: string; name: string }[]
    previews: Preview[]; inFlow: InFlow[]; numberName: string | null
}) {
    const router = useRouter()
    const [flow, setFlow] = useState(initial)
    const [selected, setSelected] = useState<number>(-1)
    const [inserting, setInserting] = useState<number | null>(null)
    const [previewId, setPreviewId] = useState(previews.find(item => inFlow.some(run => run.leadId === item.id))?.id ?? previews[0]?.id ?? "")
    const [previewOpen, setPreviewOpen] = useState(false)
    const [testOpen, setTestOpen] = useState(false)
    const [testPhone, setTestPhone] = useState("")
    const [deleting, setDeleting] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
    const [save, setSave] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" })
    const pending = useRef<Partial<FlowSettings>>({})
    const timer = useRef<number | null>(null)
    const inFlight = useRef<Promise<void> | null>(null)
    const textareas = useRef(new Map<number, HTMLTextAreaElement>())

    const flush = useCallback(async () => {
        if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
        if (inFlight.current) await inFlight.current
        const patch = pending.current
        if (!Object.keys(patch).length) return
        pending.current = {}
        setSave({ kind: "saving" })
        const run = runWorkspaceMutation(() => saveFlowAction(workspaceSlug, campaignId, initial.id, patch)).then(result => {
            if (!result.ok) {
                // Keep the edit to retry: merge it back under anything typed since.
                pending.current = { ...patch, ...pending.current }
                setSave({ kind: "error", message: result.error })
            } else setSave({ kind: "saved" })
        }, () => { pending.current = { ...patch, ...pending.current }; setSave({ kind: "error", message: "Could not save. Please retry." }) })
        inFlight.current = run.finally(() => { inFlight.current = null })
        await inFlight.current
    }, [campaignId, initial.id, workspaceSlug])

    const update = useCallback((patch: Partial<FlowSettings>, mode: "now" | "typing" = "now") => {
        setFlow(current => ({ ...current, ...patch }))
        pending.current = { ...pending.current, ...patch }
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { void flush() }, mode === "typing" ? 800 : 0)
    }, [flush])
    useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
    useEffect(() => {
        const before = () => { if (Object.keys(pending.current).length) void flush() }
        window.addEventListener("pagehide", before)
        return () => window.removeEventListener("pagehide", before)
    }, [flush])

    const setSteps = (steps: FlowStep[], mode: "now" | "typing" = "now") => update({ steps }, mode)
    const setStep = (index: number, patch: Partial<FlowStep>, mode: "now" | "typing" = "now") => setSteps(flow.steps.map((step, i) => i === index ? { ...step, ...patch } as FlowStep : step), mode)

    const warnings = useMemo(() => flowWarnings(flow, sources), [flow, sources])
    const fields = flowFields(flow)
    const pool = useMemo(() => previews.filter(item => flow.sourceIds === null || (item.sourceId && flow.sourceIds.includes(item.sourceId))), [previews, flow.sourceIds])
    const preview = pool.find(item => item.id === previewId) ?? pool[0] ?? previews[0] ?? null
    const fill = (text: string) => fillFlowText(text, preview?.fields ?? {})
    const setterName = (id: string) => setters.find(setter => setter.id === id)?.name ?? null
    const imageSrc = (path: string) => `/api/workspaces/${encodeURIComponent(workspaceSlug)}/campaigns/flow-media?path=${encodeURIComponent(path)}`
    const stops = FLOW_STOPS.filter(([key]) => (key === "reply" && flow.stopOnReply) || (key === "book" && flow.stopOnBook) || (key === "pay" && flow.stopOnPay)).map(([, label]) => label.replace("They ", "").toLowerCase())
    const leadName = (id: string) => previews.find(item => item.id === id)

    async function act(name: string, run: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, done?: (result: Record<string, unknown>) => void) {
        setBusy(name); setNotice(null)
        try {
            await flush()
            const result = await runWorkspaceMutation(run)
            if (!result.ok) setNotice({ tone: "error", text: result.error ?? "Please retry." })
            else done?.(result)
        } catch { setNotice({ tone: "error", text: "Please retry." }) } finally { setBusy(null) }
    }

    function toggle() {
        if (!flow.enabled && warnings.length) { setNotice({ tone: "error", text: "Fix the things listed at the top first." }); return }
        const enabled = !flow.enabled
        void act("toggle", async () => {
            const result = await saveFlowAction(workspaceSlug, campaignId, initial.id, { enabled })
            return result
        }, () => { setFlow(current => ({ ...current, enabled })); setNotice({ tone: "ok", text: enabled ? "Flow is on. New leads that match start it." : "Flow is off. Leads in it stop where they are." }); router.refresh() })
    }

    function insertField(index: number, name: FlowField) {
        const area = textareas.current.get(index)
        const step = flow.steps[index]
        if (step?.kind !== "text") return
        const token = `{${name}}`
        const at = area?.selectionStart ?? step.body.length
        const end = area?.selectionEnd ?? at
        const body = step.body.slice(0, at) + token + step.body.slice(end)
        setStep(index, { body }, "typing")
        window.requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(at + token.length, at + token.length) })
    }

    async function addPicture(index: number, file: File | undefined) {
        if (!file) return
        if (file.size > FLOW_IMAGE_MAX_BYTES) { setNotice({ tone: "error", text: "Pictures must be under 500 KB so every carrier delivers them." }); return }
        const form = new FormData(); form.set("file", file)
        await act("picture", () => uploadFlowImageAction(workspaceSlug, campaignId, initial.id, form), result => setStep(index, { image: result.image as never }))
    }

    function stepEditor(step: FlowStep, index: number) {
        const count = flow.steps.length
        let body: ReactNode = null
        if (step.kind === "text") {
            const filled = fill(step.body)
            const info = smsSegments(filled)
            body = <>
                <textarea ref={element => { if (element) textareas.current.set(index, element); else textareas.current.delete(index) }} aria-label={`Text for step ${index + 1}`} rows={3} maxLength={1600}
                    value={step.body} onChange={event => setStep(index, { body: event.target.value }, "typing")} onBlur={() => void flush()}
                    className="min-h-20 w-full resize-y rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm leading-5 text-neutral-100 outline-none hover:border-neutral-500 focus:border-neutral-400" />
                <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-neutral-500">Insert</span>
                    {fields.map(name => <button key={name} type="button" data-icon-button title={FLOW_FIELD_INFO[name]} onClick={() => insertField(index, name)}
                        className="rounded px-1 py-0.5 font-mono text-[11px] text-neutral-300 hover:bg-white/[0.075] hover:text-white bg-white/[0.045]">{`{${name}}`}</button>)}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                    {step.image ? <span className="flex items-center gap-2 text-neutral-300"><img src={imageSrc(step.image.path)} alt="" className="h-8 w-12 rounded object-cover" />{step.image.fileName}
                        <button type="button" className="text-neutral-400 hover:text-white" onClick={() => setStep(index, { image: null })}>Remove picture</button></span>
                        : <label className="cursor-pointer text-neutral-400 hover:text-white">{busy === "picture" ? "Uploading…" : "Add a picture (sends as MMS)"}
                            <input type="file" accept="image/jpeg,image/png,image/gif" className="sr-only" disabled={busy === "picture"} onChange={event => { void addPicture(index, event.target.files?.[0]); event.target.value = "" }} /></label>}
                </div>
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
                    <span className="tabular-nums">{info.length} characters · {info.segments} segment{info.segments > 1 ? "s" : ""}{step.image ? " · sent as MMS" : ""}</span>
                    {!info.gsm ? <span className="text-amber-300">Emoji or curly quotes allow only 70 characters per segment</span> : null}
                    {info.segments >= 3 ? <span className="text-amber-300">Long: each segment is billed</span> : null}
                </p>
                <div className="flex flex-col gap-1"><span className="text-xs text-neutral-500">{preview ? `${preview.name.split(" ")[0]} sees` : "They see"}</span><Bubble text={filled} image={Boolean(step.image)} imageSrc={step.image ? imageSrc(step.image.path) : null} /></div>
            </>
        }
        if (step.kind === "wait") {
            const modes: Partial<Record<typeof step.mode, string>> = { for: "For a set time", next: "Until 9:00 AM the next day", ...(flowHasAppointment(flow) || step.mode === "before" ? { before: "Until before the appointment" } : {}), ...(flow.trigger === "hold" || step.mode === "hold" ? { hold: "Until the hold runs out" } : {}) }
            body = <>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="w-60"><Selector appearance="input" ariaLabel="How to wait" value={step.mode} options={Object.entries(modes).map(([value, label]) => ({ value, label: label! }))}
                        onChange={mode => setStep(index, mode === "before" ? { mode: "before", amount: 24, unit: "hours" } : { mode: mode as typeof step.mode })} /></div>
                    {step.mode === "for" || step.mode === "before" ? <input type="number" min={1} aria-label={step.mode === "before" ? "Hours before" : "How long"} value={step.amount}
                        onChange={event => setStep(index, { amount: Math.max(1, Math.round(Number(event.target.value) || 1)) }, "typing")} onBlur={() => void flush()} className={`${inputClass} w-20 tabular-nums`} /> : null}
                    {step.mode === "for" ? <div className="w-32"><Selector appearance="input" ariaLabel="Unit" value={step.unit} options={["minutes", "hours", "days"].map(unit => ({ value: unit, label: unit }))} onChange={unit => setStep(index, { unit: unit as typeof step.unit })} /></div>
                        : step.mode === "before" ? <span className="text-sm text-neutral-500">hours before</span> : null}
                </div>
                <p className="text-xs leading-5 text-neutral-500">Texts due outside the sending hours below wait for the next opening.</p>
            </>
        }
        if (step.kind === "if") body = <>
            <div className="w-72 max-w-full"><Selector appearance="input" ariaLabel="Condition" value={step.condition} options={options(FLOW_CONDITIONS)} onChange={condition => setStep(index, { condition: condition as typeof step.condition })} /></div>
            <p className="text-xs leading-5 text-neutral-500">Checked when they reach this step. If it isn&apos;t true, the flow ends for them.</p>
        </>
        if (step.kind === "act") body = <div className="flex flex-wrap items-center gap-2">
            <div className="w-72 max-w-full"><Selector appearance="input" ariaLabel="Action" value={step.action} options={options(FLOW_ACTIONS)}
                onChange={action => setStep(index, { action: action as typeof step.action, value: action === "stage" ? "lost" : action === "assign" ? setters[0]?.id ?? null : null })} /></div>
            {step.action === "stage" ? <div className="w-48"><Selector appearance="input" ariaLabel="Stage" value={step.value ?? "lost"} onChange={value => setStep(index, { value })}
                options={CAMPAIGN_STAGES.filter(stage => stage !== "paid_not_booked" && stage !== "booked").map(stage => ({ value: stage, label: campaignStageLabels[stage] }))} /></div> : null}
            {step.action === "assign" ? <div className="w-48"><Selector appearance="input" ariaLabel="Setter" value={step.value ?? ""} placeholder="Choose a setter" onChange={value => setStep(index, { value })}
                options={setters.map(setter => ({ value: setter.id, label: setter.name }))} /></div> : null}
        </div>
        const move = (to: number) => { const steps = [...flow.steps]; const [item] = steps.splice(index, 1); steps.splice(to, 0, item); setSteps(steps); setSelected(to) }
        return <div className="flex flex-col gap-2.5 pb-2 pt-2.5">
            {body}
            <div className="flex flex-wrap gap-4 pt-0.5 text-xs">
                <button type="button" className="text-neutral-400 hover:text-white disabled:opacity-40" disabled={index === 0} onClick={() => move(index - 1)}>Move up</button>
                <button type="button" className="text-neutral-400 hover:text-white disabled:opacity-40" disabled={index === count - 1} onClick={() => move(index + 1)}>Move down</button>
                <button type="button" className="text-neutral-400 hover:text-white" onClick={() => { const copy = { ...step, id: defaultStep(step.kind).id } as FlowStep; const steps = [...flow.steps]; steps.splice(index + 1, 0, copy); setSteps(steps); setSelected(index + 1) }}>Duplicate</button>
                <button type="button" className="text-red-300 hover:text-red-200" onClick={() => { setSteps(flow.steps.filter((_, i) => i !== index)); setSelected(-1) }}>Delete step</button>
            </div>
        </div>
    }

    const insertRow = (at: number) => <div className="relative flex min-h-6 flex-wrap items-center gap-y-1.5 before:absolute before:bottom-0 before:left-[13.5px] before:top-0 before:w-px before:bg-[var(--color-card-border)]">
        <button type="button" data-icon-button aria-label="Add a step here" aria-expanded={inserting === at} onClick={() => setInserting(inserting === at ? null : at)}
            className={`relative z-[1] h-[18px] w-7 rounded-full bg-neutral-950 text-[13px] leading-none ${inserting === at ? "bg-white/[0.075] text-white" : "text-neutral-500 hover:bg-white/[0.075] hover:text-white"}`}>+</button>
        {inserting === at ? <div role="menu" className="relative z-[2] ml-3 flex flex-wrap gap-1.5 py-1">
            {(["text", "wait", "if", "act"] as const).map(kind => <Button key={kind} role="menuitem" size="sm" variant="secondary" onClick={() => {
                const steps = [...flow.steps]; steps.splice(at, 0, defaultStep(kind)); setSteps(steps); setSelected(at); setInserting(null)
            }}><svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={1.5}>{ICONS[kind]}</svg>{kind === "act" ? "Action" : TITLES[kind]}</Button>)}
        </div> : null}
    </div>

    const flowRow = (kind: FlowStep["kind"] | "start" | "end", content: ReactNode, line = true, selectedStep = false) => <div className={`relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 ${line ? "before:absolute before:bottom-0 before:left-[13.5px] before:top-7 before:w-px before:bg-[var(--color-card-border)]" : ""}`}>
        <StepIcon kind={kind} selected={selectedStep} />
        <div className="min-w-0">{content}</div>
    </div>

    return <div className="mt-5">
        {/* Status and actions, then the name: the header above shows the saved name. */}
        <section aria-label="Status" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" role="switch" aria-checked={flow.enabled} disabled={busy === "toggle"} onClick={toggle} className="inline-flex items-center gap-2 text-sm text-neutral-300 disabled:opacity-50">
                <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition-colors ${flow.enabled ? "bg-emerald-500" : "bg-white/[0.12]"}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full transition-transform ${flow.enabled ? "left-0.5 translate-x-3 bg-neutral-950" : "left-0.5 bg-neutral-400"}`} /></span>
                {flow.enabled ? "On" : "Off"}
            </button>
            <span className="order-last w-full text-sm text-neutral-400 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
                Starts when {triggerText(flow).replace(/^They /, "they ").replace(/^A lead/, "a lead").replace(" · ", " ")}. {flow.steps.filter(step => step.kind === "text").length} text{flow.steps.filter(step => step.kind === "text").length === 1 ? "" : "s"}{stops.length ? `. Stops if they ${stops.join(", ")}` : ""}.
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2 sm:ml-0">
                <span role="status" aria-live="polite" className={`text-xs ${save.kind === "error" ? "text-red-300" : "text-neutral-500"}`}>{save.kind === "saving" ? "Saving…" : save.kind === "saved" ? "Saved" : save.kind === "error" ? save.message : ""}</span>
                <Button size="sm" variant="secondary" onClick={() => setPreviewOpen(true)}>Preview</Button>
                <Button size="sm" variant="secondary" aria-expanded={testOpen} onClick={() => setTestOpen(!testOpen)}>Send me a test</Button>
            </span>
        </section>
        {notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={`mt-3 text-sm ${notice.tone === "error" ? "text-red-300" : "text-emerald-300"}`}>{notice.text}</p> : null}
        {testOpen ? <form className="mt-4 flex max-w-2xl flex-col gap-2 rounded-lg border border-card-border p-3" onSubmit={event => {
            event.preventDefault()
            void act("test", () => sendFlowTestAction(workspaceSlug, campaignId, initial.id, testPhone, preview?.id ?? null), result => { setTestOpen(false); setNotice({ tone: "ok", text: `${result.sent} test text${result.sent === 1 ? "" : "s"} sent to ${testPhone}.` }) })
        }}>
            <div className="flex flex-wrap items-center gap-2">
                <input className={`${inputClass} w-56`} inputMode="tel" autoComplete="tel" placeholder="Your mobile number" aria-label="Your mobile number" value={testPhone} onChange={event => setTestPhone(event.target.value)} />
                <Button size="sm" type="submit" disabled={busy === "test" || !testPhone.trim()}>{busy === "test" ? "Sending…" : "Send test texts"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setTestOpen(false)}>Cancel</Button>
            </div>
            <p className="text-xs leading-5 text-neutral-500">Sends every text in this flow to you now, filled in as {preview?.name ?? "a lead"}, without the waits. Test texts don&apos;t count toward the flow&apos;s numbers.</p>
        </form> : null}
        {warnings.length ? <div role="status" className="mt-4 max-w-4xl rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3">
            <p className="text-sm font-medium text-neutral-100">{warnings.length === 1 ? "One thing to fix" : `${warnings.length} things to fix`}</p>
            <ul className="mt-1.5 list-disc pl-5 text-sm leading-6 text-neutral-300">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        </div> : null}

        <div className="mt-4">
            <Row label="Name" hint="What your team calls this flow. Leads never see it.">
                <input className={`${inputClass} w-full max-w-md`} aria-label="Flow name" maxLength={120} value={flow.name} onChange={event => update({ name: event.target.value }, "typing")} onBlur={() => void flush().then(() => router.refresh())} />
            </Row>
            <Row label="Starts when" hint="The moment a lead enters this flow. Each lead is only in a flow once at a time.">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="w-72 max-w-full"><Selector appearance="input" ariaLabel="Starts when" value={flow.trigger} options={options(FLOW_TRIGGERS)} onChange={trigger => update({ trigger: trigger as FlowTrigger, triggerStage: trigger === "stage" ? flow.triggerStage ?? "not_booked" : null })} /></div>
                    {flow.trigger === "stage" ? <div className="w-48"><Selector appearance="input" ariaLabel="Stage" value={flow.triggerStage ?? "not_booked"} onChange={stage => update({ triggerStage: stage as CampaignStage })}
                        options={CAMPAIGN_STAGES.map(stage => ({ value: stage, label: campaignStageLabels[stage] }))} /></div> : null}
                </div>
                <div role="group" aria-label="Sources" className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-neutral-500">For</span>
                    <button type="button" aria-pressed={flow.sourceIds === null} onClick={() => update({ sourceIds: null })}
                        className={`h-7 rounded-lg border px-2 text-xs ${flow.sourceIds === null ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white" : "border-card-border text-neutral-400 hover:text-white"}`}>All sources</button>
                    {sources.map(source => {
                        const on = flow.sourceIds !== null && flow.sourceIds.includes(source.id)
                        const disabled = flow.trigger === "hold" && !source.pays
                        return <button key={source.id} type="button" aria-pressed={on} disabled={disabled} title={disabled ? "Takes no payment" : source.name}
                            onClick={() => { const list = flow.sourceIds === null ? [] : flow.sourceIds; const next = on ? list.filter(id => id !== source.id) : [...list, source.id]; update({ sourceIds: next.length === sources.length || !next.length ? null : next }) }}
                            className={`flex h-7 items-center rounded-lg border px-1.5 disabled:opacity-40 ${on ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15" : "border-card-border"}`}>
                            <RoundPill tone={source.tone as CampaignTagTone}>{source.tag}</RoundPill>
                        </button>
                    })}
                </div>
            </Row>

            <section aria-label="Steps" className="border-t border-card-border py-5">
                <SectionHeading className="mb-3" action={pool.length ? <span className="flex items-center gap-2"><span className="text-xs text-neutral-500">Fill in as</span>
                    <div className="w-48"><Selector appearance="input" ariaLabel="Fill in as" value={preview?.id ?? ""} onChange={setPreviewId} options={pool.map(item => ({ value: item.id, label: item.name }))} /></div></span> : null}>
                    Steps <span className="ml-2 font-normal text-neutral-600">Click a step to edit it. Use + to add one.</span>
                </SectionHeading>
                <div className="flex max-w-3xl flex-col">
                    {flowRow("start", <div className="flex min-h-7 flex-col justify-center"><b className="text-sm font-medium text-neutral-100">Starts</b><span className="truncate text-sm text-neutral-400">when {triggerText(flow).replace(/^They /, "they ").replace(/^A lead/, "a lead").replace(" · ", " ")}</span></div>)}
                    {insertRow(0)}
                    {flow.steps.map((step, index) => <div key={step.id}>
                        {flowRow(step.kind, <>
                            <button type="button" aria-expanded={selected === index} onClick={() => { setSelected(selected === index ? -1 : index); setInserting(null) }}
                                className="-mx-2 -mt-0.5 flex w-[calc(100%+1rem)] min-h-7 flex-col items-start rounded-md px-2 py-1 text-left hover:bg-[var(--color-surface-hover)]">
                                <b className="text-sm font-medium text-neutral-100">{TITLES[step.kind]}</b>
                                <span className="max-w-full truncate text-sm text-neutral-400">{step.kind === "act" ? actionText(step, setterName) : step.kind === "wait" ? waitText(step) : stepSummary(step, setterName)}</span>
                            </button>
                            {selected === index ? stepEditor(step, index) : null}
                        </>, true, selected === index)}
                        {insertRow(index + 1)}
                    </div>)}
                    {flowRow("end", <div className="flex min-h-7 flex-col justify-center"><b className="text-sm font-medium text-neutral-100">End</b><span className="text-sm text-neutral-400">The lead leaves this flow</span></div>, false)}
                </div>
            </section>

            <Row label="Replies" hint="What a reply does. Every reply also shows in Comms.">
                <div className="flex flex-col gap-2 text-sm">
                    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 text-neutral-500 sm:grid-cols-[5rem_minmax(0,16rem)_1rem_minmax(0,1fr)]"><code className="font-mono text-xs">STOP</code><span className="max-sm:hidden">and END, CANCEL, UNSUBSCRIBE, QUIT</span><span className="max-sm:hidden">→</span><span className="max-sm:col-start-2">Opt out of every text. Required by carriers</span></div>
                    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 text-neutral-500 sm:grid-cols-[5rem_minmax(0,16rem)_1rem_minmax(0,1fr)]"><code className="font-mono text-xs">HELP</code><span className="max-sm:hidden" /><span className="max-sm:hidden">→</span><span className="max-sm:col-start-2">SignalHouse replies with who you are and how to opt out</span></div>
                    {flow.replies.map((reply, index) => <div key={index} className="flex flex-wrap items-center gap-2 text-neutral-300">
                        <input className={`${inputClass} w-20 font-mono uppercase`} aria-label="Reply word" maxLength={20} value={reply.word}
                            onChange={event => { const word = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); update({ replies: flow.replies.map((item, i) => i === index ? { ...item, word } : item) }, "typing") }} onBlur={() => void flush()} />
                        <span className="text-neutral-500">exactly →</span>
                        <div className="w-64 max-w-full"><Selector appearance="input" ariaLabel="What it does" value={reply.action} options={options(FLOW_REPLY_ACTIONS)} onChange={action => update({ replies: flow.replies.map((item, i) => i === index ? { ...item, action: action as FlowReply["action"] } : item) })} /></div>
                        <button type="button" data-icon-button aria-label={`Remove ${reply.word || "reply word"}`} className="px-1 text-neutral-500 hover:text-white" onClick={() => update({ replies: flow.replies.filter((_, i) => i !== index) })}>✕</button>
                        {RESERVED_WORDS.has(reply.word) ? <span className="text-xs text-amber-300">{reply.word} is a carrier word; pick another</span> : null}
                    </div>)}
                    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 text-neutral-400 sm:grid-cols-[5rem_minmax(0,16rem)_1rem_minmax(0,1fr)]"><span className="text-neutral-500 sm:col-span-2">Any other reply</span><span className="max-sm:hidden">→</span><span className="max-sm:col-span-2">{flow.stopOnReply ? "Stops this flow. Answer it in Comms" : "Shows in Comms. The flow carries on"}</span></div>
                    <div><Button size="sm" variant="secondary" onClick={() => update({ replies: [...flow.replies, { word: ["YES", "Y", "OK"].find(word => !flow.replies.some(reply => reply.word === word)) ?? "", action: "task" }] })}>Add a reply word</Button></div>
                </div>
            </Row>

            <Row label="Stops when" hint="A stopped lead gets no more texts from this flow.">
                <div className="flex flex-col gap-2">
                    {FLOW_STOPS.map(([key, label, locked]) => <label key={key} className={`flex items-center gap-2 text-sm ${locked ? "text-neutral-500" : "text-neutral-300"}`}>
                        <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" disabled={locked} checked={locked || (key === "reply" ? flow.stopOnReply : key === "book" ? flow.stopOnBook : flow.stopOnPay)}
                            onChange={event => update(key === "reply" ? { stopOnReply: event.target.checked } : key === "book" ? { stopOnBook: event.target.checked } : { stopOnPay: event.target.checked })} />
                        {label}{locked ? <span className="text-neutral-600">· always</span> : null}
                    </label>)}
                </div>
            </Row>

            <Row label="Sending" hint="Times follow the lead's own time zone, from their phone number's area code.">
                <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
                    <span>Between</span>
                    <div className="w-32"><Selector appearance="input" ariaLabel="From" value={String(flow.windowStart)} options={FLOW_WINDOW_STARTS.map(minute => ({ value: String(minute), label: minuteText(minute) }))} onChange={value => update({ windowStart: Number(value) })} /></div>
                    <span>and</span>
                    <div className="w-32"><Selector appearance="input" ariaLabel="To" value={String(flow.windowEnd)} options={FLOW_WINDOW_ENDS.map(minute => ({ value: String(minute), label: minuteText(minute) }))} onChange={value => update({ windowEnd: Number(value) })} /></div>
                    <div className="w-48"><Selector appearance="input" ariaLabel="Days" value={flow.windowDays} options={options(FLOW_WINDOW_DAYS)} onChange={value => update({ windowDays: value as FlowWindowDays })} /></div>
                </div>
                <p className="text-xs leading-5 text-neutral-500">From {numberName ?? "the campaign's number"} through SignalHouse{sources.length ? ", or the source's own number where it has one" : ""}. Each lead keeps the number that first texted them. Delivery is checked on every text; a failed one shows in their conversation.</p>
            </Row>

            <section aria-label="In this flow now" className="border-t border-card-border py-5">
                <SectionHeading count={inFlow.length}>In this flow now</SectionHeading>
                {inFlow.length ? <ul className="mt-1 max-w-4xl">{inFlow.map(run => {
                    const lead = leadName(run.leadId)
                    const source = sources.find(item => item.id === lead?.sourceId)
                    return <li key={run.runId} className="flex min-h-9 items-center gap-3 border-t border-card-border py-1.5 first:border-t-0">
                        <Link href={`${base}/leads/${run.leadId}`} className="min-w-0 flex-1 truncate text-sm text-neutral-100 hover:underline">{lead?.name ?? "Lead"} <span className="text-neutral-500">{lead?.company ?? ""}</span></Link>
                        {source ? <RoundPill tone={source.tone as CampaignTagTone}>{source.tag}</RoundPill> : null}
                        <span className="shrink-0 text-xs tabular-nums text-neutral-500 max-sm:hidden">Step {Math.min(run.stepIndex + 1, Math.max(1, flow.steps.length))} of {flow.steps.length}</span>
                        <button type="button" className="shrink-0 text-xs text-neutral-400 hover:text-white disabled:opacity-40" disabled={busy === run.runId}
                            onClick={() => void act(run.runId, () => removeFromFlowAction(workspaceSlug, campaignId, run.runId), () => { setNotice({ tone: "ok", text: `${lead?.name.split(" ")[0] ?? "They"} taken out of this flow.` }); router.refresh() })}>Take out</button>
                    </li>
                })}</ul> : <p className="mt-1 text-sm text-neutral-500">Nobody right now.</p>}
            </section>

            <section aria-label="Copy" className="border-t border-card-border py-5">
                <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" variant="secondary" disabled={busy === "dup"} onClick={() => void act("dup", () => duplicateFlowAction(workspaceSlug, campaignId, initial.id), result => router.push(`${base}/flows/${result.id}`))}>{busy === "dup" ? "Copying…" : "Duplicate flow"}</Button>
                    <span className="text-xs text-neutral-500">The copy starts switched off.</span>
                </div>
            </section>
        </div>

        <DetailDangerZone>
            <DetailDangerAction title="Delete flow" description="Leads in it stop getting its texts. Texts already sent stay in their conversations."
                control={deleting ? <span className="flex items-center gap-2">
                    <DetailDangerButton tone="delete" disabled={busy === "delete"} onClick={() => void act("delete", () => deleteFlowAction(workspaceSlug, campaignId, initial.id), () => router.push(`${base}?tab=flows`))}>{busy === "delete" ? "Deleting…" : `Delete “${flow.name}”`}</DetailDangerButton>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>Keep it</Button>
                </span> : <DetailDangerButton tone="delete" onClick={() => setDeleting(true)}>Delete flow</DetailDangerButton>} />
        </DetailDangerZone>

        {previewOpen ? <CenteredDialog title="Preview" onClose={() => setPreviewOpen(false)}>
            <div className="flex flex-col gap-3">
                {pool.length ? <div className="w-56"><Selector appearance="input" ariaLabel="Fill in as" value={preview?.id ?? ""} onChange={setPreviewId} options={pool.map(item => ({ value: item.id, label: item.name }))} /></div> : null}
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-2xl border border-card-border p-3">
                    <span className="self-center rounded-full bg-white/[0.045] px-2.5 py-1 text-[11px] text-neutral-500">Right away</span>
                    {flow.steps.map(step => step.kind === "wait"
                        ? <span key={step.id} className="self-center rounded-full bg-white/[0.045] px-2.5 py-1 text-[11px] text-neutral-500">{step.mode === "for" ? `${waitText(step)} later` : waitText(step).replace(/^until /, "").replace(/^./, char => char.toUpperCase())}</span>
                        : step.kind === "if" ? <span key={step.id} className="self-center text-center text-[11px] text-neutral-500">Only if {FLOW_CONDITIONS[step.condition].toLowerCase()}</span>
                            : step.kind === "act" ? <span key={step.id} className="self-center text-center text-[11px] text-neutral-500">{actionText(step, setterName)}</span>
                                : <div key={step.id} className="flex flex-col items-end gap-1"><Bubble text={fill(step.body)} image={Boolean(step.image)} imageSrc={step.image ? imageSrc(step.image.path) : null} /><small className="px-1 text-[11px] text-neutral-500">{smsSegments(fill(step.body)).segments} segment{smsSegments(fill(step.body)).segments > 1 ? "s" : ""}</small></div>)}
                </div>
                <p className="text-xs leading-5 text-neutral-500">As {preview?.name ?? "a lead"} would get it, with fields filled in. Sending hours still apply.</p>
            </div>
        </CenteredDialog> : null}
    </div>
}
