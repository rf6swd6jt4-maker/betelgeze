import { phaseLabel, type RelationshipPhase } from "@/lib/relationships"
import { pillTones, type PillTone } from "./pill-styles"
import styles from "./RelationshipStage.module.css"

const phaseTones: Record<RelationshipPhase, PillTone> = {
    lead: "sky",
    nurturing: "violet",
    potential_client: "amber",
    invoiced: "sky",
    onboarding: "amber",
    onboarding_complete: "emerald",
    fulfilment: "sky",
    retention: "violet",
    completed_lost: "neutral",
}

export function RelationshipStage({ phase, className = "" }: { phase: RelationshipPhase; className?: string }) {
    const colours = pillTones[phaseTones[phase]]
    return (
        <span style={{ backgroundColor: colours.border }} className={`inline-flex h-6 w-fit p-px ${styles.outer} ${className}`}>
            <span style={{ backgroundColor: colours.background, color: colours.text }} className={`inline-flex h-full items-center px-3.5 text-xs leading-4 ${styles.inner}`}>
                {phaseLabel(phase)}
            </span>
        </span>
    )
}
