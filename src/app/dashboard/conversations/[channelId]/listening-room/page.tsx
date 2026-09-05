import type * as React from "react"
import { redirect } from "next/navigation"

import { ListeningRoomButton } from "@/components/voice/listening-room-button"
import { getCurrentUser } from "@/lib/auth"
import { OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID } from "@/lib/listening-room"
import { canUseOfficeTalk } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function ConversationListeningRoomPage({
  params,
}: {
  readonly params: Promise<{ readonly channelId: string }>
}): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (!canUseOfficeTalk(user)) {
    redirect(
      "/dashboard/access-restricted?feature=conversations&action=join"
    )
  }
  const { channelId } = await params
  if (channelId !== OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID) {
    redirect("/dashboard/conversations")
  }

  return (
    <div className="fixed inset-0 z-40 bg-background">
      <ListeningRoomButton
        channelId={channelId}
        channelName="Office Talk"
        showTrigger={false}
        initialOpen
        standaloneWindow
      />
    </div>
  )
}
