"use client"

import { Volume2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { SidebarMenuButton } from "@/components/ui/sidebar"

type VoiceChannelStubProps = {
  readonly name: string
}

export function VoiceChannelStub({ name }: VoiceChannelStubProps) {
  return (
    <SidebarMenuButton
      className="cursor-not-allowed opacity-60"
      disabled
      tooltip={`${name} (Coming Soon)`}
    >
      <Volume2 className="h-4 w-4" />
      <span>{name}</span>
      <Badge variant="secondary" className="ml-auto text-[10px]">
        Soon
      </Badge>
    </SidebarMenuButton>
  )
}
