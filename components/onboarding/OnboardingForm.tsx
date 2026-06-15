"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import {
    prepareDirectUpload,
    submitPreparedFormStep,
} from "@/app/session/[token]/actions"
import {
    FormResponse,
    getFileAcceptValue,
    OnboardingFormDefinition,
    StoredUpload,
} from "@/lib/onboarding/forms"
import { FileUploadField } from "@/components/onboarding/FileUploadField"
import { LoadingOverlay } from "@/components/LoadingOverlay"

type OnboardingFormProps = {
    token: string
    stepKey: string
    form: OnboardingFormDefinition
    initialResponse?: FormResponse
}

function getStringValue(response: FormResponse | undefined, name: string) {
    const value = response?.[name]

    return typeof value === "string" ? value : ""
}

function getStoredFiles(response: FormResponse | undefined, name: string) {
    const value = response?.[name]

    return Array.isArray(value) ? (value as StoredUpload[]) : []
}

function uploadFileToSignedUrl(
    uploadUrl: string,
    file: File,
    onProgress: (percentage: number) => void
) {
    return new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest()

        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
                onProgress(Math.round((event.loaded / event.total) * 100))
            }
        })

        request.addEventListener("load", () => {
            if (request.status >= 200 && request.status < 300) {
                onProgress(100)
                resolve()
                return
            }

            reject(new Error(`Upload failed with status ${request.status}`))
        })

        request.addEventListener("error", () => {
            reject(new Error("Upload failed. Check your connection and try again."))
        })

        request.open("PUT", uploadUrl)
        request.setRequestHeader(
            "Content-Type",
            file.type || "application/octet-stream"
        )
        request.send(file)
    })
}

export function OnboardingForm({
    token,
    stepKey,
    form,
    initialResponse,
}: OnboardingFormProps) {
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)
    const [uploadLabel, setUploadLabel] = useState<string | null>(null)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [saving, setSaving] = useState(false)
    const [selectedFilesByField, setSelectedFilesByField] = useState<
        Record<string, File[]>
    >({})

    function updateSelectedFiles(fieldName: string, files: File[]) {
        setSelectedFilesByField((current) => ({
            ...current,
            [fieldName]: files,
        }))
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        setUploadProgress(0)

        const formData = new FormData(event.currentTarget)
        const response: FormResponse = {}

        try {
            for (const field of form.fields) {
                if (field.type === "file") {
                    const existingFiles = getStoredFiles(
                        initialResponse,
                        field.name
                    )
                    const files =
                        selectedFilesByField[field.name]?.filter(
                            (file) => file.size > 0 && Boolean(file.name)
                        ) ?? []

                    const uploadedFiles: StoredUpload[] = []

                    for (const [index, file] of files.entries()) {
                        setUploadLabel(
                            `Uploading ${file.name} (${index + 1} of ${files.length})`
                        )
                        setUploadProgress(0)

                        const prepared = await prepareDirectUpload(
                            token,
                            stepKey,
                            {
                                name: file.name,
                                size: file.size,
                                type: file.type,
                            }
                        )

                        await uploadFileToSignedUrl(
                            prepared.uploadUrl,
                            file,
                            setUploadProgress
                        )

                        uploadedFiles.push(prepared.storedUpload)
                    }

                    response[field.name] = [...existingFiles, ...uploadedFiles]
                    continue
                }

                response[field.name] = String(
                    formData.get(field.name) ?? ""
                ).trim()
            }

            setUploadLabel("Saving your answers...")
            setSaving(true)

            await submitPreparedFormStep(token, stepKey, form.key, response)
            setUploadLabel(null)
            setUploadProgress(0)
            setSaving(false)
            setSelectedFilesByField({})
            router.refresh()
        } catch (caughtError) {
            setUploadLabel(null)
            setUploadProgress(0)
            setSaving(false)
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Something went wrong while uploading. Please try again."
            )
        }
    }

    const submitting = saving || Boolean(uploadLabel)

    return (
        <form
            onSubmit={handleSubmit}
            data-global-loading="false"
            className="mt-8 space-y-6"
        >
            {submitting && <LoadingOverlay label="Saving your answers..." />}

            <div className="rounded-2xl border border-slate-200 bg-[#F8F7F3] p-5">
                <p className="font-semibold text-slate-950">{form.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                    {form.intro}
                </p>
            </div>

            {form.fields.map((field) => (
                <div key={field.name}>
                    <label className="block text-base font-semibold text-slate-950">
                        {field.label}
                        {field.required && (
                            <span className="ml-1 text-red-500">*</span>
                        )}
                    </label>

                    {field.helpText && (
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                            {field.helpText}
                        </p>
                    )}

                    {field.type === "textarea" ? (
                        <textarea
                            name={field.name}
                            required={field.required}
                            defaultValue={getStringValue(
                                initialResponse,
                                field.name
                            )}
                            placeholder={field.placeholder}
                            className="mt-3 min-h-32 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-[#1E3A5F] focus:ring-4 focus:ring-blue-100"
                        />
                    ) : field.type === "file" ? (
                        <div className="mt-3">
                            <FileUploadField
                                name={field.name}
                                accept={field.accept}
                                multiple={field.multiple}
                                required={field.required}
                                existingFiles={getStoredFiles(
                                    initialResponse,
                                    field.name
                                )}
                                files={selectedFilesByField[field.name] ?? []}
                                onFilesChange={(files) =>
                                    updateSelectedFiles(field.name, files)
                                }
                            />
                        </div>
                    ) : (
                        <input
                            name={field.name}
                            type={field.type}
                            required={field.required}
                            defaultValue={getStringValue(
                                initialResponse,
                                field.name
                            )}
                            placeholder={field.placeholder}
                            className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-[#1E3A5F] focus:ring-4 focus:ring-blue-100"
                        />
                    )}

                    {field.type === "file" && (
                        <p className="mt-2 text-xs text-slate-500">
                            Accepted:{" "}
                            {getFileAcceptValue(field.accept) ??
                                "images, videos, PDFs, and documents"}
                        </p>
                    )}
                </div>
            ))}

            {uploadLabel && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex items-center justify-between gap-4 text-sm font-medium text-[#1E3A5F]">
                        <span>{uploadLabel}</span>
                        <span>{uploadProgress}%</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                        <div
                            className="h-full rounded-full bg-[#1E3A5F] transition-all"
                            style={{ width: `${uploadProgress}%` }}
                        />
                    </div>
                    <p className="mt-3 text-sm text-slate-600">
                        Please keep this page open while your file uploads.
                    </p>
                </div>
            )}

            {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {error}
                </div>
            )}

            <button
                disabled={submitting}
                className="w-full rounded-xl bg-[#1E3A5F] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
            >
                {submitting ? "Uploading..." : "Save and continue"}
            </button>
        </form>
    )
}
