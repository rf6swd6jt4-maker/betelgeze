import React, { useState } from "react"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { ActivityTrendsLoading } from "@/components/panel/PanelLoading"

// Heavy destination modules are replaced, preserving the real native owner.
export default function Content() {
    const [count, setCount] = useState(0)
    const [deferred, setDeferred] = useState(true)
    return <main data-fixture-content data-workspace-loading-root className="px-4 text-white sm:px-6"><div className="mx-auto max-w-7xl">
        <PanelTabHeader title="Synthetic loaded panel" description="Already visible content remains usable while its read refreshes." />
        <button data-fixture-counter onClick={() => setCount(count + 1)}>Local edits: {count}</button>
        <button data-fixture-section onClick={() => setDeferred(false)}>Reveal deferred section</button>
        {deferred ? <ActivityTrendsLoading /> : <section data-fixture-resolved>Deferred section ready</section>}
    </div></main>
}
