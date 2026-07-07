export const LEADGEN_POLLING_SYSTEM_VERSION = "5.5.6"
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
    { version: "5.4.5", note: "Sunbiz import access and service-role validation." },
    { version: "5.4.6", note: "Sunbiz import progress logging and larger batches." },
    { version: "5.4.7", note: "Slim active-only Sunbiz bulk import defaults." },
    { version: "5.4.8", note: "Retired Supabase Sunbiz index from poll fan-out." },
    { version: "5.4.9", note: "Florida Sunbiz external shard lookup." },
    { version: "5.4.10", note: "Sunbiz statewide all-industry task fan-out fix." },
    { version: "5.4.11", note: "Florida county property appraiser and clerk record sources." },
    { version: "5.4.12", note: "Staged poll resume, reporting, and website fallback efficiency fix." },
    { version: "5.5", note: "California contractor owner identity pass with CSLB and external owner shards." },
    { version: "5.5.1", note: "California CSLB adapter cookie handling fix." },
    { version: "5.5.2", note: "California stable owner-source routing without live CSLB form dependency." },
    { version: "5.5.3", note: "California owner-identity recovery for strong website owners and exact CA shard matches." },
    { version: "5.5.4", note: "California owner-identity fallback crawl URL ordering and profile-URL filtering." },
    { version: "5.5.5", note: "California San Diego owner shards and CA poll console transparency." },
    { version: "5.5.6", note: "California San Diego task scheduling and multi-location seed balancing fix." },
] as const
