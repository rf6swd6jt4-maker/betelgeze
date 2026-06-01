/* eslint-disable @next/next/no-img-element */

import {
    FormResponse,
    OnboardingFormDefinition,
    StoredUpload,
} from "@/lib/onboarding/forms"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { AdminCopyButton } from "@/components/admin/AdminCopyButton"
import { FileActions } from "@/components/admin/FileActions"

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

function formatFileSize(size: number) {
    if (size < 1024 * 1024) {
        return `${Math.max(1, Math.round(size / 1024))} KB`
    }

    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function summarizeResponse(
    form: OnboardingFormDefinition,
    response: FormResponse
) {
    return form.fields
        .map((field) => {
            const value = response[field.name]

            if (!value) return null

            if (isStoredUploadArray(value)) {
                return `${field.label}: ${value.map((file) => file.name).join(", ")}`
            }

            if (typeof value === "string" && value.trim()) {
                return `${field.label}: ${value.trim()}`
            }

            return null
        })
        .filter(Boolean)
        .join("\n\n")
}

export async function FormResponsesSummary({
    responses,
    formsByStep,
}: FormResponsesSummaryProps) {
    const visibleResponses = responses
        .map((row) => ({
            row,
            form: formsByStep[row.step_key],
        }))
        .filter((item): item is typeof item & { form: OnboardingFormDefinition } =>
            Boolean(item.form)
        )

    if (visibleResponses.length === 0) {
        return null
    }

    const uploadPaths = visibleResponses.flatMap(({ row, form }) =>
        form.fields.flatMap((field) => {
            const value = row.response[field.name]

            return isStoredUploadArray(value)
                ? value.map((file) => file.path)
                : []
        })
    )

    const signedUrls = await createUploadSignedUrls(uploadPaths)

    return (
        <section className="mt-6 rounded-lg border border-neutral-800 bg-neutral-900">
            <div className="flex flex-col justify-between gap-3 border-b border-neutral-800 px-4 py-3 sm:flex-row sm:items-center">
                <div>
                    <h2 className="text-sm font-semibold text-white">
                        Submitted responses
                    </h2>
                    <p className="mt-1 text-xs text-neutral-500">
                        Review answers, copy text, and download or share files.
                    </p>
                </div>

                <span className="rounded-full bg-neutral-950 px-2.5 py-1 text-xs text-neutral-400">
                    {visibleResponses.length} form
                    {visibleResponses.length === 1 ? "" : "s"}
                </span>
            </div>

            <div className="divide-y divide-neutral-800">
                {visibleResponses.map(({ row, form }) => {
                    const responseText = summarizeResponse(form, row.response)

                    return (
                        <details
                            key={row.step_key}
                            className="group"
                            open
                        >
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-800/60">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-white">
                                        {form.title}
                                    </p>
                                    <p className="mt-1 text-xs text-neutral-500">
                                        Updated{" "}
                                        {new Date(
                                            row.updated_at
                                        ).toLocaleString("en-IE", {
                                            dateStyle: "medium",
                                            timeStyle: "short",
                                        })}
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    {responseText && (
                                        <AdminCopyButton
                                            value={responseText}
                                            label="Copy all"
                                        />
                                    )}
                                    <span className="text-xs text-neutral-500 group-open:hidden">
                                        Show
                                    </span>
                                    <span className="text-xs text-neutral-500 group-open:inline hidden">
                                        Hide
                                    </span>
                                </div>
                            </summary>

                            <div className="grid gap-3 px-4 pb-4 lg:grid-cols-2">
                                {form.fields.map((field) => {
                                    const value = row.response[field.name]

                                    if (!value) return null

                                    if (
                                        isStoredUploadArray(value) &&
                                        value.length > 0
                                    ) {
                                        return (
                                            <div
                                                key={field.name}
                                                className="rounded-lg border border-neutral-800 bg-neutral-950 p-3 lg:col-span-2"
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                                        {field.label}
                                                    </p>
                                                    <span className="text-xs text-neutral-500">
                                                        {value.length} file
                                                        {value.length === 1
                                                            ? ""
                                                            : "s"}
                                                    </span>
                                                </div>

                                                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                                    {value.map((file) => {
                                                        const url =
                                                            signedUrls.get(
                                                                file.path
                                                            ) ?? null

                                                        return (
                                                            <div
                                                                key={file.path}
                                                                className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"
                                                            >
                                                                {url &&
                                                                file.kind ===
                                                                    "image" ? (
                                                                    <a
                                                                        href={
                                                                            url
                                                                        }
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                    >
                                                                        <img
                                                                            src={
                                                                                url
                                                                            }
                                                                            alt=""
                                                                            loading="lazy"
                                                                            className="h-28 w-full object-cover"
                                                                        />
                                                                    </a>
                                                                ) : (
                                                                    <div className="flex h-20 items-center justify-center bg-neutral-950 px-3 text-center text-xs font-medium text-neutral-400">
                                                                        {file.kind.toUpperCase()}
                                                                    </div>
                                                                )}

                                                                <div className="space-y-3 p-3">
                                                                    <div>
                                                                        <p
                                                                            className="truncate text-sm font-medium text-neutral-200"
                                                                            title={
                                                                                file.name
                                                                            }
                                                                        >
                                                                            {
                                                                                file.name
                                                                            }
                                                                        </p>
                                                                        <p className="mt-1 text-xs text-neutral-500">
                                                                            {formatFileSize(
                                                                                file.size
                                                                            )}{" "}
                                                                            ·{" "}
                                                                            {
                                                                                file.type
                                                                            }
                                                                        </p>
                                                                    </div>

                                                                    <FileActions
                                                                        url={
                                                                            url
                                                                        }
                                                                        fileName={
                                                                            file.name
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    }

                                    if (
                                        typeof value !== "string" ||
                                        !value.trim()
                                    ) {
                                        return null
                                    }

                                    return (
                                        <div
                                            key={field.name}
                                            className="rounded-lg border border-neutral-800 bg-neutral-950 p-3"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                                                    {field.label}
                                                </p>
                                                <AdminCopyButton
                                                    value={value}
                                                    className="shrink-0 rounded-md border border-neutral-700 px-2 py-1 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:text-white"
                                                />
                                            </div>
                                            <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-sm leading-6 text-neutral-200">
                                                {value}
                                            </p>
                                        </div>
                                    )
                                })}
                            </div>
                        </details>
                    )
                })}
            </div>
        </section>
    )
}
