"use client"

import { useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { LoadingOverlay } from "@/components/LoadingOverlay"

function TimedPendingOverlay() {
    const [timedOut, setTimedOut] = useState(false)

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setTimedOut(true)
        }, 45000)

        return () => window.clearTimeout(timeout)
    }, [])

    return timedOut ? null : <LoadingOverlay />
}

export function FormPendingOverlay() {
    const { pending } = useFormStatus()

    return pending ? <TimedPendingOverlay /> : null
}
