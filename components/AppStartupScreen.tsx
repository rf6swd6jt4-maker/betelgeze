/** Inline styles and SVG keep the first streamed screen independent of assets. */
export function AppStartupScreen() {
    return <div data-app-startup-screen role="status" aria-label="Loading Betelgeze" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#171717", color: "white", zIndex: 100 }}>
        <svg aria-hidden="true" width="64" height="64" viewBox="0 0 64 64"><path fill="currentColor" d="M32 4 60 32 32 60 4 32Z" /></svg>
    </div>
}
