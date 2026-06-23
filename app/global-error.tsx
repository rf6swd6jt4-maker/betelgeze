"use client"

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
    const code = `BGE-${error.digest ?? "UNEXPECTED"}`
    return <html lang="en"><body style={{ margin: 0, background: "#0a0a0a", color: "#fff", fontFamily: "Arial, sans-serif" }}><main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}><section style={{ width: "min(100%, 560px)", border: "1px solid #262626", borderRadius: 16, background: "#171717", padding: 32 }}><p style={{ color: "#a7f3d0", letterSpacing: ".18em", fontSize: 12 }}>BETELGEZE</p><h1>An error has occurred</h1><p style={{ color: "#d4d4d4", lineHeight: 1.6 }}>Reload this page to try again. If it repeats, send this code to Betelgeze support.</p><code style={{ display: "inline-block", marginTop: 12, padding: "8px 12px", background: "#0a0a0a", borderRadius: 8, color: "#a7f3d0" }}>{code}</code><br /><button onClick={() => window.location.reload()} style={{ marginTop: 24, padding: "12px 16px", borderRadius: 8, border: 0, cursor: "pointer" }}>Reload page</button></section></main></body></html>
}
