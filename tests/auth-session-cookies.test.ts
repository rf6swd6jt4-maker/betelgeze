import assert from "node:assert/strict"
import test from "node:test"
import {
    browserSessionCookieDomain,
    persistentSessionOptions,
    SESSION_MAX_AGE_SECONDS,
    sessionCookieDomain,
    sessionCookieOptions,
} from "../lib/supabase/session-cookies.ts"

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
    const previous = Object.fromEntries(
        Object.keys(env).map((key) => [key, process.env[key]])
    )

    try {
        for (const [key, value] of Object.entries(env)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        fn()
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

test("keeps remembered devices signed in for 90 days", () => {
    assert.equal(SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 90)
    assert.equal(sessionCookieOptions().maxAge, SESSION_MAX_AGE_SECONDS)
})

test("uses the shared Betelgeze cookie domain on platform hosts", () => {
    withEnv({
        NEXT_PUBLIC_SITE_URL: "https://dashboard.betelgeze.com",
        NEXT_PUBLIC_SUPABASE_SESSION_DOMAIN: undefined,
        SUPABASE_SESSION_DOMAIN: undefined,
    }, () => {
        assert.equal(sessionCookieDomain(), ".betelgeze.com")
        assert.equal(browserSessionCookieDomain(), ".betelgeze.com")
        const options = sessionCookieOptions(sessionCookieDomain())
        assert.equal("domain" in options ? options.domain : undefined, ".betelgeze.com")
    })
})

test("omits the cookie domain for localhost sessions", () => {
    withEnv({
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_SESSION_DOMAIN: undefined,
        SUPABASE_SESSION_DOMAIN: undefined,
    }, () => {
        assert.equal(sessionCookieDomain(), undefined)
        assert.equal(browserSessionCookieDomain(), undefined)
        assert.equal("domain" in sessionCookieOptions(sessionCookieDomain()), false)
        const options = persistentSessionOptions({ domain: ".betelgeze.com", path: "/", maxAge: 60 }, undefined)
        assert.equal("domain" in options ? options.domain : undefined, undefined)
    })
})
