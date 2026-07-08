export type PersonNameCandidate = {
    name: string
    confidence: number
    sourceText: string
    reason: string
}

export type PersonNameOptions = {
    allowExtraction?: boolean
    allowAllCaps?: boolean
    ownerContext?: boolean
    minConfidence?: number
    contextNames?: Array<string | null | undefined>
    nameOrder?: "first_last" | "last_first" | "unknown"
}

export function extractPersonNameCandidate(value: string | null | undefined, options?: PersonNameOptions): PersonNameCandidate | null
export function normalisePersonName(value: string | null | undefined, options?: PersonNameOptions): string | null
export function isLikelyPersonName(value: string | null | undefined, options?: PersonNameOptions): boolean
export function maybeNormaliseLastNameFirstPersonName(value: string | null | undefined, options?: PersonNameOptions): string | null
