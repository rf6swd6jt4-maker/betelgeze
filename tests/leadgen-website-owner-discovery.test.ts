import assert from "node:assert/strict"
import test from "node:test"

import {
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
