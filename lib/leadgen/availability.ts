// Historical records remain; old write URLs receive a terminal response.
export const LEADGEN_PAUSED_MESSAGE = "Lead Gen has been retired. Saved companies and poll history remain available to administrators; no new polls, imports, or changes are accepted."

export function leadgenPausedResponse() {
    return Response.json({ status: "paused", error: LEADGEN_PAUSED_MESSAGE }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
    })
}
