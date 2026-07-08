import { maybeNormaliseLastNameFirstPersonName } from "./person-name-normalizer.js"

function compact(value) {
    return (value ?? "").replace(/\s+/g, " ").trim()
}

export function normaliseSunbizPersonName(value) {
    const raw = value ?? ""
    const clean = compact(raw)
    if (!clean) return null
    const fixedWidthParts = raw
        .trim()
        .split(/\s{2,}/)
        .map(compact)
        .filter(Boolean)
    if (fixedWidthParts.length >= 2 && fixedWidthParts.length <= 4) {
        const reordered = [...fixedWidthParts.slice(1), fixedWidthParts[0]].join(" ")
        return maybeNormaliseLastNameFirstPersonName(reordered, { allowExtraction: true, allowAllCaps: true, ownerContext: true, minConfidence: 55, nameOrder: "first_last" })
    }
    return maybeNormaliseLastNameFirstPersonName(clean, { allowExtraction: true, allowAllCaps: true, ownerContext: true, minConfidence: 55, nameOrder: "unknown" })
}
