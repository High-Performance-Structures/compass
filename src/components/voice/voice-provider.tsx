"use client"

import type { ReactNode } from "react"
import { VoiceContext, useVoiceStateLogic } from "@/hooks/use-voice-state"

export function VoiceProvider({ children }: { readonly children: ReactNode }) {
  const voiceState = useVoiceStateLogic()

  return <VoiceContext.Provider value={voiceState}>{children}</VoiceContext.Provider>
}
