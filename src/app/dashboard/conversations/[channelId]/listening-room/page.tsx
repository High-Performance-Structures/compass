import type * as React from "react"

import { ListeningRoomWindow } from "@/components/voice/listening-room-window"
import { getCurrentUser } from "@/lib/auth"
import { canUseOfficeTalk } from "@/lib/permissions"
import { ClientRedirect } from "@/components/client-redirect"

export const dynamic = "force-dynamic"

export default async function ConversationListeningRoomPage({
  params,
}: {
  readonly params: Promise<{ readonly channelId: string }>
}): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (!canUseOfficeTalk(user)) {
    return <ClientRedirect href={"/dashboard/access-restricted?feature=conversations&action=join"} />
  }
  // Channel access is enforced by every Listening Room server action.
  const { channelId } = await params

  return (
    <div className="fixed inset-0 z-40 bg-background">
      <ListeningRoomWindow channelId={channelId} />
    </div>
  )
}
