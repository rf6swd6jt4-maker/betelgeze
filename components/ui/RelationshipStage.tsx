import { phaseLabel, type RelationshipPhase } from "@/lib/relationships"
import styles from "./RelationshipStage.module.css"

const phaseClasses: Record<RelationshipPhase, { edge: string; face: string; text: string }> = {
    lead: { edge: "bg-sky-800/70", face: "bg-sky-950", text: "text-sky-200" },
    nurturing: { edge: "bg-violet-800/70", face: "bg-violet-950", text: "text-violet-200" },
    potential_client: { edge: "bg-amber-800/70", face: "bg-amber-950", text: "text-amber-200" },
    invoiced: { edge: "bg-sky-800/70", face: "bg-sky-950", text: "text-sky-200" },
    onboarding: { edge: "bg-amber-800/70", face: "bg-amber-950", text: "text-amber-200" },
    onboarding_complete: { edge: "bg-emerald-800/70", face: "bg-emerald-950", text: "text-emerald-200" },
    fulfilment: { edge: "bg-sky-800/70", face: "bg-sky-950", text: "text-sky-200" },
    retention: { edge: "bg-violet-800/70", face: "bg-violet-950", text: "text-violet-200" },
    completed_lost: { edge: "bg-neutral-700", face: "bg-neutral-900", text: "text-neutral-300" },
}

export function RelationshipStage({ phase, className = "" }: { phase: RelationshipPhase; className?: string }) {
    const tone = phaseClasses[phase]
    return (
        <span className={`inline-flex w-fit p-px ${styles.shape} ${tone.edge} ${className}`}>
            <span className={`inline-flex min-h-6 items-center px-3.5 py-1 text-xs leading-4 ${styles.shape} ${tone.face} ${tone.text}`}>
                {phaseLabel(phase)}
            </span>
        </span>
    )
}
