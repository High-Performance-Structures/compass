"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { createNuTechOrder, type NuTechOrderSummary } from "@/app/actions/nutech-orders"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { nuTechOrderStatusLabel } from "@/lib/nutech/workflow"
import { cn } from "@/lib/utils"

export function nuTechOrderLabel(order: { readonly orderNumber: number; readonly title: string | null }): string {
  return order.title ? `Order ${order.orderNumber} · ${order.title}` : `Order ${order.orderNumber}`
}

/**
 * A job's Nu-Tech orders (a job can have several: bracing, block for each
 * phase, …) with the one open highlighted, and New order to start another.
 */
export function NuTechOrderSwitcher({
  projectId,
  orders,
  activeOrderId,
  canEdit,
}: {
  readonly projectId: string
  readonly orders: readonly NuTechOrderSummary[]
  readonly activeOrderId: string | null
  readonly canEdit: boolean
}): React.ReactElement | null {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [adding, setAdding] = React.useState(false)
  const [title, setTitle] = React.useState("")

  if (orders.length === 0) return null

  function create(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await createNuTechOrder(projectId, { title: title.trim() || null, copyFromOrderId: activeOrderId })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("New order started. Add its products, then fill its estimate.")
      setAdding(false)
      setTitle("")
      router.push(`/dashboard/projects/${projectId}/nutech?order=${encodeURIComponent(result.id)}`)
      router.refresh()
    })
  }

  return (
    <nav aria-label="Orders on this job" className="mb-6 grid gap-3 border-b pb-4">
      <div className="flex flex-wrap items-center gap-2">
        {orders.map((order) => {
          const active = order.id === activeOrderId
          return (
            <Link
              key={order.id}
              href={`/dashboard/projects/${projectId}/nutech?order=${encodeURIComponent(order.id)}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 flex-col justify-center rounded-lg border px-3 py-1 text-sm hover:bg-accent",
                active && "border-primary bg-accent",
              )}
            >
              <span className="font-medium">{nuTechOrderLabel(order)}</span>
              <span className="text-xs text-muted-foreground">{nuTechOrderStatusLabel(order.orderStatus)}</span>
            </Link>
          )
        })}
        {canEdit && !adding ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            <IconPlus className="size-4" />
            New order
          </Button>
        ) : null}
      </div>
      {adding ? (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="new-order-title">Name (optional)</Label>
            <Input
              id="new-order-title"
              value={title}
              maxLength={120}
              placeholder="Phase 2 walls"
              onChange={(event) => setTitle(event.target.value)}
              className="w-64"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Starting…" : "Start order"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={pending}>
            Cancel
          </Button>
          <p className="basis-full text-xs text-muted-foreground">
            The new order copies this order&apos;s customer, pricing, delivery and tax district, and starts with no products. It
            fills its own estimate.
          </p>
        </form>
      ) : null}
    </nav>
  )
}
