"use client"
import { PersonalWorkQueue } from "@/components/work-queue/PersonalWorkQueue"
import type { PersonalQueueSnapshot } from "@/lib/work-queue/server"
import { TodaySide } from "./TodaySide"
import { useTodayLayout } from "./TodayLayout"

/**
 * The queue destination. In the Today layout it is the Today page: the same full queue, titled Today, with what needs
 * attention and the team's queue beside it for owners and admins (below it when the work area is narrow).
 */
export default function NativeQueuePanel({ data }: { data: PersonalQueueSnapshot }) {
    const today = useTodayLayout()
    if (!today) return <div className="mx-auto max-w-7xl px-4 pb-7 text-white sm:px-6"><PersonalWorkQueue data={data} /></div>
    return <div data-today-page className="@container mx-auto max-w-7xl px-4 pb-7 text-white sm:px-6">
        <div className={data.canSeeAttention ? "grid gap-x-8 gap-y-6 @4xl:grid-cols-[minmax(0,1fr)_21rem]" : undefined}>
            <div className="min-w-0"><PersonalWorkQueue data={data} title="Today" /></div>
            {data.canSeeAttention ? <div className="min-w-0 @4xl:pt-6"><TodaySide workspaceSlug={data.workspaceSlug} userId={data.userId} onOpen={today.open} /></div> : null}
        </div>
    </div>
}
