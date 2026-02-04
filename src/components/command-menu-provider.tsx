"use client"

import * as React from "react"
import { CommandMenu } from "@/components/command-menu"
import { MobileSearch } from "@/components/mobile-search"
import { useIsMobile } from "@/hooks/use-mobile"

const CommandMenuContext = React.createContext<{
  open: () => void
}>({ open: () => {} })

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

  const value = React.useMemo(
    () => ({
      open: () => {
        if (isMobile) {
          setMobileSearchOpen(true)
        } else {
          setIsOpen(true)
        }
      },
    }),
    [isMobile]
  )

  return (
    <CommandMenuContext.Provider value={value}>
      {children}
      <CommandMenu open={isOpen} setOpen={setIsOpen} />
      <MobileSearch
        open={mobileSearchOpen}
        setOpen={setMobileSearchOpen}
      />
    </CommandMenuContext.Provider>
  )
}
