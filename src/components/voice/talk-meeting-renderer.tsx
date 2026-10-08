"use client"

import * as React from "react"
import { RtkMeeting } from "@cloudflare/realtimekit-react-ui"
import type { UIConfig } from "@cloudflare/realtimekit-react-ui"

type TalkMeetingRendererProps = {
  readonly meeting: React.ComponentProps<typeof RtkMeeting>["meeting"]
  readonly config: UIConfig
  readonly children: React.ReactNode
}

export function TalkMeetingRenderer({
  meeting,
  config,
  children
}: TalkMeetingRendererProps): React.ReactNode {
  const configureRenderer = React.useCallback(
    (element: HTMLRtkMeetingElement | null): void => {
      if (!element) return
      // The SDK resets preset loading in connectedCallback. Reapply the application
      // layout after its first render so preset controls cannot replace our toolbar.
      void element.componentOnReady().then(() => {
        if (!element.isConnected) return
        element.loadConfigFromPreset = false
        element.showSetupScreen = false
        element.config = config
      })
    },
    [config]
  )

  return (
    <RtkMeeting
      ref={configureRenderer}
      mode="fill"
      loadConfigFromPreset={false}
      showSetupScreen={false}
      leaveOnUnmount
      applyDesignSystem
      config={config}
      meeting={meeting}
    >
      {children}
    </RtkMeeting>
  )
}
