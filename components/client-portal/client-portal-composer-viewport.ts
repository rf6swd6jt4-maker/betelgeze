"use client"

import { type RefObject, useEffect } from "react"
import { requestChatViewportMotion } from "@/lib/chat-viewport-motion"
import { COMPOSER_KEYBOARD_MOTION_MS, createComposerViewportController } from "@/lib/composer-viewport-controller"

export function useClientPortalComposerViewport(composerRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const composer = composerRef.current
        const panel = composer?.closest<HTMLElement>("[data-client-portal-panel]") ?? null
        if (!composer || !panel) return

        const mobile = window.matchMedia("(max-width: 1023px)")
        const originalViewportBottom = panel.style.getPropertyValue("--client-portal-viewport-bottom")
        const readViewportBottom = () => {
            const visualViewport = window.visualViewport
            return Math.round((visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? window.innerHeight))
        }
        let appliedViewportBottom = readViewportBottom()
        const applyViewportBottom = (viewportBottom: number) => {
            appliedViewportBottom = viewportBottom
            panel.style.setProperty("--client-portal-viewport-bottom", `${viewportBottom}px`)
        }
        const viewport = createComposerViewportController({
            readBottom: readViewportBottom,
            animateKeyboard: () => mobile.matches,
            schedule: (callback, delay) => window.setTimeout(callback, delay),
            cancel: (timer) => window.clearTimeout(timer),
            writeBottom: (viewportBottom, animate) => requestChatViewportMotion(panel, appliedViewportBottom, viewportBottom,
                animate ? COMPOSER_KEYBOARD_MOTION_MS : 0, applyViewportBottom),
        })
        const holdPortalViewport = () => {
            if (document.visibilityState !== "hidden") viewport.update()
        }
        const handleComposerFocus = () => {
            if (document.visibilityState !== "hidden") viewport.focus()
        }
        const handleComposerBlur = () => {
            if (document.visibilityState !== "hidden") viewport.blur()
        }
        const suspendPortalViewport = () => {
            composer.blur()
            viewport.suspend()
        }
        const resumePortalViewport = () => {
            if (document.visibilityState === "visible") viewport.resume()
        }
        const handleVisibility = () => {
            if (document.visibilityState === "hidden") suspendPortalViewport()
            else resumePortalViewport()
        }
        if (document.activeElement === composer) handleComposerFocus()
        composer.addEventListener("focus", handleComposerFocus)
        composer.addEventListener("blur", handleComposerBlur)
        window.addEventListener("resize", holdPortalViewport)
        window.visualViewport?.addEventListener("resize", holdPortalViewport)
        window.visualViewport?.addEventListener("scroll", holdPortalViewport)
        document.addEventListener("visibilitychange", handleVisibility)
        window.addEventListener("pagehide", suspendPortalViewport)
        window.addEventListener("pageshow", resumePortalViewport)

        return () => {
            composer.removeEventListener("focus", handleComposerFocus)
            composer.removeEventListener("blur", handleComposerBlur)
            window.removeEventListener("resize", holdPortalViewport)
            window.visualViewport?.removeEventListener("resize", holdPortalViewport)
            window.visualViewport?.removeEventListener("scroll", holdPortalViewport)
            document.removeEventListener("visibilitychange", handleVisibility)
            window.removeEventListener("pagehide", suspendPortalViewport)
            window.removeEventListener("pageshow", resumePortalViewport)
            viewport.dispose()
            if (originalViewportBottom) panel.style.setProperty("--client-portal-viewport-bottom", originalViewportBottom)
            else panel.style.removeProperty("--client-portal-viewport-bottom")
        }
    }, [composerRef])
}
