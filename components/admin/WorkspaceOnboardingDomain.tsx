"use client"

import { useState } from "react"

type DnsRecord = {
    type: "A" | "CNAME" | "TXT"
    name: string
    value: string
}

type Props = {
    domain: string | null
    status: "none" | "pending_dns" | "verified"
    records: DnsRecord[]
    error: string | null
    saveAction: (formData: FormData) => Promise<void>
    verifyAction: () => Promise<void>
    cancelAction: () => Promise<void>
    canManage: boolean
}

function DomainSetupForm({ domain, action, onCancel }: { domain: string | null; action: (formData: FormData) => Promise<void>; onCancel: () => void }) {
    return <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 sm:p-5">
        <p className="font-medium">Step 1 of 2: choose a domain</p>
        <p className="mt-1 text-sm text-neutral-400">Use a subdomain you control, such as onboarding.example.com.</p>
        <form action={action} className="mt-4 space-y-3">
            <label className="block text-sm text-neutral-300">Domain<input name="domain" type="text" defaultValue={domain ?? ""} placeholder="onboarding.example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label>
            <p className="text-xs leading-5 text-neutral-500">Enter only the hostname, without <code>https://</code> or a path. We will provide the DNS records to add at the domain provider.</p>
            <div className="flex flex-wrap gap-2"><button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Continue to DNS setup</button><button type="button" onClick={onCancel} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300">Cancel</button></div>
        </form>
    </div>
}

export function WorkspaceOnboardingDomain({ domain, status, records, error, saveAction, verifyAction, cancelAction, canManage }: Props) {
    const [setupOpen, setSetupOpen] = useState(false)
    const pending = Boolean(domain && status === "pending_dns")
    const verified = Boolean(domain && status === "verified")

    return <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold">Custom onboarding domain</h2>
        <p className="mt-1 text-sm text-neutral-400">Give clients a direct onboarding link on your own domain.</p>

        {!domain && <><p className="mt-4 text-sm text-neutral-500">New links currently use the Betelgeze onboarding URL. No custom domain is connected yet.</p>{canManage && !setupOpen && <button type="button" onClick={() => setSetupOpen(true)} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Connect custom domain</button>}{canManage && setupOpen && <DomainSetupForm domain={null} action={saveAction} onCancel={() => setSetupOpen(false)} />}</>}

        {pending && <div className="mt-4 rounded-lg border border-amber-900/70 bg-amber-950/30 px-3 py-3 text-sm text-amber-100">
            <p className="font-medium">Step 2 of 2: connect DNS</p>
            <p className="mt-1 text-amber-200/80">Add these records at your DNS provider, then connect the domain. New links will keep using Betelgeze until verification succeeds.</p>
            {records.length > 0 ? <div className="mt-3 overflow-x-auto rounded border border-amber-900/70"><table className="min-w-full text-left text-xs"><thead className="bg-amber-950/40 text-amber-200"><tr><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Value</th></tr></thead><tbody>{records.map((record) => <tr key={`${record.type}-${record.name}-${record.value}`} className="border-t border-amber-900/50"><td className="px-2 py-1.5 font-mono">{record.type}</td><td className="px-2 py-1.5 font-mono">{record.name}</td><td className="px-2 py-1.5 font-mono break-all">{record.value}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-xs text-amber-200/80">No DNS records were returned yet. Choose the domain again to refresh the setup instructions.</p>}
            {error && <p className="mt-3 rounded border border-red-500/40 bg-red-950/40 px-2 py-2 text-xs text-red-200">{error}</p>}
            {canManage && <div className="mt-4 flex flex-wrap gap-2"><form action={verifyAction}><button className="rounded-lg border border-amber-500/50 px-3 py-2 text-sm font-medium text-amber-100">Connect domain</button></form><form action={cancelAction}><button className="rounded-lg border border-amber-900/70 px-3 py-2 text-sm text-amber-200">Cancel setup</button></form></div>}
        </div>}

        {verified && <div className="mt-4 rounded-lg border border-emerald-900/70 bg-emerald-950/30 px-3 py-3 text-sm text-emerald-200"><p className="font-medium">Custom domain connected</p><p className="mt-1">New links use <span className="font-medium">https://{domain}/[token]</span>.</p>{canManage && <form action={cancelAction} className="mt-3"><button className="rounded-lg border border-emerald-800 px-3 py-2 text-sm text-emerald-100">Disconnect domain</button></form>}</div>}

        {!canManage && <p className="mt-5 text-sm text-neutral-500">Only the workspace owner can change this domain.</p>}
    </section>
}
