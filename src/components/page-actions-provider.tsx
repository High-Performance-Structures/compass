"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"

interface PageAction {
  readonly id: string
  readonly label: string
  readonly icon?: LucideIcon
  readonly onSelect: () => void
}

interface PageActionsContextValue {
  readonly actions: ReadonlyArray<PageAction>
  readonly register: (
    actions: ReadonlyArray<PageAction>
  ) => () => void
}

const PageActionsContext = React.createContext<PageActionsContextValue>({
  actions: [],
  register: () => () => {},
})

export function usePageActionsContext(): PageActionsContextValue {
  return React.useContext(PageActionsContext)
}

export function PageActionsProvider({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const [actions, setActions] = React.useState<
    ReadonlyArray<PageAction>
  >([])

  const register = React.useCallback(
    (incoming: ReadonlyArray<PageAction>) => {
      setActions(incoming)
      return () => setActions([])
    },
    []
  )

  const value = React.useMemo(
    () => ({ actions, register }),
    [actions, register]
  )

  return (
    <PageActionsContext.Provider value={value}>
      {children}
    </PageActionsContext.Provider>
  )
}
