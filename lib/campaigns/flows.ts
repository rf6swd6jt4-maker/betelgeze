/**
 * Text flows (docs/text-flows.md): the shared model of a flow, used by the editor in the browser and by the worker on the
 * server. Labels and checks follow the Campaigns mockup's "Text flows".
 */
// @ts-expect-error Node's built-in TypeScript test runner requires the source extension.
import { campaignStageLabels, type CampaignStage } from "./model.ts"

export const FLOW_TRIGGERS = {
    new: "A lead comes in",
    hold: "They hold a time without paying",
    booked: "They book a time",
    noshow: "They are marked no-show",
    stage: "They move to a stage",
} as const
export type FlowTrigger = keyof typeof FLOW_TRIGGERS

export const FLOW_STOPS = [
    ["reply", "They reply", false],
    ["book", "They book a time", false],
    ["pay", "They pay", false],
    ["closed", "They are marked Sold or Lost", true],
    ["optout", "They text STOP", true],
] as const

export const FLOW_ACTIONS = {
    task: "Add a call task for their setter",
    stage: "Move them to a stage",
    assign: "Assign them to a setter",
    confirm: "Mark the appointment confirmed",
} as const
export type FlowAction = keyof typeof FLOW_ACTIONS

export const FLOW_CONDITIONS = {
    notbooked: "They haven't booked",
    notreplied: "They haven't replied",
    notpaid: "They haven't paid",
    stillbooked: "Their appointment is still on",
} as const
export type FlowCondition = keyof typeof FLOW_CONDITIONS

export const FLOW_REPLY_ACTIONS = {
    confirm: "Mark the appointment confirmed",
    task: "Add a call task",
    stop: "Stop this flow",
    lost: "Move them to Lost",
} as const
export type FlowReplyAction = keyof typeof FLOW_REPLY_ACTIONS

export const FLOW_WINDOW_DAYS = { every: "Every day", mon_sat: "Monday to Saturday", weekdays: "Weekdays only" } as const
export type FlowWindowDays = keyof typeof FLOW_WINDOW_DAYS
/** Sending hours offered in the editor, as minutes after midnight. */
export const FLOW_WINDOW_STARTS = [420, 480, 540] as const
export const FLOW_WINDOW_ENDS = [1020, 1080, 1140, 1200, 1260] as const

export const FLOW_FIELD_INFO = {
    first_name: "Their first name",
    business: "Their business name",
    setter_first_name: "Their setter's first name",
    booking_link: "Their source's booking page, with their details filled in",
    payment_link: "The page that pays for their held time",
    hold_until: "When their held time is released",
    appointment_time: "Day and time of their appointment",
    meeting_details: "The meeting link, or that you will call them",
} as const
export type FlowField = keyof typeof FLOW_FIELD_INFO

export type FlowImage = { path: string; fileName: string; mimeType: string; size: number }
export type FlowStep =
    | { id: string; kind: "text"; body: string; image: FlowImage | null }
    | { id: string; kind: "wait"; mode: "for" | "next" | "before" | "hold"; amount: number; unit: "minutes" | "hours" | "days" }
    | { id: string; kind: "if"; condition: FlowCondition }
    | { id: string; kind: "act"; action: FlowAction; value: string | null }
export type FlowReply = { word: string; action: FlowReplyAction }

export type FlowSettings = {
    id: string
    name: string
    enabled: boolean
    trigger: FlowTrigger
    triggerStage: CampaignStage | null
    /** null: every source of the campaign. */
    sourceIds: string[] | null
    stopOnReply: boolean
    stopOnBook: boolean
    stopOnPay: boolean
    windowStart: number
    windowEnd: number
    windowDays: FlowWindowDays
    steps: FlowStep[]
    replies: FlowReply[]
}

export type FlowSourceFacts = { id: string; tag: string; pays: boolean; books: boolean }

