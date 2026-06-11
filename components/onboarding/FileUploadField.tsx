"use client"

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react"
import {
    FileAccept,
    getFileAcceptValue,
    StoredUpload,
} from "@/lib/onboarding/forms"

type FileUploadFieldProps = {
    name: string
    accept?: FileAccept
    multiple?: boolean
    required?: boolean
    existingFiles?: StoredUpload[]
    files: File[]
    onFilesChange: (files: File[]) => void
}

export function FileUploadField({
    name,
    accept,
    multiple,
    required,
    existingFiles = [],
    files,
    onFilesChange,
}: FileUploadFieldProps) {
    const [inputKey, setInputKey] = useState(0)

    const previews = useMemo(
        () =>
            files.map((file) => ({
                file,
                url: file.type.startsWith("image/")
                    ? URL.createObjectURL(file)
                    : null,
            })),
        [files]
    )

    function removeFile(indexToRemove: number) {
        onFilesChange(files.filter((_, index) => index !== indexToRemove))
        setInputKey((value) => value + 1)
    }

    function handleFilesChange(selectedFiles: File[]) {
        onFilesChange(multiple ? selectedFiles : selectedFiles.slice(0, 1))
    }

    return (
        <div>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center transition hover:border-[#1E3A5F] hover:bg-blue-50/30">
                <span className="text-base font-semibold text-slate-950">
                    Tap to choose {multiple ? "files" : "a file"}
                </span>
                <span className="mt-2 text-sm leading-6 text-slate-500">
                    Images preview before you submit. Videos upload directly
                    and show progress.
                </span>
                <input
                    key={`${name}-${inputKey}`}
                    type="file"
                    accept={getFileAcceptValue(accept)}
                    multiple={multiple}
                    required={
                        required &&
                        existingFiles.length === 0 &&
                        files.length === 0
                    }
                    className="sr-only"
                    onChange={(event) =>
                        handleFilesChange(
                            Array.from(event.currentTarget.files ?? [])
                        )
                    }
                />
            </label>

            {files.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {previews.map(({ file, url }, index) => (
                        <div
                            key={`${file.name}-${file.size}`}
                            className="relative overflow-hidden rounded-xl border border-slate-200 bg-white"
                        >
                            <button
                                type="button"
                                onClick={() => removeFile(index)}
                                aria-label={`Remove ${file.name}`}
                                className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-lg leading-none text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-red-50 hover:text-red-700"
                            >
                                ×
                            </button>

                            {url ? (
                                <img
                                    src={url}
                                    alt=""
                                    className="h-36 w-full object-cover"
                                />
                            ) : (
                                <div className="flex h-24 items-center justify-center bg-slate-100 px-4 text-center text-sm font-medium text-slate-600">
                                    {file.type.startsWith("video/")
                                        ? "Video selected"
                                        : "File selected"}
                                </div>
                            )}

                            <div className="p-3">
                                <p className="truncate text-sm font-medium text-slate-900">
                                    {file.name}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {existingFiles.length > 0 && (
                <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                    {existingFiles.length} file
                    {existingFiles.length === 1 ? "" : "s"} already uploaded.
                    Choosing more files will add to them.
                </div>
            )}
        </div>
    )
}
