/* eslint-disable @next/next/no-img-element */

import {
    FormResponse,
    OnboardingFormDefinition,
    StoredUpload,
} from "@/lib/onboarding/forms"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

type FormResponsesSummaryProps = {
    responses: {
        step_key: string
        response: FormResponse
        updated_at: string
    }[]
    formsByStep: Record<string, OnboardingFormDefinition>
}

function isStoredUploadArray(value: unknown): value is StoredUpload[] {
    return (
        Array.isArray(value) &&
        value.every(
            (item) =>
                item &&
                typeof item === "object" &&
                "path" in item &&
                "name" in item
        )
    )
}

export async function FormResponsesSummary({
    responses,
    formsByStep,
}: FormResponsesSummaryProps) {
    if (responses.length === 0) {
        return null
    }

    return (
        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm font-medium text-neutral-300">
                Submitted form responses
            </p>

            <div className="mt-6 space-y-6">
                {await Promise.all(
                    responses.map(async (row) => {
                        const form = formsByStep[row.step_key]

                        if (!form) return null

                        return (
                            <div
                                key={row.step_key}
                                className="rounded-2xl bg-neutral-950 p-5"
                            >
                                <div className="flex flex-col justify-between gap-2 sm:flex-row">
                                    <p className="font-medium text-white">
                                        {form.title}
                                    </p>
                                    <p className="text-xs text-neutral-500">
                                        Updated{" "}
                                        {new Date(
                                            row.updated_at
                                        ).toLocaleString("en-IE", {
                                            dateStyle: "medium",
                                            timeStyle: "short",
                                        })}
                                    </p>
                                </div>

                                <div className="mt-4 space-y-4">
                                    {await Promise.all(
                                        form.fields.map(async (field) => {
                                            const value =
                                                row.response[field.name]

                                            if (!value) return null

                                            if (
                                                isStoredUploadArray(value) &&
                                                value.length > 0
                                            ) {
                                                const uploads =
                                                    await Promise.all(
                                                        value.map(
                                                            async (file) => ({
                                                                file,
                                                                url: await createUploadSignedUrl(
                                                                    file.path
                                                                ),
                                                            })
                                                        )
                                                    )

                                                return (
                                                    <div key={field.name}>
                                                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                                            {field.label}
                                                        </p>
                                                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                                            {uploads.map(
                                                                ({
                                                                    file,
                                                                    url,
                                                                }) => (
                                                                    <a
                                                                        key={
                                                                            file.path
                                                                        }
                                                                        href={
                                                                            url ??
                                                                            "#"
                                                                        }
                                                                        className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                    >
                                                                        {url &&
                                                                        file.kind ===
                                                                            "image" ? (
                                                                            <img
                                                                                src={
                                                                                    url
                                                                                }
                                                                                alt=""
                                                                                className="h-32 w-full object-cover"
                                                                            />
                                                                        ) : (
                                                                            <div className="flex h-24 items-center justify-center px-4 text-center text-sm text-neutral-300">
                                                                                {
                                                                                    file.name
                                                                                }
                                                                            </div>
                                                                        )}
                                                                        <p className="truncate px-3 py-2 text-xs text-neutral-400">
                                                                            {
                                                                                file.name
                                                                            }
                                                                        </p>
                                                                    </a>
                                                                )
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            }

                                            if (typeof value !== "string") {
                                                return null
                                            }

                                            return (
                                                <div key={field.name}>
                                                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                                        {field.label}
                                                    </p>
                                                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-neutral-200">
                                                        {value}
                                                    </p>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </section>
    )
}