export const FLOW_TEXT_LIMIT = 1600
export const FLOW_MAX_STEPS = 40
export const FLOW_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"] as const
/** SignalHouse: carriers accept different sizes; under 500 KB is safe everywhere. */
export const FLOW_IMAGE_MAX_BYTES = 500 * 1024
const STEP_ID = /^[A-Za-z0-9_-]{1,40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const has = <T extends Record<string, unknown>>(map: T, key: unknown): key is keyof T => typeof key === "string" && Object.prototype.hasOwnProperty.call(map, key)

export function newStepId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function defaultStep(kind: FlowStep["kind"]): FlowStep {
    const id = newStepId()
    if (kind === "text") return { id, kind, body: "", image: null }
    if (kind === "wait") return { id, kind, mode: "for", amount: 1, unit: "days" }
    if (kind === "if") return { id, kind, condition: "notbooked" }
    return { id, kind, action: "task", value: null }
}

/** Reads stored or submitted steps. Anything malformed is dropped, so a bad step never reaches the worker. */
export function parseFlowSteps(value: unknown): FlowStep[] {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    const steps: FlowStep[] = []
    for (const raw of value.slice(0, FLOW_MAX_STEPS)) {
        const item = record(raw)
        const id = typeof item.id === "string" && STEP_ID.test(item.id) && !seen.has(item.id) ? item.id : null
        if (!id) continue
        seen.add(id)
        if (item.kind === "text") {
            const image = record(item.image)
            const validImage = typeof image.path === "string" && /^[0-9a-f-]{36}\/campaigns\/flows\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|gif)$/.test(image.path)
                && typeof image.fileName === "string" && FLOW_IMAGE_TYPES.includes(image.mimeType as typeof FLOW_IMAGE_TYPES[number])
                && typeof image.size === "number" && image.size > 0 && image.size <= FLOW_IMAGE_MAX_BYTES
            steps.push({ id, kind: "text", body: typeof item.body === "string" ? item.body.slice(0, FLOW_TEXT_LIMIT) : "", image: validImage ? { path: image.path as string, fileName: String(image.fileName).slice(0, 120), mimeType: image.mimeType as string, size: image.size as number } : null })
        } else if (item.kind === "wait") {
            const mode = item.mode === "next" || item.mode === "before" || item.mode === "hold" ? item.mode : "for"
            const unit = item.unit === "minutes" || item.unit === "hours" ? item.unit : "days"
            const amount = Math.min(mode === "before" ? 168 : unit === "minutes" ? 1440 : unit === "hours" ? 720 : 90, Math.max(1, Math.round(Number(item.amount) || 1)))
            steps.push({ id, kind: "wait", mode, amount, unit: mode === "before" ? "hours" : unit })
        } else if (item.kind === "if") {
            steps.push({ id, kind: "if", condition: has(FLOW_CONDITIONS, item.condition) ? item.condition : "notbooked" })
        } else if (item.kind === "act") {
            const action = has(FLOW_ACTIONS, item.action) ? item.action : "task"
            const value = typeof item.value === "string" ? item.value : null
            steps.push({ id, kind: "act", action, value: action === "stage" ? (value && has(campaignStageLabels, value) && value !== "paid_not_booked" && value !== "booked" ? value : "lost") : action === "assign" ? (value && UUID.test(value) ? value : null) : null })
        }
    }
    return steps
}

export function parseFlowReplies(value: unknown): FlowReply[] {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    return value.slice(0, 20).flatMap(raw => {
        const item = record(raw)
        const word = typeof item.word === "string" ? item.word.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) : ""
        if (!word || seen.has(word) || RESERVED_WORDS.has(word) || !has(FLOW_REPLY_ACTIONS, item.action)) return []
        seen.add(word)
        return [{ word, action: item.action }]
    })
}

/** STOP and its variants, and HELP, are carriers' words: SignalHouse answers them, and no flow may reuse them. */
export const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"])
export const RESERVED_WORDS = new Set([...STOP_WORDS, "HELP", "INFO", "START", "UNSTOP"])

/** Does this flow start with (or hang off) an appointment? */
export function flowHasAppointment(flow: Pick<FlowSettings, "trigger" | "triggerStage">) {
    return flow.trigger === "booked" || flow.trigger === "noshow" || (flow.trigger === "stage" && (flow.triggerStage === "booked" || flow.triggerStage === "showed" || flow.triggerStage === "no_show"))
}

/** The fields a flow's texts may use: what its leads have when it starts. */
export function flowFields(flow: Pick<FlowSettings, "trigger" | "triggerStage">): FlowField[] {
    return ["first_name", "business", "setter_first_name", "booking_link",
        ...(flow.trigger === "hold" ? ["appointment_time", "hold_until", "payment_link"] as const : []),
        ...(flowHasAppointment(flow) ? ["appointment_time", "meeting_details"] as const : [])]
}

/** The sources a flow applies to; hold flows only to sources that take payment. */
export function flowSources(flow: Pick<FlowSettings, "sourceIds" | "trigger">, sources: FlowSourceFacts[]) {
    return (flow.sourceIds === null ? sources : sources.filter(source => flow.sourceIds!.includes(source.id))).filter(source => flow.trigger !== "hold" || source.pays)
}

const fieldNames = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))]

