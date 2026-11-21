import { SERVICE_STAGES, serviceStageLabel } from "@/lib/service-stages"
import { StageLabel } from "./RelationshipStage"

/** A service's stage: the same diamond-and-text label as RelationshipStage, in the service stage's own tone. */
export function ServiceStage({ stage, className = "" }: { stage: string | null; className?: string }) {
    return <StageLabel label={serviceStageLabel(stage)} tone={SERVICE_STAGES.find(s => s.key === stage)?.tone ?? "neutral"} className={className} />
}
