import { AccountDevicePresence } from "@/components/account/AccountDevicePresence"

export default function AccountLayout({ children }: { children: React.ReactNode }) {
    return <>{children}<AccountDevicePresence /></>
}
