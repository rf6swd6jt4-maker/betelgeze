export const appStartupCanvas = {
    backgroundColor: "#171717",
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Cpath fill=%22white%22 d=%22M32 4 60 32 32 60 4 32Z%22/%3E%3C/svg%3E")',
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "64px 64px",
} as const

/** Inline styles and SVG keep the first streamed screen independent of assets. */
export function AppStartupScreen() {
    return <div data-app-startup-screen role="status" aria-label="Loading Betelgeze" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#171717", color: "white", zIndex: 100 }}>
        <svg aria-hidden="true" width="64" height="64" viewBox="0 0 64 64"><path fill="currentColor" d="M32 4 60 32 32 60 4 32Z" /></svg>
    </div>
}
