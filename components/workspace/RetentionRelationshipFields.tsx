"use client"

import { useEffect, useState } from "react"
import { List, ListItem } from "@/components/list/List"
import { APPOINTMENT_FIELD_OPTIONS, APPOINTMENT_MEDIUM_OPTIONS, type AppointmentSettingConfiguration } from "@/lib/appointment-setting"

type Person = { id: string; name: string }
type Service = { id: string; revisionId: string; name: string; appointmentSetting: boolean; people: Person[] }
type Choices = { managers: Person[]; services: Service[] }
type Selection = { service_id: string; revision_id: string; assignee_user_id: string; appointment_configuration?: AppointmentSettingConfiguration }
const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white"

export function RetentionRelationshipFields({ workspaceSlug, currentUserId, onReady }: { workspaceSlug: string; currentUserId: string; onReady: (ready: boolean) => void }) {
    const [choices, setChoices] = useState<Choices | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [attempt, setAttempt] = useState(0)
    const [manager, setManager] = useState("")
    const [selected, setSelected] = useState<Selection[]>([])
    useEffect(() => {
        const controller = new AbortController()
        void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/retention-create-options`, { signal: controller.signal })
            .then(async (response) => {
                const data = await response.json()
                if (!response.ok) throw new Error(data.error ?? "Could not load services.")
                if (controller.signal.aborted) return
                setChoices(data)
                setManager((current) => current || (data.managers.some((person: Person) => person.id === currentUserId) ? currentUserId : ""))
                setError(null)
            }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load services.") })
        return () => controller.abort()
    }, [workspaceSlug, currentUserId, attempt])
    const ready = Boolean(choices && !error && manager && selected.length && selected.every((service) => service.assignee_user_id && (!service.appointment_configuration || service.appointment_configuration.mediums.length)))
    useEffect(() => { onReady(ready); return () => onReady(false) }, [ready, onReady])
    function updateService(id: string, update: Partial<Selection>) {
        setSelected((current) => current.map((service) => service.service_id === id ? { ...service, ...update } : service))
    }
    function configure(service: Selection, update: Partial<AppointmentSettingConfiguration>) {
        updateService(service.service_id, { appointment_configuration: { ...service.appointment_configuration!, ...update } })
    }
    return <section className="space-y-3 border-t border-neutral-800 pt-4" aria-label="Retention services and team">
        <input type="hidden" name="retention_services" value={JSON.stringify(selected)} />
        {!choices && !error ? <p role="status" className="text-sm text-neutral-400">Loading services and team…</p> : null}
        {error ? <p role="alert" className="text-sm text-red-300">{error} <button type="button" onClick={() => { setError(null); setAttempt((value) => value + 1) }} className="underline">Retry</button></p> : null}
        {choices ? <>
            <label className="block text-sm text-neutral-300">Client manager<select name="fulfilment_manager_user_id" value={manager} required onChange={(event) => setManager(event.target.value)} className={inputClass}><option value="">Choose manager</option>{choices.managers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            {!choices.managers.length ? <p className="text-xs text-amber-300">Enable a manager in Settings → Teams first.</p> : null}
            <fieldset><legend className="mb-2 text-sm text-neutral-300">Services</legend>
                <List ariaLabel="Available retention services">{choices.services.map((service) => {
                    const selection = selected.find((item) => item.service_id === service.id)
                    const config = selection?.appointment_configuration
                    return <ListItem key={service.id}><div className="space-y-3 px-3 py-3">
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(selection)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, { service_id: service.id, revision_id: service.revisionId, assignee_user_id: "", ...(service.appointmentSetting ? { appointment_configuration: { mediums: [], fields: [] } } : {}) }] : current.filter((item) => item.service_id !== service.id))} />{service.name}</label>
                        {selection ? <>
                            <label className="block text-sm text-neutral-300">Delivery person for {service.name}<select required value={selection.assignee_user_id} onChange={(event) => updateService(service.id, { assignee_user_id: event.target.value })} className={inputClass}><option value="">Choose delivery person</option>{service.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                            {!service.people.length ? <p className="text-xs text-amber-300">Choose eligible people for this service in Settings → Services first.</p> : null}
                            {config ? <div className="space-y-3">
                                <fieldset><legend className="text-sm text-neutral-300">How can appointments take place?</legend><div className="mt-2 flex flex-wrap gap-3">{APPOINTMENT_MEDIUM_OPTIONS.map((medium) => <label key={medium.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.mediums.includes(medium.key)} onChange={(event) => configure(selection, { mediums: event.target.checked ? [...config.mediums, medium.key] : config.mediums.filter((key) => key !== medium.key) })} />{medium.label}</label>)}</div></fieldset>
                                <fieldset><legend className="text-sm text-neutral-300">Information the setter should collect</legend><p className="mt-1 text-xs text-neutral-500">Name, date and time are always required. Choose up to four extra fields. Selected information is visible to the client.</p>
                                    <div className="mt-2 space-y-2">{APPOINTMENT_FIELD_OPTIONS.map((field) => {
                                        const selectedField = config.fields.find((item) => item.key === field.key)
                                        return <div key={field.key} className="flex flex-wrap items-center justify-between gap-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(selectedField)} disabled={!selectedField && config.fields.length >= 4} onChange={(event) => configure(selection, { fields: event.target.checked ? [...config.fields, { key: field.key, required: true }] : config.fields.filter((item) => item.key !== field.key) })} />{field.label}</label>{selectedField ? <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={selectedField.required} onChange={(event) => configure(selection, { fields: config.fields.map((item) => item.key === field.key ? { ...item, required: event.target.checked } : item) })} />Required</label> : null}</div>
                                    })}</div>
                                </fieldset>
                            </div> : null}
                        </> : null}
                    </div></ListItem>
                })}</List>
            </fieldset>
            {!choices.services.length ? <p className="text-xs text-amber-300">Publish an active service in Settings → Services first.</p> : null}
            <p className="text-xs text-neutral-500">Choose at least one service and a delivery person for each. The manager and delivery people join the internal client team.</p>
        </> : null}
    </section>
}
