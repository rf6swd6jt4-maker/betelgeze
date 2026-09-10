"use client"

import NextLink from "next/link"
import type { ComponentProps } from "react"
import { useWorkspaceNavigation } from "./WorkspaceNavigation"

// The native host owns bounded JSON prefetch and navigation. Framework route
// prefetch would also fetch an unused server-rendered copy of the same panel.
// Passing every other prop through retains anchor semantics, handlers and refs.
export default function WorkspaceLink(props: ComponentProps<typeof NextLink>) {
    const navigation = useWorkspaceNavigation()
    return <NextLink {...props} prefetch={navigation ? false : props.prefetch} />
}