/** What must be fixed before a flow can be switched on. */
export function flowWarnings(flow: FlowSettings, sources: FlowSourceFacts[]) {
    const warnings: string[] = []
    const fields: string[] = flowFields(flow)
    const applies = flowSources(flow, sources)
    flow.steps.forEach((step, index) => {
        const no = index + 1
        if (step.kind === "text") {
            if (!step.body.trim()) warnings.push(`Step ${no} has no text yet.`)
            for (const name of fieldNames(step.body).filter(name => !fields.includes(name))) {
                warnings.push(has(FLOW_FIELD_INFO, name) ? `Step ${no} uses {${name}}, which leads don't have when this flow starts.` : `Step ${no} uses {${name}}, which isn't a field.`)
            }
            if (fieldNames(step.body).includes("booking_link") && applies.some(source => !source.books)) warnings.push(`Step ${no} uses {booking_link}, but ${applies.filter(source => !source.books).map(source => source.tag).join(", ")} has no booking page.`)
        }
        if (step.kind === "wait" && step.mode === "before" && !flowHasAppointment(flow)) warnings.push(`Step ${no} waits for the appointment, but this flow doesn't start with a booking.`)
        if (step.kind === "wait" && step.mode === "hold" && flow.trigger !== "hold") warnings.push(`Step ${no} waits for a hold, but this flow doesn't start with one.`)
        if (step.kind === "if" && step.condition === "stillbooked" && !flowHasAppointment(flow)) warnings.push(`Step ${no} checks the appointment, but this flow doesn't start with a booking.`)
        if (step.kind === "act" && step.action === "assign" && !step.value) warnings.push(`Step ${no} assigns a setter but doesn't say who.`)
        if (step.kind === "act" && step.action === "confirm" && !flowHasAppointment(flow)) warnings.push(`Step ${no} confirms the appointment, but this flow doesn't start with a booking.`)
    })
    if (!flow.steps.some(step => step.kind === "text")) warnings.push("This flow sends no texts yet.")
    if (!applies.length) warnings.push(flow.trigger === "hold" ? "None of the picked sources takes payment, so nobody holds a time." : "Pick at least one source.")
    if (flow.replies.some(reply => reply.action === "confirm") && !flowHasAppointment(flow)) warnings.push("A reply word confirms the appointment, but this flow doesn't start with a booking.")
    return warnings
}

// GSM-7 (3GPP 23.038) basic set; the extension characters count twice.
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
const GSM_EXTENDED = "^{}\\[~]|€"

/** Characters and billed segments for one text: 160/153 per segment in GSM-7, 70/67 with emoji or curly quotes. */
export function smsSegments(text: string) {
    const chars = [...text]
    const gsm = chars.every(char => GSM_BASIC.includes(char) || GSM_EXTENDED.includes(char))
    const length = gsm ? chars.reduce((sum, char) => sum + (GSM_EXTENDED.includes(char) ? 2 : 1), 0) : chars.length
    const per = gsm ? (length <= 160 ? 160 : 153) : (length <= 70 ? 70 : 67)
    return { length, segments: Math.max(1, Math.ceil(length / per)), gsm }
}

/** Fills `{field}` placeholders; unknown or missing fields are left as written so a preview shows what is wrong. */
export function fillFlowText(text: string, values: Partial<Record<FlowField, string | null>>) {
    return text.replace(/\{(\w+)\}/g, (match, name: string) => has(FLOW_FIELD_INFO, name) && values[name] ? values[name]! : match)
}

export function unfilledFields(text: string) {
    return fieldNames(text)
}

export const minuteText = (minute: number) => {
    const hour = Math.floor(minute / 60) % 24, rest = minute % 60
    return `${hour % 12 || 12}:${String(rest).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`
}

export function waitText(step: Extract<FlowStep, { kind: "wait" }>) {
    if (step.mode === "before") return `until ${step.amount} hour${step.amount === 1 ? "" : "s"} before the appointment`
    if (step.mode === "hold") return "until the hold runs out"
    if (step.mode === "next") return "until 9:00 AM the next day"
    return `${step.amount} ${step.amount === 1 ? step.unit.replace(/s$/, "") : step.unit}`
}

export function actionText(step: Extract<FlowStep, { kind: "act" }>, setterName?: (id: string) => string | null) {
    if (step.action === "stage") return `Move them to ${step.value && has(campaignStageLabels, step.value) ? campaignStageLabels[step.value] : "a stage"}`
    if (step.action === "assign") return `Assign them to ${(step.value && setterName?.(step.value)) || "a setter"}`
    return FLOW_ACTIONS[step.action]
}

export function stepSummary(step: FlowStep, setterName?: (id: string) => string | null) {
    if (step.kind === "text") return `${step.image ? "Picture and text: " : ""}${step.body.trim() ? step.body : "Empty text"}`
    if (step.kind === "wait") return waitText(step)
    if (step.kind === "if") return `${FLOW_CONDITIONS[step.condition].toLowerCase()}, or the flow ends`
    return actionText(step, setterName)
}

export function triggerText(flow: Pick<FlowSettings, "trigger" | "triggerStage">) {
    return `${FLOW_TRIGGERS[flow.trigger]}${flow.trigger === "stage" && flow.triggerStage ? ` · ${campaignStageLabels[flow.triggerStage]}` : ""}`
}

