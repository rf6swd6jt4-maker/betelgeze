import { submitFormStep } from "@/app/session/[token]/actions"
import {
    FormResponse,
    getFileAcceptValue,
    OnboardingFormDefinition,
    StoredUpload,
} from "@/lib/onboarding/forms"
import { FileUploadField } from "@/components/onboarding/FileUploadField"

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

export function OnboardingForm({
    token,
    stepKey,
    form,
    initialResponse,
}: OnboardingFormProps) {
    return (
        <form
            action={async (formData) => {
                "use server"
                await submitFormStep(token, stepKey, form.key, formData)
            }}
            className="mt-8 space-y-6"
        >
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

            <button className="w-full rounded-xl bg-[#1E3A5F] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80">
                Save and continue
            </button>
        </form>
    )
}
