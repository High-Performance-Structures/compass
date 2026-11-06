"use client"

import * as React from "react"
import { toast } from "sonner"

import { createNuTechOrder } from "@/app/actions/nutech-orders"
import { getNuTechRepeatOrderTargets, type NuTechRepeatOrderTarget } from "@/app/actions/nutech-repeat-order"
import { Button } from "@/components/ui/button"
import { nuTechOrderStatusLabel } from "@/lib/nutech/workflow"

/**
 * In the intake's possible-duplicate dialog for an N job: offers to add the
 * order to a matching N job (its next Order number) instead of opening a new
 * N number for a site that already has one.
 */
export function NuTechRepeatOrderChoices({
  projects,
  onStarted,
}: {
  readonly projects: readonly { readonly id: string; readonly projectNumber: string | null }[]
  /** Called with the new order's page once it is started. */
  readonly onStarted: (href: string) => void
}): React.ReactElement | null {
  const [targets, setTargets] = React.useState<readonly NuTechRepeatOrderTarget[]>([])
  const [pending, startTransition] = React.useTransition()
  const projectIds = projects.map((project) => project.id).join(",")

  React.useEffect(() => {
    let active = true
    void getNuTechRepeatOrderTargets(projectIds.split(",").filter(Boolean))
      .then((result) => {
        if (active) setTargets(result)
      })
      .catch(() => {
        if (active) setTargets([])
      })
    return () => { active = false }
  }, [projectIds])

  if (targets.length === 0) return null

  function start(target: NuTechRepeatOrderTarget, projectNumber: string): void {
    startTransition(async () => {
      // Copies the job's latest order's customer, pricing, delivery and tax district.
      const result = await createNuTechOrder(target.projectId, { title: null })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Order ${target.nextOrderNumber} started on ${projectNumber}. Add its products.`)
      onStarted(`/dashboard/projects/${encodeURIComponent(target.projectId)}/nutech?order=${encodeURIComponent(result.id)}`)
    })
  }

  return (
    <div className="space-y-3">
      {targets.map((target) => {
        const projectNumber = projects.find((project) => project.id === target.projectId)?.projectNumber ?? "this job"
        const last = target.lastOrder
        return (
          <div key={target.projectId} className="space-y-2 rounded-lg border border-brand-nutech-gold bg-brand-nutech-gold/10 p-3">
            <p className="text-sm">
              {projectNumber} is already a Nu-Tech job for this customer and site.
              {last
                ? ` Order ${last.orderNumber}${last.title ? ` · ${last.title}` : ""}: ${nuTechOrderStatusLabel(last.orderStatus)}.`
                : " It has no orders yet."}
            </p>
            <Button type="button" className="w-full" disabled={pending} onClick={() => start(target, projectNumber)}>
              {pending ? "Starting…" : `Add as Order ${target.nextOrderNumber} on ${projectNumber}`}
            </Button>
          </div>
        )
      })}
      <p className="text-xs text-muted-foreground">
        Adding it there keeps one job, one Drive folder and one history for the site. Create a new N job only for a different site.
      </p>
    </div>
  )
}
