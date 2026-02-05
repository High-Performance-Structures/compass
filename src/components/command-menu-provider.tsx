"use client"

import * as React from "react"
import { CommandMenu } from "@/components/command-menu"
import { MobileSearch } from "@/components/mobile-search"
import { useIsMobile } from "@/hooks/use-mobile"

interface CommandMenuContextValue {
  readonly open: () => void
  readonly openWithQuery: (query: string) => void
}

const CommandMenuContext = React.createContext<CommandMenuContextValue>({
  open: () => {},
  openWithQuery: () => {},
})

export function useCommandMenu() {
  return React.useContext(CommandMenuContext)
}

export function CommandMenuProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const isMobile = useIsMobile()
  const [isOpen, setIsOpen] = React.useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] =
    React.useState(false)
  const [initialQuery, setInitialQuery] = React.useState("")

  const handleSetOpen = React.useCallback((next: boolean) => {
    setIsOpen(next)
    if (!next) setInitialQuery("")
  }, [])

  const value = React.useMemo(
    () => ({
      open: () => {
        if (isMobile) {
          setMobileSearchOpen(true)
        } else {
          setInitialQuery("")
          setIsOpen(true)
        }
      },
      openWithQuery: (query: string) => {
        if (isMobile) {
          setMobileSearchOpen(true)
        } else {
          setInitialQuery(query)
          setIsOpen(true)
        }
      },
    }),
    [isMobile]
  )

  return (
    <CommandMenuContext.Provider value={value}>
      {children}
      <CommandMenu
        open={isOpen}
        setOpen={handleSetOpen}
        initialQuery={initialQuery}
      />
      <MobileSearch
        open={mobileSearchOpen}
        setOpen={setMobileSearchOpen}
      />
    </CommandMenuContext.Provider>
  )
}
