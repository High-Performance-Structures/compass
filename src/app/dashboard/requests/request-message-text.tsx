import Link from "next/link"

import { feedbackMessageParts } from "@/lib/jarvis/feedback-message-links"

/** A Feedback Desk update with its help-guide and web links clickable. */
export function RequestMessageText({ message }: { readonly message: string }) {
  return (
    <>
      {feedbackMessageParts(message).map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : part.external ? (
          <a key={index} href={part.href} target="_blank" rel="noreferrer" className="break-all text-primary underline underline-offset-2">
            {part.text}
          </a>
        ) : (
          <Link key={index} href={part.href} className="break-all text-primary underline underline-offset-2">
            {part.text}
          </Link>
        )
      )}
    </>
  )
}
