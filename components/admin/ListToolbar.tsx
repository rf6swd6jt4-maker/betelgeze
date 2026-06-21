"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Avatar } from "@/components/account/Avatar"

type Option = { value: string; label: string; avatarSrc?: string | null }

export function ListToolbar({
    sortOptions,
    filterGroups,
}: {
    sortOptions: Option[]
    filterGroups: Array<{ label: string; options: Option[] }>
}) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const sort = searchParams.get("sort") ?? sortOptions[0]?.value ?? ""
    const filter = searchParams.get("filter") ?? "all"

    function setOption(key: "sort" | "filter", value: string) {
        const next = new URLSearchParams(searchParams.toString())
        if (!value || (key === "filter" && value === "all")) next.delete(key)
        else next.set(key, value)
        router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`)
    }

    return <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/70 p-3"><label className="flex min-h-10 items-center gap-2 text-sm text-neutral-400">Sort <select value={sort} onChange={(event) => setOption("sort", event.target.value)} className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-white">{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><details className="relative"><summary className="flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500">Filter by{filter !== "all" && <span className="ml-2 h-2 w-2 rounded-full bg-amber-300" />}</summary><div className="absolute left-0 z-20 mt-2 w-[min(20rem,calc(100vw-3rem))] rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-2xl"><button type="button" onClick={() => setOption("filter", "all")} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${filter === "all" ? "bg-white text-black" : "text-neutral-200 hover:bg-neutral-800"}`}>All entries</button>{filterGroups.map((group) => <div key={group.label} className="mt-3 border-t border-neutral-800 pt-3"><p className="px-2 text-xs font-medium uppercase tracking-wide text-neutral-500">{group.label}</p>{group.options.map((option) => <button key={option.value} type="button" onClick={() => setOption("filter", option.value)} className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${filter === option.value ? "bg-white text-black" : "text-neutral-200 hover:bg-neutral-800"}`}>{option.avatarSrc !== undefined && <Avatar src={option.avatarSrc} name={option.label} className="h-6 w-6 shrink-0" />}{option.label}</button>)}</div>)}</div></details>{filter !== "all" && <button type="button" onClick={() => setOption("filter", "all")} className="min-h-10 px-2 text-sm text-neutral-400 underline underline-offset-4 hover:text-white">Clear</button>}</div>
}
