"use client"

import dynamic from "next/dynamic"

// The composer's editor (TipTap/ProseMirror) renders nothing on the server
// (immediatelyRender: false), so load it in the browser only and keep it out of
// the Worker's server bundle.
export const MessageComposer = dynamic(
  () => import("@/components/conversations/message-composer").then((module) => module.MessageComposer),
  { ssr: false }
)
