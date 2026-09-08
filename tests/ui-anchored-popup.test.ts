import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { anchoredPopupPosition } from "../components/ui/anchored-popup-position.ts"

test("anchored popups sit above their trigger and clamp to a mobile viewport", () => {
    const position = anchoredPopupPosition({
        trigger: { left: 350, right: 382, top: 700 },
        popupWidth: 208,
        popupHeight: 260,
        viewport: { left: 0, top: 0, width: 390, height: 844 },
        align: "end",
    })

    assert.equal(position.left, 174)
    assert.equal(position.top, 434)
    assert.equal(position.top + 260 + 6, 700)
    assert.equal(position.maxWidth, 374)
})

test("anchored popups stay inside the top and side safety edges", () => {
    const position = anchoredPopupPosition({
        trigger: { left: 2, right: 34, top: 58 },
        popupWidth: 420,
        popupHeight: 300,
        viewport: { left: 0, top: 20, width: 390, height: 600 },
        align: "start",
    })

    assert.equal(position.left, 8)
    assert.equal(position.top, 28)
    assert.equal(position.maxHeight, 24)
    assert.equal(position.maxWidth, 374)
})

test("field and list menus share the parent-aware anchored popup primitive", async () => {
    const [popup, listMenu, mobileSurface, fields, standards] = await Promise.all([
        readFile("components/ui/AnchoredPopup.tsx", "utf8"),
        readFile("components/list/ListActionMenu.tsx", "utf8"),
        readFile("components/list/MobileCardActionSurface.tsx", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8"),
        readFile("docs/ui-standards.md", "utf8"),
    ])

    assert.match(popup, /createPortal/)
    assert.match(popup, /betelgeze-popup-enter/)
    assert.match(popup, /sourceWindow\.parent\.document/)
    assert.match(popup, /visualViewport/)
    assert.match(popup, /ResizeObserver/)
    assert.match(popup, /z-\[2147483646\]/)
    assert.match(popup, /WORKSPACE_TAB_VISIBILITY_EVENT/)
    assert.match(popup, /workspaceTabActive === "false"/)
    assert.match(popup, /betelgeze:workspace-navigation-start/)
    assert.match(popup, /pagehide/)
    assert.match(listMenu, /<AnchoredPopup/)
    assert.match(mobileSurface, /<AnchoredPopup/)
    assert.match(fields, /<AnchoredPopup/)
    assert.match(standards, /open directly above/)
})

test("portal detail navigation preserves the popup owner's close handler", async () => {
    const shell = await readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8")
    const start = shell.indexOf("function openPortalledDetail")
    const end = shell.indexOf("document.addEventListener", start)
    const handler = shell.slice(start, end)

    assert.match(handler, /event\.preventDefault\(\)/)
    assert.doesNotMatch(handler, /event\.stopPropagation\(\)/)
})

test("cursor popups center above the point and flip below near the top", () => {
    const input = { trigger: { left: 500, right: 500, top: 400 }, popupWidth: 280, popupHeight: 50, viewport: { left: 0, top: 0, width: 1000, height: 700 }, align: "center" as const, fallbackBelow: true }
    const above = anchoredPopupPosition(input)
    assert.equal(above.left, 360)
    assert.equal(above.top, 344)
    const below = anchoredPopupPosition({ ...input, trigger: { left: 6, right: 6, top: 12 } })
    assert.equal(below.left, 8)
    assert.equal(below.top, 18)
    assert.ok(below.maxHeight >= 50)
})

test("cursor popups remain bounded with viewport offsets, oversized content and offscreen anchors", () => {
    const viewport = { left: 14, top: 90, width: 320, height: 350 }
    for (const x of [-100, 14, 174, 334, 1000]) for (const y of [-100, 90, 265, 440, 1000]) {
        const result = anchoredPopupPosition({ trigger: { left: x, right: x, top: y }, popupWidth: 480, popupHeight: 600, viewport, align: "center", fallbackBelow: true })
        assert.ok(result.left >= viewport.left + 8)
        assert.ok(result.top >= viewport.top + 8)
        assert.ok(result.left + result.maxWidth <= viewport.left + viewport.width - 8)
        assert.ok(result.top + result.maxHeight <= viewport.top + viewport.height - 8)
        assert.ok(result.maxHeight > 0)
    }
})

test("all chat surfaces use cursor anchors and a measured emoji picker", async () => {
    for (const path of ["components/communications/TeamCommunicationsWorkspace.tsx", "components/communications/CommunicationsWorkspace.tsx", "components/client-portal/ClientPortalChat.tsx"]) {
        const source = await readFile(path, "utf8")
        assert.match(source, /<MessageActionPopup/)
        assert.match(source, /setActionAnchor\(anchor\)/)
        assert.doesNotMatch(source, /data-message-action-popup className=.*bottom-full/)
    }
    const actions = await readFile("components/communications/MessageActionMenu.tsx", "utf8")
    assert.match(actions, /anchorPoint=\{anchor\?\.point\}/)
    assert.match(actions, /data-message-action-popup/)
    assert.match(actions, /flex-col-reverse/)
    assert.doesNotMatch(actions, /absolute bottom-12/)
})
