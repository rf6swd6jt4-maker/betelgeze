import type { ReactNode } from "react"

export type CommunicationMethod = "meta_whatsapp" | "twilio_sms" | "phone"

const labels: Record<CommunicationMethod, string> = {
    meta_whatsapp: "WhatsApp",
    twilio_sms: "Twilio SMS",
    phone: "Phone",
}

function MarkFrame({ colour, children }: { colour: string; children: ReactNode }) {
    return <span aria-hidden="true" style={{ backgroundColor: colour }} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white">{children}</span>
}

export function CommunicationMethodMark({ method, className = "" }: { method: CommunicationMethod; className?: string }) {
    if (method === "meta_whatsapp") return <span className={className}><MarkFrame colour="#25D366"><svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M7.2 6.7c.4-.5.8-.5 1.2-.1l1.2 1.8c.2.4.1.7-.2 1l-.7.7c.8 1.7 2 2.9 3.7 3.7l.7-.7c.3-.3.7-.4 1-.2l1.8 1.2c.4.3.4.8-.1 1.2-.8.7-1.8 1-2.8.8-3.8-.8-6.8-3.8-7.6-7.6-.2-1 .1-2 .8-2.8Z" fill="currentColor"/><path d="M5.2 18.8 6 16.5a7.4 7.4 0 1 1 2 1.7l-2.8.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg></MarkFrame></span>
    if (method === "twilio_sms") return <span className={className}><MarkFrame colour="#F22F46"><svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><circle cx="6.5" cy="6.5" r="2"/><circle cx="13.5" cy="6.5" r="2"/><circle cx="6.5" cy="13.5" r="2"/><circle cx="13.5" cy="13.5" r="2"/></svg></MarkFrame></span>
    return <span className={className}><MarkFrame colour="#525252"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><path d="M7 4 5.5 5.5c-1.2 1.2.2 4.6 3.2 7.6s6.4 4.4 7.6 3.2L18 14.6l-3.2-2.1-1.4 1.4c-1-.5-2.8-2.3-3.3-3.3l1.4-1.4L9.4 6Z" /></svg></MarkFrame></span>
}

export function CommunicationMethodLabel({ method, label = labels[method] }: { method: CommunicationMethod; label?: string }) {
    return <span className="inline-flex min-w-0 items-center gap-2"><CommunicationMethodMark method={method} /><span className="truncate">{label}</span></span>
}

export function communicationMethodLabel(method: CommunicationMethod) {
    return labels[method]
}
