export type GhlCalendar = { id: string; name: string }
export type GhlCalendarEvent = { id: string; title: string; start: string; end: string; status: string }
export type GhlCalendarSnapshot = { calendars: GhlCalendar[]; timezone: string; calendarId: string | null; month: string; events: GhlCalendarEvent[] }
export type GhlCalendarState = { revision: string | null; snapshot: GhlCalendarSnapshot | null; refreshedAt: string | null; error: string | null; busy: boolean }
export const calendarErrors: Record<string, string> = {
    permissions: "Allow Calendars and Calendar Events read access in your GHL private integration, then try again.",
    credentials: "Check your GHL connection, then try again.",
    unavailable: "GHL could not be reached. Your saved calendar has been kept.",
    response: "GHL returned an incomplete calendar. Your saved calendar has been kept.",
    location: "This calendar does not belong to the connected GHL account.",
    rate_limit: "GHL is limiting requests. Please try again shortly.",
    busy: "A calendar update is already running. Try again shortly.",
    cooldown: "Please wait a few seconds before refreshing this month again.",
    changed: "The GHL connection changed. Reload the calendar before trying again.",
    credentials_missing: "Connect GHL to load its calendar.",
}
export function validMonth(value: unknown): value is string { return typeof value === "string" && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(value) }
export function shiftMonth(month: string, offset: number) { const [y,m] = month.split("-").map(Number); return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7) }
export function dateKey(value: string | Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) }
export function monthDays(month: string): string[] {
    const [y,m] = month.split("-").map(Number), first = new Date(Date.UTC(y,m-1,1)), start = 1-first.getUTCDay()
    return Array.from({length:42},(_,i)=>new Date(Date.UTC(y,m-1,start+i)).toISOString().slice(0,10))
}
// Calendar cells and provider query boundaries use the GHL location timezone, including DST.
export function midnightUtc(day: string, timezone: string): number {
    const target = Date.parse(day+"T00:00:00Z")
    let candidate=target
    const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"})
    for(let i=0;i<4;i++) { const p=Object.fromEntries(fmt.formatToParts(candidate).map(x=>[x.type,x.value])); const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`); candidate+=target-local }
    return candidate
}
export function monthWindow(month: string, timezone: string) { const days=monthDays(month); const end=new Date(Date.parse(days[41]+"T00:00:00Z")+86400000).toISOString().slice(0,10); return {start:midnightUtc(days[0],timezone),end:midnightUtc(end,timezone)} }
