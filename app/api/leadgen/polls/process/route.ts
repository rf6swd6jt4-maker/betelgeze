import { leadgenPausedResponse } from "@/lib/leadgen/availability"

// Old clients get an explicit denial without request parsing or data access.
export function POST() {
    return leadgenPausedResponse()
}
