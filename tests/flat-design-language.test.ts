import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

// The workspace's flat design language (docs/ui-standards.md, "Design language"). These pin the decisions that keep it
// flat, so a later change that brings back boxes, glass or a second radius fails here first.

test("the workspace has one hairline, one popup surface, one accent and no lifted or frosted surface", () => {
    const css = source("app/globals.css")
    assert.match(css, /--color-surface-1: var\(--background\);/, "sections sit on the canvas: there is no raised fill")
    assert.match(css, /--color-surface-popup: #141414;/, "the one raised surface is opaque")
    assert.match(css, /--color-card-border: rgb\(255 255 255 \/ 0\.08\);/)
    assert.match(css, /--shadow-popup: /)
    assert.match(css, /--color-accent: #6e9bf5;/)
    assert.doesNotMatch(css, /--color-surface-glass|--shadow-card/, "the frosted, lifted surface is gone")
    for (const path of ["components/ui/Card.tsx", "components/ui/CenteredDialog.tsx", "components/ui/SideDrawer.tsx", "components/ui/Selector.tsx", "components/list/List.tsx", "components/list/ListActionMenu.tsx",
        "components/list/MobileCardActionSurface.tsx", "components/list/ListCreatorBadge.tsx", "components/panel/QuickStats.tsx", "components/workspace/ShellRelationshipContextPanel.tsx", "components/workspace/WorkspaceTopBarClient.tsx", "components/workspace/ClientRail.tsx"]) {
        assert.doesNotMatch(source(path), /backdrop-blur|backdrop-saturate|surface-glass|shadow-card/, `${path} has no glass, blur or card shadow`)
    }
    for (const path of ["components/ui/CenteredDialog.tsx", "components/ui/SideDrawer.tsx", "components/ui/Selector.tsx", "components/list/ListActionMenu.tsx"]) {
        assert.match(source(path), /bg-\[var\(--color-surface-popup\)\][^"`]* shadow-popup|shadow-popup[^"`]*bg-\[var\(--color-surface-popup\)\]/, `${path} floats on the popup surface with the popup shadow`)
    }
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /<header data-workspace-topbar className=\{`fixed left-0 top-0 z-\[55\] h-14 w-full border-b border-card-border bg-neutral-950 text-white /, "the top bar has a hairline, not a shadow")
    assert.doesNotMatch(shell, /data-workspace-topbar[^>]*shadow-lg|data-workspace-tabbar[^>]*shadow-lg/)
})

test("one small radius in the workspace; client-facing surfaces keep their own shape", async () => {
    const css = source("app/globals.css")
    assert.match(css, /@theme \{\s*--radius-lg: 0\.375rem;\s*--radius-xl: 0\.5rem;\s*--radius-2xl: 0\.5rem;\s*--radius-3xl: 0\.5rem;\s*\}/, "6px for controls, 8px for everything larger")
    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { onboardingThemeStyle } = await import("../lib/onboarding/theme.ts")
    const style = onboardingThemeStyle(null) as Record<string, string>
    assert.deepEqual([style["--radius-lg"], style["--radius-xl"], style["--radius-2xl"], style["--radius-3xl"]], ["0.5rem", "0.75rem", "1rem", "1.5rem"], "a client-themed subtree restores the rounder steps")
    const list = source("components/list/List.tsx")
    assert.match(list, /\? `\$\{embedded \? "border-y" : "rounded-2xl border shadow-\[0_1px_2px_0_rgb\(0_0_0\/0\.35\),inset_0_1px_0_0_rgb\(255_255_255\/0\.04\)\]"\} border-black\/10 bg-\[var\(--onboarding-surface,#FFFFFF\)\]`/, "the light client-facing list keeps its rounded, lifted box")
    assert.match(list, /: `border-y border-card-border \$\{embedded \? "" : "-mx-2"\}`/, "the workspace list is rows between two hairlines")
    const stats = source("components/panel/QuickStats.tsx")
    assert.match(stats, /: "mt-5 grid grid-cols-3 gap-x-6 sm:flex sm:gap-x-10"\}/, "workspace statistics are plain pairs with no boxes")
    assert.match(stats, /rounded-xl border border-black\/10 bg-black\/\[0\.02\]/, "the light portal strip is unchanged")
    const fields = source("components/detail/DetailFields.tsx")
    assert.match(fields, /<span className="hidden group-data-\[surface=light\]\/fields:inline-flex"><DetailFieldIconMark kind=\{icon\} \/><\/span>/, "field icons remain on light surfaces only")
})

test("colour means state: it lives in the diamond, a pill's tint and the one primary button", async () => {
    // @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
    const { statusToneClasses } = await import("../components/ui/status-styles.ts")
    for (const tone of ["grey", "yellow", "green", "red"] as const) assert.equal(statusToneClasses[tone].text, "text-neutral-200", "a status label is plain text in every tone")
    assert.notEqual(statusToneClasses.green.mark, statusToneClasses.red.mark)
    const status = source("components/ui/Status.tsx")
    assert.match(status, /<BetelgezeStatusMark className=\{`\$\{classes\.mark\}/, "the Betelgeze diamond stays the status mark")
    const stage = source("components/ui/RelationshipStage.tsx")
    assert.match(stage, /<BetelgezeStatusMark className="bg-current" \/>/, "a stage is the same diamond in the stage's colour, then plain text")
    assert.doesNotMatch(stage, /clip-path|module\.css|styles\./, "the pointed-end pill is gone")
    const marks = stage.slice(stage.indexOf("export const relationshipStageMarks"), stage.indexOf("/** Shared by RelationshipStage"))
    assert.doesNotMatch(marks, /"red"/, "red is never a stage: it would read as a failed status")
    assert.match(marks, /fulfilment: "emerald"/)
    assert.match(stage, /fulfilment: "red",\s+retention: "neutral",/, "the Gantt keeps its own categorical colours")
    for (const pill of ["components/ui/RoundPill.tsx", "components/ui/SquarePill.tsx"]) {
        assert.match(source(pill), /style=\{\{ backgroundColor: colours\.background, color: colours\.text \}\} className=\{`\$\{pillClass\} /, "a pill is a tinted tag with no border")
        assert.doesNotMatch(source(pill), /borderColor|rounded-full/)
    }
    const assignee = source("components/ui/Assignee.tsx")
    assert.doesNotMatch(assignee, /RoundPill/, "a person is an avatar and a plain name")
    const button = source("components/ui/Button.tsx")
    assert.match(button, /primary: "bg-\[var\(--color-accent\)\] text-\[var\(--color-accent-contrast\)\] hover:bg-\[var\(--color-accent-hover\)\]"/)
    assert.match(button, /sm: "min-h-11 gap-1\.5 px-2\.5 text-\[13px\] sm:min-h-7",\s+md: "min-h-11 gap-2 px-3 text-sm sm:min-h-8",/, "compact on desktop, a full touch target on phones")
})

test("tabs are underlined text and filters are washed chips, so one never reads as the other", () => {
    const strip = source("components/panel/PanelTabStrip.tsx")
    assert.match(strip, /active \? "border-neutral-100 font-medium text-white" : "border-transparent text-neutral-400 hover:text-neutral-100"/)
    assert.match(strip, /shadow-\[inset_0_-1px_0_var\(--color-card-border\)\]/, "the strip's line is an inset shadow, so the underline sits on it inside a scrolling strip")
    assert.doesNotMatch(strip, /bg-white font-medium text-black|rounded-lg/, "a tab is never a filled or outlined button")
    const tabs = source("components/panel/PanelTabs.tsx")
    assert.match(tabs, /className=\{panelTabClass\(active === item\.key\)\}/, "local section tabs share the same look")
    const rail = source("components/panel/FilterRail.tsx")
    assert.match(rail, /\? "bg-\[var\(--color-surface-selected\)\] text-white /)
    assert.match(rail, /group-data-\[surface=light\]\/rail:border-\[var\(--onboarding-primary,#1E3A5F\)\]/, "light client-facing rails keep their themed underline")
    assert.doesNotMatch(rail, /border-y border-neutral-800/, "the workspace rail has no rule above or below")
})

test("the Today sidebar is a flush column of names, laid out before hydration", () => {
    const shell = source("components/workspace/WorkspaceTopBarClient.tsx")
    assert.match(shell, /const \[sidebarOpen, setSidebarOpen\] = useState\(layout === "today"\)/, "names from the first paint")
    assert.match(shell, /\{layout === "today" \? <style>\{"@media \(min-width: 768px\) \{ :root \{ --workspace-sidebar-width: 3\.25rem; \} \} @media \(min-width: 1024px\) \{ :root \{ --workspace-sidebar-width: 15rem; \} \}"\}<\/style> : null\}/, "the work area is laid out against it before any script runs: folded on a tablet, names at desktop width")
    assert.match(shell, /layout === "today" \? sidebarOpen \? "15rem" : "3\.25rem" : sidebarOpen \? "18rem" : "5rem"/)
    assert.match(shell, /setSidebarOpen\(!phone && \(stored === null \? window\.matchMedia\("\(min-width: 1024px\)"\)\.matches : stored === "true"\)\)/, "the person's choice wins; otherwise names at desktop width, folded on a tablet, and a phone's drawer starts closed")
    assert.match(shell, /if \(layout === "today" && !window\.matchMedia\("\(max-width: 767px\)"\)\.matches\) shellStorage\.set\(todaySidebarStorageKey, sidebarOpen \? "false" : "true"\)/, "only the toggle is remembered, never a width's default")
    assert.match(shell, /md:left-0 md:top-0 md:h-dvh md:rounded-none md:border-0 md:border-r md:bg-\[var\(--color-surface-canvas\)\] md:shadow-none \$\{!sidebarOpen \? "md:w-\[3\.25rem\]" : sidebarHydrated \? "md:w-60" : "md:w-\[3\.25rem\] lg:w-60"\}/, "a hairline edge, not a floating box")
    assert.match(shell, /<div data-sidebar-identity className="hidden h-14 shrink-0 items-center gap-2\.5 px-2 md:flex">/, "the workspace's name heads the sidebar")
    const css = source("app/globals.css")
    assert.match(css, /\[data-workspace-shell-root\]\[data-workspace-layout="today"\] \[data-workspace-topbar\] \{\s*left: var\(--workspace-sidebar-width\);\s*width: calc\(100% - var\(--workspace-sidebar-width\)\);/, "the top bar starts beside it, keyed on the server-rendered shell root")
    assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1023px\) \{\s*\[data-workspace-shell-root\]\[data-workspace-layout="today"\] \[data-workspace-sidebar\] \{\s*top: var\(--workspace-visual-origin-offset, 0px\);\s*height: var\(--workspace-visual-viewport-bottom, 100dvh\);/, "between md and lg it is flush from the top too")
    const settings = source("app/[workspaceSlug]/settings/page.tsx")
    assert.match(settings, /workspaceLayoutFor\(workspace\.id, user\.id\) === "today" \? <nav aria-label="More workspace tools"/, "Admin and the Builder are reached from Settings in this layout")
})
