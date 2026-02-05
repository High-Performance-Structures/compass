"use client"

import { useEffect } from "react"
import type { LucideIcon } from "lucide-react"
import { usePageActionsContext } from "@/components/page-actions-provider"

interface PageAction {
  readonly id: string
  readonly label: string
  readonly icon?: LucideIcon
  readonly onSelect: () => void
}

export function useRegisterPageActions(
  actions: ReadonlyArray<PageAction>
): void {
  const { register } = usePageActionsContext()

  useEffect(() => {
    if (actions.length === 0) return
    return register(actions)
  }, [actions, register])
}
