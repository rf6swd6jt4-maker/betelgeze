type WhyWeAskCardProps = {
    children: React.ReactNode
}

export function WhyWeAskCard({ children }: WhyWeAskCardProps) {
    return (
        <div className="rounded-2xl border-l-4 border-[#F0B429] bg-amber-50 p-5">
            <p className="font-semibold text-[#1E3A5F]">Why do we ask?</p>

            <div className="mt-2 text-sm leading-6 text-slate-700">
                {children}
            </div>
        </div>
    )
}