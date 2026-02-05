/**
 * Agent Provider
 *
 * Provides context for controlling the chat panel from anywhere in the app.
 */

"use client"

import * as React from "react"

interface AgentContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
}

const AgentContext = React.createContext<AgentContextValue | null>(null)

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false)

  const contextValue = React.useMemo(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((prev) => !prev),
    }),
    [isOpen]
  )

  return (
    <AgentContext.Provider value={contextValue}>
      {children}
    </AgentContext.Provider>
  )
}

export function useAgent() {
  const context = React.useContext(AgentContext)
  if (!context) {
    throw new Error("useAgent must be used within an AgentProvider")
  }
  return context
}

export function useAgentOptional() {
  return React.useContext(AgentContext)
}
