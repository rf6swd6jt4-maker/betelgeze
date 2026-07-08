import {
    GIVEN_NAME_COUNT_DATA,
    NAME_FREQUENCY_SOURCE,
    SURNAME_COUNT_DATA,
} from "./name-frequency-data.generated.js"

let lookup = null

function parseCountData(data) {
    const map = new Map()
    if (!data) return map
    for (const pair of data.split("|")) {
        const separator = pair.lastIndexOf(":")
        if (separator <= 0) continue
        const name = pair.slice(0, separator)
        const count = Number(pair.slice(separator + 1))
        if (name && Number.isFinite(count) && count > 0) map.set(name, count)
    }
    return map
}

function frequencyLookup() {
    if (!lookup) {
        lookup = {
            given: parseCountData(GIVEN_NAME_COUNT_DATA),
            surname: parseCountData(SURNAME_COUNT_DATA),
        }
    }
    return lookup
}

export function nameFrequencySource() {
    return NAME_FREQUENCY_SOURCE
}

export function givenNameCount(key) {
    if (!key) return 0
    return frequencyLookup().given.get(key) ?? 0
}

export function surnameCount(key) {
    if (!key) return 0
    return frequencyLookup().surname.get(key) ?? 0
}

export function nameFrequencyCounts(key) {
    return {
        given: givenNameCount(key),
        surname: surnameCount(key),
    }
}
