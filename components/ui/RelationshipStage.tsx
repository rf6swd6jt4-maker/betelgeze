import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { phaseLabel, type RelationshipPhase } from "@/lib/relationship-phases"
import { pillTones, type PillTone } from "./pill-styles"

/** Timeline (Gantt) colours: one distinct tone per parent stage. Not used for the stage label below. */
export const relationshipPhaseTones: Record<RelationshipPhase, PillTone> = {
    lead: "sky",
    nurturing: "violet",
    potential_client: "amber",
    sold: "emerald",
    invoiced: "yellow",
    onboarding: "violet",
    onboarding_review: "emerald",
    fulfilment: "red",
    retention: "neutral",
    completed_lost: "neutral",
}

export function relationshipPhaseColours(phase: RelationshipPhase) {
    return pillTones[relationshipPhaseTones[phase]]
}

/**
 * The stage label's diamond follows the journey rather than the timeline palette, so it never borrows a status
 * meaning: quiet before the sale, violet once sold, amber while onboarding, green once delivering. Red is never a stage.
 */
export const relationshipStageMarks: Record<RelationshipPhase, PillTone> = {
    lead: "neutral",
    nurturing: "sky",
    potential_client: "sky",
    sold: "violet",
    invoiced: "violet",
    onboarding: "amber",
    onboarding_review: "amber",
    fulfilment: "emerald",
    retention: "emerald",
    completed_lost: "neutral",
}

/** Shared by RelationshipStage and ServiceStage: a Betelgeze diamond in the stage's colour, then plain text. */
export function StageLabel({ label, tone, className = "" }: { label: string; tone: PillTone; className?: string }) {
    return <span className={`inline-flex w-fit shrink-0 items-center gap-2 whitespace-nowrap text-sm text-neutral-200 ${className}`}>
        <span style={{ color: pillTones[tone].mark }} className="inline-flex"><BetelgezeStatusMark className="bg-current" /></span>
        {label}
    </span>
}

export function RelationshipStage({ phase, className = "" }: { phase: RelationshipPhase; className?: string }) {
    return <StageLabel label={phaseLabel(phase)} tone={relationshipStageMarks[phase]} className={className} />
}
