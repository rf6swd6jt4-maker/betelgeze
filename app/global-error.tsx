"use client"

import { ErrorBoundaryReporter } from "@/components/errors/ErrorBoundaryReporter"

export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
    const code = `BGE-${error.digest ?? "UNEXPECTED"}`
    return <html lang="en"><body style={{ margin: 0, background: "#0a0a0a", color: "#fff", fontFamily: "Arial, sans-serif" }}><ErrorBoundaryReporter error={error} boundary="global" /><main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}><section style={{ width: "min(100%, 560px)", border: "1px solid #262626", borderRadius: 16, background: "#171717", padding: 32 }}><p style={{ color: "#a7f3d0", letterSpacing: ".18em", fontSize: 12 }}>BETELGEZE</p><h1>We couldn’t open this page</h1><p style={{ color: "#d4d4d4", lineHeight: 1.6 }}>Check your connection and try again. If the issue persists, report the code below to Betelgeze support.</p><button type="button" onClick={unstable_retry} style={{ display: "block", marginTop: 24, border: 0, borderRadius: 8, padding: "12px 16px", background: "#fff", color: "#000", fontSize: 14 }}>Try again</button><code style={{ display: "inline-block", marginTop: 12, padding: "8px 12px", background: "#0a0a0a", borderRadius: 8, color: "#a7f3d0" }}>{code}</code></section></main></body></html>
}
