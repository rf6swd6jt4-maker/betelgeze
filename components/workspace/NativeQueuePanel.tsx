"use client"
import { PersonalWorkQueue } from "@/components/work-queue/PersonalWorkQueue"
import type { PersonalQueueSnapshot } from "@/lib/work-queue/server"
export default function NativeQueuePanel({data}:{data:PersonalQueueSnapshot}) { return <div className="mx-auto max-w-7xl px-4 pb-7 text-white sm:px-6"><PersonalWorkQueue data={data} /></div> }
