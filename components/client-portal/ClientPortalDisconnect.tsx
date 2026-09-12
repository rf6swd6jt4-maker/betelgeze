"use client"

export function ClientPortalDisconnect({ confirmation, pending, disabled, onDisconnect }: { confirmation: string; pending: boolean; disabled?: boolean; onDisconnect: () => void }) {
    return <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50" disabled={disabled || pending} onClick={() => { if (window.confirm(confirmation)) onDisconnect() }}>{pending ? "Disconnecting…" : "Disconnect"}</button>
}
