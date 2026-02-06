"use client"

import { useRenderState } from "@/components/agent/chat-provider"
import { RenderedView } from "@/components/agent/rendered-view"
import { ChatView } from "@/components/agent/chat-view"

export default function Page() {
  const { spec, isRendering } = useRenderState()
  const hasRenderedUI = !!spec?.root || isRendering

  if (hasRenderedUI) {
    return <RenderedView />
  }

  return <ChatView variant="page" />
}
