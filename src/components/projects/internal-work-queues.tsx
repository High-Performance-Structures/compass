"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import { saveRoleDashboardOrder } from "@/app/actions/view-preferences"
import { SortableList } from "@/components/sortable-list"
import { Button } from "@/components/ui/button"
import type { WorkspaceKind } from "@/lib/internal-duties/model"
import { internalQueueRoleId, orderedQueues, queueHref, type InternalQueue, type InternalQueueId } from "@/lib/internal-duties/queues"
import { cn } from "@/lib/utils"

const KIND_LABEL: { readonly [K in WorkspaceKind]: string } = {
  office: "Office work queues",
  executive: "Owner's office work queues",
  field: "Crew work queues",
}

/**
 * The Role Dashboard for an internal workspace: its work queues instead of a
 * client job's. People reorder their own, saved per workspace kind.
 */
export function InternalWorkQueues({
  projectId,
  kind,
  savedOrder,
  badges,
}: {
  readonly projectId: string
  readonly kind: WorkspaceKind
  readonly savedOrder: readonly string[] | undefined
  /** Short counts shown on a queue, e.g. "2 behind". */
  readonly badges: Readonly<Partial<Record<InternalQueueId, { readonly text: string; readonly urgent: boolean }>>>
}): React.ReactElement {
  const roleId = internalQueueRoleId(kind)
  const [queues, setQueues] = React.useState<readonly InternalQueue[]>(() => orderedQueues(kind, savedOrder))
  const [saving, startTransition] = React.useTransition()

  function save(next: readonly InternalQueue[] | null): void {
    const previous = queues
    const nextQueues = next ?? orderedQueues(kind, [])
    setQueues(nextQueues)
    startTransition(async () => {
      const result = await saveRoleDashboardOrder(roleId, next ? next.map((queue) => queue.id) : [])
      if (!result.success) {
        setQueues(previous)
        toast.error(result.error)
      }
    })
  }

  return (
    <section aria-labelledby="internal-queues-heading" className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="internal-queues-heading" className="text-sm font-semibold">
          {KIND_LABEL[kind]}
        </h2>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => save(null)}>
          Reset order
        </Button>
      </div>
      <div className="overflow-hidden border-y" aria-busy={saving}>
        <SortableList
          className="divide-y"
          items={queues}
          label={(queue) => queue.title}
          disabled={saving}
          onReorder={save}
          renderItem={(queue) => {
            const badge = badges[queue.id]
            return (
              <Link href={queueHref(queue, projectId)} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 hover:bg-muted/50">
                <span className="min-w-0">
                  <span className="font-medium">{queue.title}</span>
                  {queue.sageCode ? <span className="ml-2 font-mono text-xs text-muted-foreground">{queue.sageCode}</span> : null}
                  <span className="block text-sm text-muted-foreground">{queue.description}</span>
                </span>
                {badge ? <span className={cn("text-sm font-medium", badge.urgent ? "text-destructive" : "text-muted-foreground")}>{badge.text}</span> : null}
              </Link>
            )
          }}
        />
      </div>
    </section>
  )
}
