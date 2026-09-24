// Real Team/Client components and local synthetic data. No account or provider I/O.
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { chromium, webkit } from "playwright"

const engines = process.argv.slice(2)
if (engines.some(engine => !["chromium", "webkit"].includes(engine))) throw Error("Use chromium and/or webkit")
const server = spawn(process.execPath, ["scripts/serve-fullscreen-comms-preview.mjs", "--host", "127.0.0.1", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] })
const origin = await new Promise((resolve, reject) => {
    let output = ""
    const timeout = setTimeout(() => reject(Error(`Preview did not start: ${output}`)), 90_000)
    const consume = chunk => {
        output = (output + chunk).slice(-12_000)
        const match = output.match(/http:\/\/localhost:(\d+)\//)
        if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`) }
    }
    server.stdout.on("data", consume)
    server.stderr.on("data", consume)
    server.once("exit", code => { clearTimeout(timeout); reject(Error(`Preview exited ${code}: ${output}`)) })
})
const results = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
await mkdir("browser-results", { recursive: true })
try {
    for (const engine of engines.length ? engines : ["chromium", "webkit"]) {
        const browser = await ({ chromium, webkit })[engine].launch()
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
        const errors = [], external = []
        await context.route("**/*", route => {
            const url = new URL(route.request().url())
            if (url.origin === origin || ["blob:", "data:"].includes(url.protocol)) return route.continue()
            external.push(url.origin); return route.abort()
        })
        const page = await context.newPage()
        page.on("pageerror", error => errors.push(error.message))
        await page.goto(origin)
        await page.getByText("Project team", { exact: true }).click()
        await page.waitForFunction(() => document.querySelector("[data-mobile-conversation-surface]:not([hidden])")?.dataset.phase === "open")
        const surface = page.locator("[data-mobile-conversation-surface]:not([hidden])")
        const check = async (name, run) => {
            await run()
            results.push({ engine, name, passed: true })
            console.log(`${engine}: ${name}`)
        }
        // A short valid local WAV; no uploaded or account media is used.
        const samples = 16000, wav = Buffer.alloc(44 + samples * 2)
        wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8)
        wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
        wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
        wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40)
        await surface.locator('input[type="file"]').first().setInputFiles({ name: "synthetic-voice.wav", mimeType: "audio/wav", buffer: wav })
        await surface.getByRole("button", { name: "Send message" }).click()
        const play = surface.getByRole("button", { name: "Play synthetic-voice.wav", exact: true })
        await play.waitFor()
        const audio = surface.locator("audio").last()
        await check("voice: seek remains disabled before duration and exposed to assistive technology", async () => {
            // preload=none is a hint: local blob metadata may already be ready.
            // Exercise the unknown-duration event explicitly instead of racing it.
            await audio.evaluate(audio => {
                Object.defineProperty(audio, "duration", { configurable: true, value: NaN })
                audio.dispatchEvent(new Event("durationchange"))
            })
            const seek = surface.getByRole("slider", { name: "Seek synthetic-voice.wav" })
            assert.equal(await seek.count(), 1)
            await page.waitForFunction(() => document.querySelector('[aria-label="Seek synthetic-voice.wav"]')?.disabled === true)
        })
        await check("voice: loaded metadata enables keyboard seeking without opening message actions", async () => {
            await audio.evaluate(audio => { delete audio.duration; audio.load() })
            await page.waitForFunction(() => document.querySelector("audio")?.readyState >= 1 && document.querySelector('[aria-label="Seek synthetic-voice.wav"]')?.disabled === false)
            const seek = surface.getByRole("slider", { name: "Seek synthetic-voice.wav" })
            assert.equal(await seek.isEnabled(), true)
            await seek.focus()
            await page.keyboard.press("ArrowRight")
            assert((await audio.evaluate(audio => audio.currentTime)) > 0)
            assert.equal(await page.locator("[data-anchored-popup]").count(), 0)
        })
        await check("voice: intentionally interrupted playback does not report unavailable", async () => {
            await audio.evaluate(audio => { audio.play = () => Promise.reject(new DOMException("Playback was interrupted", "AbortError")) })
            await play.click()
            await pause(100)
            assert.equal(await surface.getByText("Audio unavailable", { exact: true }).count(), 0)
        })
        await check("voice: real playback failure stays visible and a successful retry clears it", async () => {
            await audio.evaluate(audio => { audio.play = () => Promise.reject(new DOMException("Unsupported recording", "NotSupportedError")) })
            await play.click()
            await surface.getByText("Audio unavailable", { exact: true }).waitFor()
            await audio.evaluate(audio => { audio.play = () => Promise.resolve() })
            await play.click()
            await pause(100)
            assert.equal(await surface.getByText("Audio unavailable", { exact: true }).count(), 0)
        })
        assert.deepEqual(errors, [], "Browser exceptions")
        assert.deepEqual(external, [], "External requests")
        await context.close()
        await browser.close()
    }
} finally {
    server.kill("SIGTERM")
    await writeFile("browser-results/comms-media-polish.json", JSON.stringify({ observedAt: new Date().toISOString(), results, limits: "Actual VoiceNotePlayer in the synthetic Team workspace. Browser playback rejections are controlled; no physical media/device or delivery claim." }, null, 2))
}
