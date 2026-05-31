export function NeedHelpCard() {
    return (
        <div className="rounded-2xl bg-[#1E3A5F] p-5 text-white">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-100">
                Need help?
            </p>

            <p className="mt-3 text-sm leading-6 text-blue-50">
                Not sure what we’re asking for? Don’t worry. We can walk you
                through it.
            </p>

            <button className="mt-5 w-full rounded-xl border border-white/30 px-4 py-3 text-sm font-medium">
                Call us
            </button>
        </div>
    )
}