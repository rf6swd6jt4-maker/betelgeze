import test from "node:test"
import assert from "node:assert/strict"
import { resolveOnboardingRedirect, resolveProxy, ONBOARDING_FIXTURE_SESSION_ID } from "../scripts/fixtures/onboarding-redirect-runtime.mjs"

const path = "/fixture/onboarding/10000000-0000-4000-8000-000000000020"

// This executes the page's real sole-session branch and follows its emitted URL
// through the real proxy. A URL-helper-only test missed the nested-shell failure.
test("sole-session shortcut retains the frame through actual page redirect and proxy routing", async () => {
    const source = `${path}?page=0&__betelgeze_tab=context-shortcut`
    const result = await resolveOnboardingRedirect(source)
    assert.ok(result.location)
    const redirected = new URL(result.location, "https://app.betelgeze.com")
    assert.equal(redirected.searchParams.get("session"), ONBOARDING_FIXTURE_SESSION_ID)
    assert.equal(redirected.searchParams.get("__betelgeze_tab"), "context-shortcut")
    assert.equal(redirected.searchParams.get("__betelgeze_redirect"), `${path}?page=0`)
    const destination = await resolveProxy(result.location)
    assert.equal(destination.pathname, path, "the redirect must remain a panel document instead of nesting the workspace shell")
    assert.equal(destination.requestHeaders.get("x-betelgeze-workspace-shell"), null)
    assert.equal(destination.requestHeaders.get("x-betelgeze-current-path"), result.location)
    assert.equal(result.reads.length, 1, "redirect reuses the single authorized session-page query")
    assert.equal(result.reads[0].name, "read_onboarding_panel_sessions")
    assert.equal(result.reads[0].args.p_offset, 0)
    assert.equal(result.reads[0].args.p_relationship_id, path.split("/").at(-1))
})

test("top-level onboarding links still route through the workspace shell", async () => {
    const result = await resolveOnboardingRedirect(path)
    const redirected = new URL(result.location, "https://app.betelgeze.com")
    assert.equal(redirected.searchParams.get("session"), ONBOARDING_FIXTURE_SESSION_ID)
    assert.equal(redirected.searchParams.has("__betelgeze_tab"), false)
    assert.equal(redirected.searchParams.has("__betelgeze_redirect"), false)
    const destination = await resolveProxy(result.location)
    assert.equal(destination.pathname, "/~workspace-shell/fixture")
    assert.equal(destination.requestHeaders.get("x-betelgeze-workspace-shell"), "1")
})

test("actual proxy distinguishes the same selected session with and without its frame marker", async () => {
    const selected = `${path}?session=${ONBOARDING_FIXTURE_SESSION_ID}`
    assert.equal((await resolveProxy(`${selected}&__betelgeze_tab=context-shortcut`)).pathname, path)
    assert.equal((await resolveProxy(selected)).pathname, "/~workspace-shell/fixture")
})

for (const [label, options, query] of [
    ["no sessions", { sessionCount: 0 }, ""],
    ["several sessions", { sessionCount: 2 }, ""],
    ["a following page", { sessionCount: 1, hasMore: true }, ""],
    ["a noninitial page", { sessionCount: 1 }, "&page=1"],
]) {
    test(`chooser keeps ${label} instead of automatically selecting a session`, async () => {
        const result = await resolveOnboardingRedirect(`${path}?__betelgeze_tab=context-shortcut${query}`, options)
        assert.equal(result.location, undefined)
        assert.equal(result.rendered.type, "onboarding-session-chooser")
        assert.equal(result.rendered.props.sessions.length, options.sessionCount)
        assert.equal(result.reads.length, 1)
        assert.equal(result.reads[0].args.p_offset, query ? 50 : 0)
    })
}

test("denied or missing relationships cannot reach automatic session selection", async () => {
    for (const options of [{ relationshipAllowed: false }, { relationshipExists: false }]) {
        await assert.rejects(resolveOnboardingRedirect(`${path}?__betelgeze_tab=context-shortcut`, options), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404")
    }
})

test("session lookup failure remains an error instead of a chooser or redirect", async () => {
    await assert.rejects(resolveOnboardingRedirect(`${path}?__betelgeze_tab=context-shortcut`, { sessionError: true }), /Could not load onboarding sessions/)
})

test("invalid selected-session IDs retain the page's existing not-found boundary", async () => {
    await assert.rejects(resolveOnboardingRedirect(`${path}?session=not-a-session&__betelgeze_tab=context-shortcut`), error => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404")
})
