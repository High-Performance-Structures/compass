"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { createProjectEstimateDraft, type ProjectEstimateSummary } from "@/app/actions/project-estimates"
import { createNuTechOrder, type NuTechOrderForEstimate } from "@/app/actions/nutech-orders"
import { nuTechOrderStatusLabel } from "@/lib/nutech/workflow"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

/** The newest version of each estimate number on the job, in number order. */
export function latestEstimatePerNumber(estimates: readonly ProjectEstimateSummary[]): readonly ProjectEstimateSummary[] {
  const latest = new Map<string, ProjectEstimateSummary>()
  for (const estimate of estimates) {
    const current = latest.get(estimate.estimateNumber)
    if (!current || estimate.versionNumber > current.versionNumber) latest.set(estimate.estimateNumber, estimate)
  }
  return [...latest.values()].sort((a, b) => a.estimateNumber.localeCompare(b.estimateNumber))
}

const OPEN_STATUSES = new Set(["draft", "internal_review", "signature_pending", "accepted"])

/**
 * Estimates on a job whose department allows several at once: one row per
 * estimate (its newest version), each opened, sent and accepted on its own.
 */
export function ProjectEstimateList({
  projectId,
  estimates,
  activeEstimateId,
  canEdit,
  orders,
}: {
  readonly projectId: string
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly activeEstimateId: string | null
  readonly canEdit: boolean
  /** Nu-Tech jobs: the orders filling each estimate, for the Next step column. */
  readonly orders?: readonly NuTechOrderForEstimate[]
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const rows = latestEstimatePerNumber(estimates)
  const open = rows.filter((row) => OPEN_STATUSES.has(row.status))
  const older = rows.filter((row) => !OPEN_STATUSES.has(row.status))
  const accepted = rows.filter((row) => row.status === "accepted")

  function newEstimate(): void {
    startTransition(async () => {
      const result = await createProjectEstimateDraft(projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("New estimate started.")
      router.push(`/dashboard/projects/${projectId}/estimate?estimateId=${result.id}`)
      router.refresh()
    })
  }

  function startOrder(estimate: ProjectEstimateSummary): void {
    startTransition(async () => {
      const result = await createNuTechOrder(projectId, { title: estimate.title, estimateId: estimate.id })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Order started from this estimate. Add its products on the order page.")
      router.push(`/dashboard/projects/${projectId}/nutech?order=${encodeURIComponent(result.id)}`)
    })
  }

  /** What happens next for an estimate: the order filling it, or starting one once accepted. */
  function nextStep(estimate: ProjectEstimateSummary): React.ReactElement {
    const linked = (orders ?? []).filter((order) => order.estimateNumber === estimate.estimateNumber)
    if (linked.length > 0) {
      return (
        <span className="grid gap-0.5">
          {linked.map((order) => (
            <Link key={order.orderId} href={`/dashboard/projects/${projectId}/nutech?order=${encodeURIComponent(order.orderId)}`} className="hover:underline">
              Order {order.orderNumber} · {nuTechOrderStatusLabel(order.orderStatus)}
            </Link>
          ))}
        </span>
      )
    }
    if (estimate.status !== "accepted") return <span className="text-muted-foreground">When accepted</span>
    return (
      <span className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => startOrder(estimate)} disabled={pending}>
            Start order
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost">
          <Link href={`/dashboard/projects/${projectId}/nutech#nutech-bracing`}>Bracing rental</Link>
        </Button>
      </span>
    )
  }

  function row(estimate: ProjectEstimateSummary): React.ReactElement {
    const active = estimate.id === activeEstimateId
    return (
      <tr key={estimate.id} className={cn("border-b align-top last:border-b-0", active && "bg-muted/40")}>
        <td className="px-3 py-2.5">
          <Link href={`/dashboard/projects/${projectId}/estimate?estimateId=${estimate.id}`} className="font-medium hover:underline">
            {estimate.title}
          </Link>
          <div className="font-mono text-xs text-muted-foreground">{estimate.estimateNumber}</div>
        </td>
        <td className="px-2 py-2.5 tabular-nums">v{estimate.versionNumber}</td>
        <td className="px-2 py-2.5">
          <Badge variant={estimate.status === "accepted" ? "default" : "outline"}>{estimate.status.replaceAll("_", " ")}</Badge>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{money(estimate.estimateTotalCents)}</td>
        {orders ? <td className="px-3 py-2.5">{nextStep(estimate)}</td> : null}
      </tr>
    )
  }

  return (
    <section aria-labelledby="job-estimates-heading" className="clarity-panel mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 id="job-estimates-heading" className="font-semibold">
            Estimates on this job
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {open.length} open · {accepted.length} accepted · each is sent and accepted on its own
          </p>
        </div>
        {canEdit ? (
          <Button type="button" size="sm" onClick={newEstimate} disabled={pending}>
            <IconPlus className="size-4" />
            {pending ? "Starting…" : "New estimate"}
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Estimate</th>
              <th className="px-2 py-2 font-medium">Version</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              {orders ? <th className="px-3 py-2 font-medium">Next step</th> : null}
            </tr>
          </thead>
          <tbody>{open.map(row)}</tbody>
        </table>
      </div>
      {older.length > 0 ? (
        <details className="border-t px-4 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Older estimates ({older.length})</summary>
          <table className="mt-2 w-full min-w-[560px] text-sm">
            <tbody>{older.map(row)}</tbody>
          </table>
        </details>
      ) : null}
    </section>
  )
}