// ---------- Sending hours in the lead's time zone ----------

const ZONES: Record<string, string> = {}
const zone = (name: string, codes: string) => { for (const code of codes.split(" ")) ZONES[code] = name }
zone("America/New_York", "203 475 860 959 302 202 771 239 305 321 352 386 407 561 656 689 727 754 772 786 813 863 904 941 954 229 404 470 478 678 706 762 770 912 943 260 317 463 574 765 930 502 606 859 207 240 301 410 443 667 339 351 413 508 617 774 781 857 978 231 248 269 313 517 586 616 679 734 810 947 989 603 201 551 609 640 732 848 856 862 908 973 212 315 332 347 363 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934 252 336 472 704 743 828 910 919 980 984 216 220 234 283 326 330 380 419 436 440 513 567 614 740 937 215 223 267 272 412 445 484 570 582 610 717 724 814 835 878 401 803 839 843 854 864 423 865 802 276 434 540 571 686 703 757 804 826 948 304 681")
zone("America/Chicago", "205 251 256 334 659 938 327 479 501 870 217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872 219 270 364 319 515 563 641 712 316 620 913 225 318 337 504 985 218 320 507 612 651 763 924 952 228 601 662 769 314 417 557 573 636 660 816 975 402 531 405 539 572 580 918 615 629 731 901 931 210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979 262 274 353 414 534 608 715 920")
zone("America/Phoenix", "480 520 602 623 928")
zone("America/Denver", "303 719 720 970 983 208 986 406 505 575 385 435 801 307 915")
zone("America/Los_Angeles", "209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951 702 725 775 458 503 541 971 206 253 360 425 509 564")
zone("America/Anchorage", "907")
zone("Pacific/Honolulu", "808")

/** The lead's time zone from their area code; split or unknown codes use their source's zone. */
export function leadTimeZone(phoneE164: string, fallback: string) {
    const match = /^\+1(\d{3})/.exec(phoneE164)
    return (match && ZONES[match[1]]) || fallback
}

function zonedParts(date: Date, timeZone: string) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(date).map(part => [part.type, part.value]))
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) }
}

/** The instant a wall-clock time happens in a zone (DST-safe for the hours flows use). */
export function zonedInstant(year: number, month: number, day: number, minute: number, timeZone: string) {
    const guess = Date.UTC(year, month - 1, day, Math.floor(minute / 60), minute % 60)
    let instant = guess
    for (let i = 0; i < 2; i++) {
        const parts = zonedParts(new Date(instant), timeZone)
        const seen = Date.UTC(parts.year, parts.month - 1, parts.day, Math.floor(parts.minute / 60), parts.minute % 60)
        instant += guess - seen
    }
    return new Date(instant)
}

const dayAllowed = (weekday: number, days: FlowWindowDays) => days === "every" || (days === "mon_sat" ? weekday !== 0 : weekday >= 1 && weekday <= 5)

/** Now, if it is inside the sending hours in that zone; otherwise the next opening. */
export function nextSendingTime(now: Date, window: Pick<FlowSettings, "windowStart" | "windowEnd" | "windowDays">, timeZone: string) {
    const today = zonedParts(now, timeZone)
    if (dayAllowed(today.weekday, window.windowDays) && today.minute >= window.windowStart && today.minute < window.windowEnd) return now
    for (let offset = 0; offset < 9; offset++) {
        const day = zonedParts(new Date(Date.UTC(today.year, today.month - 1, today.day + offset, 12)), "UTC")
        const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
        if (!dayAllowed(weekday, window.windowDays)) continue
        const opening = zonedInstant(day.year, day.month, day.day, window.windowStart, timeZone)
        if (opening.getTime() > now.getTime()) return opening
    }
    return new Date(now.getTime() + 86_400_000)
}

/** 9:00 AM the next day in that zone. */
export function nextMorning(now: Date, timeZone: string) {
    const today = zonedParts(now, timeZone)
    const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12))
    return zonedInstant(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), 540, timeZone)
}

export function waitUntil(step: Extract<FlowStep, { kind: "wait" }>, now: Date, context: { timeZone: string; startsAt: string | null; heldUntil: string | null }) {
    if (step.mode === "next") return nextMorning(now, context.timeZone)
    if (step.mode === "before") return context.startsAt ? new Date(Date.parse(context.startsAt) - step.amount * 3_600_000) : now
    if (step.mode === "hold") return context.heldUntil ? new Date(Date.parse(context.heldUntil)) : now
    const unit = step.unit === "minutes" ? 60_000 : step.unit === "hours" ? 3_600_000 : 86_400_000
    return new Date(now.getTime() + step.amount * unit)
}
