import type * as React from "react"

import { RealtimeKitMeetingWindow } from "@/components/voice/realtimekit-meeting-window"
import { getCurrentUser } from "@/lib/auth"
import { canUseOfficeTalk } from "@/lib/permissions"
import { ClientRedirect } from "@/components/client-redirect"

export const dynamic = "force-dynamic"

export default async function ConversationMeetingPage({
  params,
}: {
  readonly params: Promise<{ readonly channelId: string }>
}): Promise<React.ReactElement> {
  const user = await getCurrentUser()
  if (!user || !canUseOfficeTalk(user)) {
    return <ClientRedirect href={"/dashboard/access-restricted?feature=conversations&action=join"} />
  }
  const { channelId } = await params
  return <RealtimeKitMeetingWindow channelId={channelId} userId={user.id} />
}
