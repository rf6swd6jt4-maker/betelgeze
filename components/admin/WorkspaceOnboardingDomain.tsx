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
    canManage: boolean
}

export function WorkspaceOnboardingDomain({ domain, status, records, error, saveAction, verifyAction, canManage }: Props) {
    return <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold">Custom onboarding domain</h2>
        <p className="mt-1 text-sm text-neutral-400">Give clients a direct onboarding link on your own domain.</p>
        {status === "verified" && domain ? <p className="mt-4 rounded-lg border border-emerald-900/70 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">Your links now use <span className="font-medium">https://{domain}/[token]</span>.</p> : domain ? <div className="mt-4 rounded-lg border border-amber-900/70 bg-amber-950/30 px-3 py-3 text-sm text-amber-100">
            <p className="font-medium">Step 2 of 2: connect DNS</p>
            <p className="mt-1 text-amber-200/80">Betelgeze has prepared this hostname. Links will continue using Betelgeze until DNS passes verification.</p>
            {records.length > 0 ? <div className="mt-3 overflow-x-auto rounded border border-amber-900/70"><table className="min-w-full text-left text-xs"><thead className="bg-amber-950/40 text-amber-200"><tr><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Value</th></tr></thead><tbody>{records.map((record) => <tr key={`${record.type}-${record.name}-${record.value}`} className="border-t border-amber-900/50"><td className="px-2 py-1.5 font-mono">{record.type}</td><td className="px-2 py-1.5 font-mono">{record.name}</td><td className="px-2 py-1.5 font-mono break-all">{record.value}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-xs text-amber-200/80">Vercel has not returned DNS records yet. Save the domain again to refresh the setup instructions.</p>}
            {error && <p className="mt-3 rounded border border-red-500/40 bg-red-950/40 px-2 py-2 text-xs text-red-200">{error}</p>}
            {canManage && <form action={verifyAction} className="mt-3"><button className="rounded-lg border border-amber-500/50 px-3 py-2 text-sm font-medium text-amber-100">Connect domain</button></form>}
        </div> : <p className="mt-4 text-sm text-neutral-500">New links currently use the Betelgeze onboarding URL.</p>}
        {canManage ? <form action={saveAction} className="mt-5 space-y-3"><label className="block text-sm text-neutral-300">Domain<input name="domain" type="text" defaultValue={domain ?? ""} placeholder="onboarding.example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label><p className="text-xs leading-5 text-neutral-500">Enter only the hostname, without <code>https://</code> or a path. Betelgeze will show the DNS records the business needs to add at its own DNS provider. Leave blank to disconnect it.</p><button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Get DNS setup instructions</button></form> : <p className="mt-5 text-sm text-neutral-500">Only the workspace owner can change this domain.</p>}
    </section>
}
