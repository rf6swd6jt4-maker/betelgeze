"use client"
import { useCallback, useSyncExternalStore } from "react"
const change = "betelgeze:sop-draft"
const subscribe = (notify: () => void) => { window.addEventListener(change, notify); return () => window.removeEventListener(change, notify) }
export function useSopDraft(key: string) {
    const stored = useSyncExternalStore(subscribe, () => { try { return sessionStorage.getItem(key) } catch { return null } }, () => null)
    const write = useCallback((value: unknown) => { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new Event(change)) }, [key])
    return { stored, write }
}
export function sopTabKey() { return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("__betelgeze_tab") ?? "standalone" }
export async function sopCommand(url: string, body?: object, method = "POST") {
    const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000), cache: "no-store" })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result) throw new Error(result?.error ?? "The request was not confirmed. Check your connection and retry.")
    return result
}
export const sopInputClass = "w-full rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-neutral-500 disabled:opacity-50"
export const sopButtonClass = "inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
