import type { AdminWorkItem } from "@/lib/admin/work-items"

/** The queue ranks using unbounded attention; views use the finite ranked result. */
export type AdminWorkItemDisplay = Omit<AdminWorkItem, "contributions"> & {
    contributions: Array<Omit<AdminWorkItem["contributions"][number], "attention">>
}

export function adminWorkItemDisplay(item: AdminWorkItem): AdminWorkItemDisplay {
    return { ...item, contributions: item.contributions.map(({ attention, ...contribution }) => {
        // Expired OKRs intentionally yield Infinity. It is internal ranking state,
        // not a display value and would become null across a JSON transport.
        void attention
        return contribution
    }) }
}
