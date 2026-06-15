"use client"

import { useFormStatus } from "react-dom"
import { LoadingOverlay } from "@/components/LoadingOverlay"

export function FormPendingOverlay() {
    const { pending } = useFormStatus()

    return pending ? <LoadingOverlay /> : null
}
