"use client"

import * as React from "react"
import {
  closeConversationPanel,
  openConversationPanel,
  openDirectMessagePanel,
  toggleConversationPanel,
  type ConversationPanelState,
} from "./conversation-panel-state"

type ConversationPanelContextValue = ConversationPanelState & {
  readonly open: (channelId?: string | null) => void
  readonly openDirectMessages: () => void
  readonly close: () => void
  readonly toggle: () => void
}

const ConversationPanelContext =
  React.createContext<ConversationPanelContextValue | null>(null)

export function useConversationPanel(): ConversationPanelContextValue {
  const context = React.useContext(ConversationPanelContext)
  if (!context) {
    throw new Error(
      "useConversationPanel must be used within a ConversationPanelProvider"
    )
  }
  return context
}

export function useConversationPanelOptional(): ConversationPanelContextValue | null {
  return React.useContext(ConversationPanelContext)
}

export function ConversationPanelProvider({
  children,
}: {
  readonly children: React.ReactNode
}) {
  const [state, setState] = React.useState<ConversationPanelState>({
    isOpen: false,
    channelId: null,
  })

  const open = React.useCallback((channelId?: string | null) => {
    setState((current) =>
      openConversationPanel(
        current,
        channelId === undefined ? current.channelId : channelId
      )
    )
  }, [])

  const openDirectMessages = React.useCallback(() => {
    setState((current) => openDirectMessagePanel(current))
  }, [])

  const close = React.useCallback(() => {
    setState((current) => closeConversationPanel(current))
  }, [])

  const toggle = React.useCallback(() => {
    setState((current) => toggleConversationPanel(current))
  }, [])

  const value = React.useMemo(
    () => ({ ...state, open, openDirectMessages, close, toggle }),
    [state, open, openDirectMessages, close, toggle]
  )

  return (
    <ConversationPanelContext.Provider value={value}>
      {children}
    </ConversationPanelContext.Provider>
  )
}
