// Trusted browser input on the real composer fixture. Browser emulation does
// not establish physical keyboard behavior. WebKit exposes native tap but no
// public touch-drag/wheel API in mobile mode, so that case sets the list's
// scroll position before performing its native tap. Chromium drags natively.
const assert = (condition, message) => { if (!condition) throw Error(message) }
const uuid = number => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`
function assertStableGeometry(before, after, action) {
    for (const [selector, bounds] of Object.entries(before.geometry)) for (const [edge, position] of Object.entries(bounds)) {
        assert(Math.abs(after.geometry[selector][edge] - position) <= 1.5, `${action} moved ${selector} ${edge}`)
    }
    assert(after.documentScroll === before.documentScroll && after.historyScroll === before.historyScroll, `${action} scrolled the surrounding document or history`)
}

export async function runCommsReferenceNativeInput(page, { engine, input, url }) {
    const cases = []
    const snapshot = () => page.evaluate(() => window.commsReferenceNativeInput.snapshot())
    for (const kind of ["person", "record", "last-after-scroll"]) {
        let before, after, events = [], scrollMethod
        try {
            await page.goto(`${url}?native-input&kind=${kind}`)
            await page.bringToFront()
            await page.waitForFunction(() => window.commsReferenceNativeInput?.ready)
            await page.evaluate(() => {
                window.referenceNativeEvents = []
                for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "mousedown", "blur", "click"]) {
                    document.addEventListener(type, event => window.referenceNativeEvents.push({
                        type, trusted: event.isTrusted, pointerType: event.pointerType,
                        row: event.target?.closest?.("[data-mention-index]")?.dataset.mentionIndex,
                    }), true)
                }
            })
            before = await snapshot()
            assert(before.focused && before.options > 0, "Fixture did not start with a focused composer and choices")
            if (kind === "last-after-scroll") {
                const bounds = await page.locator("[data-reference-picker]").boundingBox()
                if (input === "touch" && engine === "chromium") {
                    scrollMethod = "native Chromium touch drag"
                    const client = await page.context().newCDPSession(page)
                    const x = bounds.x + bounds.width / 2, startY = bounds.y + bounds.height - 20
                    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] })
                    for (let step = 1; step <= 6; step++) {
                        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY - step * 24 }] })
                        await page.waitForTimeout(30)
                    }
                    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
                    await client.detach()
                    await page.waitForTimeout(500)
                    const dragged = await snapshot()
                    assert(dragged.pickerScroll > 0, "Native touch drag did not scroll the picker")
                    assert(dragged.value === before.value && dragged.focused && dragged.sends === 0, "Native drag selected a row or dismissed the composer")
                    assertStableGeometry(before, dragged, "Native drag")
                } else scrollMethod = input === "touch" ? "programmatic scroll setup; native WebKit tap" : "native wheel"
                // Finish at the exact edge so the final row is a stable target,
                // including when the preceding touch drag starts momentum.
                if (input === "touch" && engine === "webkit") await page.locator("[data-reference-picker]").evaluate(element => { element.scrollTop = element.scrollHeight })
                else {
                    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
                    await page.mouse.wheel(0, 600)
                }
                await page.waitForTimeout(200)
                const scrolled = await snapshot()
                assert(scrolled.pickerScroll > 0 && scrolled.value === before.value && scrolled.focused && scrolled.sends === 0, "Scrolling inserted a choice, lost focus or failed to move")
                assertStableGeometry(before, scrolled, "Scrolling")
            }
            const label = kind === "record" ? "Reference work item Private project draft" : kind === "last-after-scroll" ? "Mention Alex Person 8" : "Mention Alex Person 1"
            const row = page.getByRole("option", { name: label, exact: true })
            const box = await row.boundingBox()
            assert(box, "Expected labelled choice is missing")
            const point = { x: box.x + Math.min(80, box.width / 2), y: box.y + box.height / 2 }
            if (input === "touch") await page.touchscreen.tap(point.x, point.y)
            else await page.mouse.click(point.x, point.y)
            // Wait through WebKit's compatibility mouse/click sequence. Testing
            // before that sequence could miss the blur which removes a row.
            await page.waitForTimeout(650)
            after = await snapshot()
            events = await page.evaluate(() => window.referenceNativeEvents)
            const expected = kind === "record" ? `@[ref](record:work_item:${uuid(20)}) ` : `@[Alex%20Person%20${kind === "last-after-scroll" ? 8 : 1}](mention:${uuid(kind === "last-after-scroll" ? 8 : 1)}) `
            assert(after.value === expected, `Selection source mismatch: ${JSON.stringify(after.value)}`)
            assert(after.focused && after.options === 0 && after.sends === 0, "Selection lost composer focus, left popup open or sent the draft")
            assert(after.requests === before.requests, "Selection introduced another search")
            assertStableGeometry(before, after, "Selection")
            assert(events.some(event => event.type === "click" && event.trusted && event.row !== undefined), "Selection was not completed by a trusted browser click")
            assert(!events.some(event => event.type === "blur"), "Native selection blurred the composer before restoring it")
            cases.push({ name: `${input} ${kind} selects once and retains composer focus`, passed: true, before, after, events, scrollMethod })
        } catch (error) {
            after ??= await snapshot().catch(() => null)
            events = await page.evaluate(() => window.referenceNativeEvents ?? []).catch(() => [])
            cases.push({ name: `${input} ${kind} selects once and retains composer focus`, passed: false, error: String(error), before, after, events, scrollMethod })
        }
    }
    return { status: "complete", total: cases.length, passed: cases.filter(result => result.passed).length, cases }
}
