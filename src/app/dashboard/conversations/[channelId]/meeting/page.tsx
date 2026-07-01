import type * as React from "react"
import { RealtimeKitMeetingWindow } from "@/components/voice/realtimekit-meeting-window"

export const dynamic = "force-dynamic"

export default async function ConversationMeetingPage({
  params,
}: {
  readonly params: Promise<{ readonly channelId: string }>
}): Promise<React.ReactElement> {
  const { channelId } = await params
  return <RealtimeKitMeetingWindow channelId={channelId} />
}
