import assert from "node:assert/strict"
import test from "node:test"

import {
    crawlScore,
    defaultWebsiteUrls,
    discoverWebsiteUrlsFromHtml,
    extractPageEvidence,
} from "../lib/leadgen/website-owner-discovery.ts"

test("discovers and prioritizes owner-relevant internal links", () => {
    const html = `
        <a href="/blog/spring-specials">Blog</a>
        <a href="/privacy-policy">Privacy</a>
        <a href="/meet-the-team">Meet the team</a>
        <a href="/about-us">About us</a>
        <a href="/contact">Contact</a>
        <a href="https://elsewhere.example/team">External team</a>
    `

    const urls = discoverWebsiteUrlsFromHtml("https://example.com", "https://example.com/", html, "owner_identity", 3)

    assert.equal(urls[0], "https://example.com/meet-the-team")
    assert.ok(urls.includes("https://example.com/about-us"))
    assert.ok(urls.includes("https://example.com/contact"))
    assert.equal(urls.some((url) => url.includes("privacy")), false)
    assert.equal(urls.some((url) => url.includes("elsewhere")), false)
})

test("includes owner and license paths in deeper owner-identity default crawls", () => {
    const urls = defaultWebsiteUrls("https://example.com", 3, "owner_identity")

    assert.ok(urls.includes("https://example.com/meet-the-owner"))
    assert.ok(urls.includes("https://example.com/meet-our-owner"))
    assert.ok(urls.includes("https://example.com/license"))
    assert.ok(crawlScore("https://example.com/meet-the-owner", "owner_identity") > crawlScore("https://example.com/blog/spring", "owner_identity"))
})

test("extracts owner identity from team cards with source snippets and social links", () => {
    const html = `
        <html>
            <head><title>Austin Roof Co | Meet the Owner Maria Lopez</title></head>
            <body>
                <section class="team-card">
                    <h2>Maria Lopez</h2>
                    <p>Owner and President</p>
                    <p>Call Maria directly at (512) 555-0199 for urgent roof repairs.</p>
                    <a href="https://www.linkedin.com/in/maria-lopez-roofing">LinkedIn</a>
                </section>
                <a href="/contact">Contact</a>
            </body>
        </html>
    `

    const result = extractPageEvidence("https://example.com/team", html)

    assert.equal(result.owner_name, "Maria Lopez")
    assert.equal(result.phone, "+15125550199")
    assert.equal(result.owner_source, "team_card")
    assert.ok(result.evidence.includes("team_card_owner_candidate"))
    assert.ok(result.social_links?.some((link) => link.includes("linkedin.com/in/maria-lopez-roofing")))
    assert.ok(result.snippets?.some((snippet) => String(snippet.snippet).includes("Owner and President")))
})

test("extracts founder from JSON-LD when visible copy is thin", () => {
    const html = `
        <script type="application/ld+json">
        {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "name": "Desert Floor Pros",
            "founder": {
                "@type": "Person",
                "name": "Daniel Lee",
                "jobTitle": "Founder",
                "telephone": "(602) 555-0144"
            },
            "sameAs": ["https://www.facebook.com/desertfloorpros"]
        }
        </script>
        <p>Family owned flooring services.</p>
    `

    const result = extractPageEvidence("https://example.com/about", html)

    assert.equal(result.owner_name, "Daniel Lee")
    assert.equal(result.phone, "+16025550144")
    assert.equal(result.owner_source, "json_ld")
    assert.ok(result.evidence.some((item) => item.startsWith("json_ld_owner:")))
})

test("extracts owners from founder sentence patterns", () => {
    const html = `
        <html>
            <body>
                <main>
                    <p>Rafael Moreno founded the company after twenty years as a licensed California fence contractor.</p>
                </main>
            </body>
        </html>
    `

    const result = extractPageEvidence("https://example.com/about", html, undefined, undefined, undefined, {
        businessNames: ["Moreno Fence"],
    })

    assert.equal(result.owner_name, "Rafael Moreno")
})

test("cleans noisy owner phrases down to person spans", () => {
    const html = `
        <html>
            <body>
                <section class="team-card">
                    <h2>SPILLMAN EXCAVATING Joe Spillman</h2>
                    <p>Owner and operator serving Austin contractors.</p>
                </section>
            </body>
        </html>
    `

    const result = extractPageEvidence("https://example.com/about", html, undefined, undefined, undefined, { businessNames: ["Spillman Excavating"] })

    assert.equal(result.owner_name, "Joe Spillman")
    assert.equal(result.owner_source, "team_card")
})

test("rejects business-name echoes and utility labels as owner names", () => {
    const html = `
        <html>
            <body>
                <section class="team-card">
                    <h2>Modular Solutions</h2>
                    <p>Owner portal for Modular Solutions Ltd customers.</p>
                </section>
                <section class="team-card">
                    <h2>Help Log</h2>
                    <p>Principal support tickets and customer resources.</p>
                </section>
                <section class="team-card">
                    <h2>Rincon Drywall</h2>
                    <p>Owner operated drywall contractor serving Tucson.</p>
                </section>
            </body>
        </html>
    `

    const result = extractPageEvidence("https://example.com/about", html, undefined, undefined, undefined, {
        businessNames: ["Modular Solutions Ltd", "Rincon Drywall"],
    })

    assert.equal(result.owner_name, null)
    assert.equal(result.evidence.some((item) => item.startsWith("owner:")), false)
})

test("rejects navigation and project headings as owner names", () => {
    const html = `
        <html>
            <head><title>Startech Electric | Frequently Asked Questions</title></head>
            <body>
                <section class="team-card">
                    <h2>Frequently Asked Questions</h2>
                    <p>Owner questions about our electrical services.</p>
                </section>
                <section class="team-card">
                    <h2>Featured Project</h2>
                    <p>Principal lighting installation portfolio.</p>
                </section>
            </body>
        </html>
    `

    const result = extractPageEvidence("https://example.com/about", html)

    assert.equal(result.owner_name, null)
    assert.equal(result.evidence.some((item) => item.startsWith("owner:")), false)
})

test("does not turn repeated about-page fragments into owner names", () => {
    const html = `
        <html>
            <body>
                <section class="team-card">
                    <h2>About Kyle</h2>
                    <p>Kyle is a life-long Austin resident and electrician.</p>
                </section>
            </body>
        </html>
    `

    const result = extractPageEvidence("https://example.com/about-kyle", html)

    assert.equal(result.owner_name, null)
})

test("rejects owner-ish website snippets that are not real person names", () => {
    const html = `
        <html>
            <body>
                <section class="team-card">
                    <h2>Where We Work</h2>
                    <p>Locally owned by Where We Work for every neighborhood we serve.</p>
                </section>
                <section class="team-card">
                    <h2>Our Team</h2>
                    <p>Run by Our Team with trusted service professionals.</p>
                </section>
            </body>
        </html>
    `

    const result = extractPageEvidence("https://example.com/about", html)

    assert.equal(result.owner_name, null)
    assert.equal(result.evidence.some((item) => item.startsWith("owner:")), false)
})

test("rejects repeated name sentence fragments instead of returning fake full names", () => {
    const html = `
        <html>
            <body>
                <p>Owned by John Smith John is a licensed contractor with twenty years of experience.</p>
            </body>
        </html>
    `

    const result = extractPageEvidence("https://example.com/about", html, undefined, undefined, undefined, {
        businessNames: ["Smith Contracting"],
    })

    assert.equal(result.owner_name, null)
})
