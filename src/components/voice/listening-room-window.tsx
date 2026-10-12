"use client"

import * as React from "react"
import { ListeningRoom } from "@/components/voice/listening-room"
import { OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID } from "@/lib/listening-room"

/** The room popped out into its own browser window. */
export function ListeningRoomWindow({
  channelId,
}: {
  readonly channelId: string
}): React.ReactElement {
  const close = React.useCallback(() => window.close(), [])
  return (
    <ListeningRoom
      channelId={channelId}
      channelName={channelId === OFFICE_TALK_LISTENING_ROOM_CHANNEL_ID ? "Office Talk" : "Voice channel"}
      expanded
      onExpandedChange={() => undefined}
      onDismiss={close}
      standalone
    />
  )
}
