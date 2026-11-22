import { createHash, randomUUID } from "node:crypto"

export const TEST_LEAD_CONSENT = "Test lead sent from Betelgeze by a workspace owner or admin to try this source. No texts are sent to it."

/**
 * A synthetic submission for "Send a test lead" on a source in Testing (docs/campaign-booking.md). It goes through
 * the same intake function as a real form, so it is a Test lead with its own submission ID that opens the booking
 * page. The phone is a 555 number fixed per source, so repeated tests update one lead instead of adding many.
 */
export function testLeadInput(sourceId: string, actorId: string) {
    const digits = BigInt(`0x${createHash("sha256").update(`campaign-test:${sourceId}`).digest("hex").slice(0, 12)}`).toString().slice(-7).padStart(7, "0")
    return {
        submission_id: randomUUID(),
        offer: "test",
        answers: [{ id: "test", question: "Test lead", answer: "Sent from Betelgeze" }],
        first_name: "Test",
        last_name: "Lead",
        company: "Test business",
        phone_e164: `+1555${digits}`,
        email: null,
        consent_text: TEST_LEAD_CONSENT,
        consent_sha256: createHash("sha256").update(TEST_LEAD_CONSENT).digest("hex"),
        attribution: { utm_source: "betelgeze_test" },
        ip_hmac: createHash("sha256").update(`campaign-test-actor:${actorId}`).digest("hex"),
        user_agent: "Betelgeze test lead",
    }
}
