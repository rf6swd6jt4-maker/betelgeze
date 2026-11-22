export function WorkspaceBannerPending() {
    return <div aria-label="Loading workspace banner" aria-busy="true" className="relative mb-12 h-[115px] motion-safe:animate-pulse rounded-xl border border-card-border sm:h-48 sm:rounded-2xl">
        <div className="absolute bottom-0 left-4 h-[72px] w-[72px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 sm:left-7" />
    </div>
}
