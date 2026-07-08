import assert from "node:assert/strict"
import test from "node:test"

import { deterministicPersonNameGate, gatePersonNameCandidates } from "../lib/leadgen/person-name-gate.js"

test("person gate rejects website fragments that look capitalized but are not people", () => {
    const fragments = [
        "Where We Work",
        "Where We",
        "Our Team",
        "Featured Project",
        "Service Areas",
        "de la",
    ]

    for (const fragment of fragments) {
        const result = deterministicPersonNameGate({
            candidateName: fragment,
            text: `Locally owned by ${fragment}`,
            source: "visible_text",
            businessNames: ["Example Roofing"],
        })

        assert.equal(result.accepted, false, fragment)
    }
})

test("person gate rejects repeated sentence fragments", () => {
    const result = deterministicPersonNameGate({
        candidateName: "John Smith John",
        text: "Owned by John Smith John is a licensed contractor serving Austin.",
        source: "visible_text",
        businessNames: ["Smith Roofing"],
    })

    assert.equal(result.accepted, false)
    assert.match(result.reason, /repeats|fragment/i)
})

test("person gate accepts real owner names from website owner context", () => {
    const result = deterministicPersonNameGate({
        candidateName: "Maria Lopez",
        text: "Run by Maria Lopez, owner and president.",
        source: "visible_text",
        businessNames: ["Austin Roof Co"],
    })

    assert.equal(result.accepted, true)
    assert.equal(result.name, "Maria Lopez")
})

test("NER can rescue plausible weak website names", async () => {
    const originalFetch = globalThis.fetch
    const originalEnabled = process.env.LEADGEN_NER_ENABLED
    const originalEndpoint = process.env.LEADGEN_NER_ENDPOINT
    process.env.LEADGEN_NER_ENABLED = "true"
    process.env.LEADGEN_NER_ENDPOINT = "https://ner.example.test/person-ner"
    globalThis.fetch = (async () => new Response(JSON.stringify({
        items: [{ id: "0", acceptedName: "Kyle Anderson", persons: ["Kyle Anderson"], confidence: 90 }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch

    try {
        const [result] = await gatePersonNameCandidates([{
            candidateName: "Kyle Anderson",
            text: "Kyle Anderson has served Austin homeowners for twenty years.",
            source: "visible_text",
            businessNames: ["Anderson Homes"],
        }])

        assert.equal(result.accepted, true)
        assert.equal(result.name, "Kyle Anderson")
        assert.equal(result.method, "ner")
    } finally {
        globalThis.fetch = originalFetch
        if (originalEnabled === undefined) delete process.env.LEADGEN_NER_ENABLED
        else process.env.LEADGEN_NER_ENABLED = originalEnabled
        if (originalEndpoint === undefined) delete process.env.LEADGEN_NER_ENDPOINT
        else process.env.LEADGEN_NER_ENDPOINT = originalEndpoint
    }
})

test("weak website names still need NER confirmation when configured", async () => {
    const originalFetch = globalThis.fetch
    const originalEnabled = process.env.LEADGEN_NER_ENABLED
    const originalEndpoint = process.env.LEADGEN_NER_ENDPOINT
    const originalRequire = process.env.LEADGEN_NER_REQUIRE_WEAK_WEBSITE
    process.env.LEADGEN_NER_ENABLED = "true"
    process.env.LEADGEN_NER_ENDPOINT = "https://ner.example.test/person-ner"
    process.env.LEADGEN_NER_REQUIRE_WEAK_WEBSITE = "true"
    globalThis.fetch = (async () => new Response(JSON.stringify({
        items: [{ id: "0", persons: [], confidence: 20 }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch

    try {
        const [result] = await gatePersonNameCandidates([{
            candidateName: "Kyle Anderson",
            text: "Kyle Anderson has served local homeowners for twenty years.",
            source: "visible_text",
            businessNames: ["Anderson Homes"],
        }])

        assert.equal(result.accepted, false)
        assert.match(result.reason, /NER did not confirm/)
    } finally {
        globalThis.fetch = originalFetch
        if (originalEnabled === undefined) delete process.env.LEADGEN_NER_ENABLED
        else process.env.LEADGEN_NER_ENABLED = originalEnabled
        if (originalEndpoint === undefined) delete process.env.LEADGEN_NER_ENDPOINT
        else process.env.LEADGEN_NER_ENDPOINT = originalEndpoint
        if (originalRequire === undefined) delete process.env.LEADGEN_NER_REQUIRE_WEAK_WEBSITE
        else process.env.LEADGEN_NER_REQUIRE_WEAK_WEBSITE = originalRequire
    }
})
