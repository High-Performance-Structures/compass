"use client"

import { ConversationsProvider } from "@/contexts/conversations-context"

export default function ConversationsLayout({
  children,
}: {
  readonly children: React.ReactNode
}) {
  return <ConversationsProvider>{children}</ConversationsProvider>
}
