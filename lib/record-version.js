/** Preserve PostgreSQL microseconds while normalizing equivalent UTC strings.
 * @param {string} value
 */
export function recordVersionKey(value) {
    const time = Date.parse(value)
    if (!Number.isFinite(time)) return value
    const fraction = /[T ]\d{2}:\d{2}:\d{2}(?:\.(\d+))?/.exec(value)?.[1] ?? ""
    return `${new Date(time).toISOString().slice(0, 19)}.${fraction.padEnd(6, "0").slice(0, 6)}`
}

/** @param {string} left @param {string} right */
export function recordVersionAfter(left, right) { return recordVersionKey(left) > recordVersionKey(right) }
