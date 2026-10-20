import type * as React from "react"

import type { RecordEmailReplyItem } from "@/app/actions/record-email-replies"

function formatReceived(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/** Supplier or vendor replies that came back to an RFQ or PO email. */
export function RecordEmailReplies({
  replies,
}: {
  readonly replies: readonly RecordEmailReplyItem[]
}): React.ReactElement | null {
  if (replies.length === 0) return null
  return (
    <section className="mt-3 border-l-2 border-l-brand-nutech-gold bg-muted/20 px-3 py-2 print:hidden">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Email replies · Internal
      </h3>
      <div className="mt-2 space-y-3">
        {replies.map((reply) => (
          <div key={reply.id} className="border-t pt-2 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>{reply.from}</span>
              <span>{formatReceived(reply.receivedAt)}</span>
            </div>
            <p className="mt-1 text-sm font-medium">{reply.subject}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{reply.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
