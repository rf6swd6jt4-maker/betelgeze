/**
 * The two looks of a booking page. Standalone: light, agency-branded. Embedded in a funnel (`?embed=1`): no page
 * background or card of its own, on the funnel's dark panel with its lavender accent and holo button.
 */
export type BookingTheme = {
    main: string; card: string; text: string; muted: string; rule: string; link: string; error: string; display: string
    primary: string; choice: string; choiceOn: string; choiceSub: string; choiceSubOn: string
}

const plain: BookingTheme = {
    main: "min-h-screen bg-[#f6f6f4] px-4 py-10 text-neutral-900 sm:py-16",
    card: "mt-8 rounded-2xl border border-black/10 bg-white p-5 sm:p-6",
    text: "text-neutral-900",
    muted: "text-neutral-600",
    rule: "border-black/10",
    link: "text-neutral-700 hover:text-neutral-950",
    error: "text-red-700",
    display: "text-xl font-semibold",
    primary: "rounded-xl bg-neutral-900 font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300",
    choice: "rounded-xl border border-black/10 hover:border-black/30",
    choiceOn: "rounded-xl border border-neutral-900 bg-neutral-900 text-white",
    choiceSub: "text-neutral-500",
    choiceSubOn: "text-white/70",
}

// The funnel's tokens (funnel-assets/scaylup-base.css): ink #f3f3f6, muted #9b9bab, lines white at 9–16%,
// lavender #b4a8ff on a 12% wash, the holo gradient on primary buttons, a 14px radius.
const embedded: BookingTheme = {
    main: "bg-transparent px-5 py-6 text-[#f3f3f6] sm:px-7 sm:py-7",
    card: "",
    text: "text-[#f3f3f6]",
    muted: "text-[#9b9bab]",
    rule: "border-white/[0.09]",
    link: "text-[#b4a8ff] hover:text-white",
    error: "text-[#ff8d7a]",
    display: "text-[28px] leading-tight",
    primary: "rounded-[14px] bg-[linear-gradient(118deg,#ffe4cf_0%,#f6f1ff_18%,#c7d3ff_38%,#efe6ff_55%,#ffd9c2_74%,#d6e2ff_100%)] font-[650] text-[#0a0a0d] shadow-[inset_0_0_0_1px_#ffffff55,0_18px_40px_-18px_#8b6bffbb] transition-shadow hover:shadow-[inset_0_0_0_1px_#ffffff88,0_22px_46px_-16px_#8b6bffdd] disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/[0.06] disabled:text-[#6f6f80] disabled:shadow-none",
    choice: "rounded-[14px] border border-white/[0.16] bg-white/[0.04] text-[#f3f3f6] hover:border-white/30 hover:bg-white/[0.08]",
    choiceOn: "rounded-[14px] border border-[#b4a8ff] bg-[rgba(150,132,255,0.12)] text-white",
    choiceSub: "text-[#9b9bab]",
    choiceSubOn: "text-[#b4a8ff]",
}

export const bookingTheme = (embed: boolean) => embed ? embedded : plain
