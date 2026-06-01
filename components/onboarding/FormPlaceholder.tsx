type FormPlaceholderProps = {
    formKey?: string
}

export function FormPlaceholder({ formKey }: FormPlaceholderProps) {
    return (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-[#F8F7F3] p-5">
            <p className="font-semibold text-slate-950">Form coming next</p>

            <p className="mt-2 text-sm leading-6 text-slate-600">
                This step will collect the information needed for this part of
                your project.
            </p>

            {formKey && (
                <p className="mt-4 rounded-xl bg-white px-3 py-2 font-mono text-xs text-slate-500">
                    {formKey}
                </p>
            )}
        </div>
    )
}