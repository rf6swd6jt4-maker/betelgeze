type Props = {
    domain: string | null
    saveAction: (formData: FormData) => Promise<void>
    canManage: boolean
}

export function WorkspaceOnboardingDomain({ domain, saveAction, canManage }: Props) {
    return (
        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="text-lg font-semibold">Custom onboarding domain</h2>
            <p className="mt-1 text-sm text-neutral-400">Give clients a direct onboarding link on your own domain.</p>
            {domain ? (
                <p className="mt-4 rounded-lg border border-emerald-900/70 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
                    New links use <span className="font-medium">https://{domain}/[token]</span>.
                </p>
            ) : (
                <p className="mt-4 text-sm text-neutral-500">New links currently use the Betelgeze onboarding URL.</p>
            )}
            {canManage ? (
                <form action={saveAction} className="mt-5 space-y-3">
                    <label className="block text-sm text-neutral-300">Domain<input name="domain" type="text" defaultValue={domain ?? ""} placeholder="onboarding.example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
                    <p className="text-xs leading-5 text-neutral-500">Enter only the hostname, without <code>https://</code> or a path. Before saving, add this exact domain to the Betelgeze Vercel project and point its DNS to Vercel. Leave the field blank to return to the Betelgeze URL.</p>
                    <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Save onboarding domain</button>
                </form>
            ) : <p className="mt-5 text-sm text-neutral-500">Only the workspace owner can change this domain.</p>}
        </section>
    )
}
