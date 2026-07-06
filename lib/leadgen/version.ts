export const LEADGEN_POLLING_SYSTEM_VERSION = "5.4.4"
export const LEADGEN_POLLING_SYSTEM_VERSION_LABEL = `v${LEADGEN_POLLING_SYSTEM_VERSION}`

export const LEADGEN_POLLING_SYSTEM_VERSION_HISTORY = [
    { version: "5.1", note: "Owner identity source coverage pass 1." },
    { version: "5.1.1", note: "Public-record source failure handling and circuit breaker fix." },
    { version: "5.2", note: "Owner identity source coverage pass 2." },
    { version: "5.3", note: "Owner identity source coverage pass 3." },
    { version: "5.4", note: "Sunbiz owner identity index pass." },
    { version: "5.4.1", note: "Sunbiz owner index import endpoint." },
    { version: "5.4.2", note: "Local Sunbiz owner index streaming importer." },
    { version: "5.4.3", note: "Resumable Sunbiz owner index import retries." },
    { version: "5.4.4", note: "Adaptive Sunbiz import batches and connectivity probe." },
] as const
