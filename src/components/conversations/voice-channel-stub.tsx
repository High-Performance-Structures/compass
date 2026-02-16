"use client"

import * as React from "react"
import { Volume2 } from "lucide-react"
import { SidebarMenuButton } from "@/components/ui/sidebar"
import { useVoiceState } from "@/hooks/use-voice-state"

type VoiceChannelStubProps = {
  readonly id: string
  readonly name: string
}

export function VoiceChannelStub({ id, name }: VoiceChannelStubProps): React.ReactElement {
  const { channelId, joinChannel, leaveChannel } = useVoiceState()
  const isActive = channelId === id

  function handleClick(): void {
    if (isActive) {
      leaveChannel()
    } else {
      joinChannel(id, name)
    }
  }

  return (
    <SidebarMenuButton
      onClick={handleClick}
      isActive={isActive}
      tooltip={name}
    >
      <Volume2 className="h-4 w-4" />
      <span>{name}</span>
    </SidebarMenuButton>
  )
}
