import { SERVICE_STAGES, serviceStageLabel } from "@/lib/service-stages"
import { pillTones } from "./pill-styles"
import styles from "./RelationshipStage.module.css"

/** Lifecycle geometry shared with the legacy stage control during cutover. */
export function ServiceStage({ stage, className = "" }: { stage: string | null; className?: string }) {
    const colours = pillTones[SERVICE_STAGES.find(s => s.key === stage)?.tone ?? "neutral"]
    return <span style={{ backgroundColor: colours.border }} className={`inline-flex h-6 w-fit shrink-0 p-px ${styles.outer} ${className}`}>
        <span style={{ backgroundColor: colours.background, color: colours.text }} className={`inline-flex h-full items-center whitespace-nowrap px-3.5 text-xs leading-4 ${styles.inner}`}>{serviceStageLabel(stage)}</span>
    </span>
}
