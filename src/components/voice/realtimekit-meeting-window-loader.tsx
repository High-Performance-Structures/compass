"use client"

import dynamic from "next/dynamic"

// The meeting UI (RealtimeKit SDK + web components, ~4 MB) only runs in the
// browser. Loading it with ssr: false keeps it out of the Worker's server
// bundle, which every request pays to parse on a cold start.
export const RealtimeKitMeetingWindowLoader = dynamic(
  () =>
    import("@/components/voice/realtimekit-meeting-window").then(
      (module) => module.RealtimeKitMeetingWindow
    ),
  {
    ssr: false,
    loading: () => <div className="h-dvh w-full bg-background" aria-busy="true" />,
  }
)
