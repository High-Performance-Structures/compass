"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { IconArrowLeft, IconPrinter } from "@tabler/icons-react"

import type { ProjectEstimateSummary } from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function versionLabel(estimate: ProjectEstimateSummary): string {
  const date = estimate.estimateDate ?? estimate.createdAt.slice(0, 10)
  return `Version ${estimate.versionNumber} · ${date}`
}

export function ProjectEstimateComparisonControls({
  projectId,
  estimates,
  baseEstimate,
  revisedEstimate,
}: {
  readonly projectId: string
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly baseEstimate: ProjectEstimateSummary
  readonly revisedEstimate: ProjectEstimateSummary
}): React.ReactElement {
  const router = useRouter()

  function comparisonHref(baseId: string, revisedId: string): string {
    return `/dashboard/projects/${projectId}/estimate/compare?baseEstimateId=${baseId}&revisedEstimateId=${revisedId}`
  }

  function selectBase(baseId: string): void {
    router.push(comparisonHref(baseId, revisedEstimate.id))
  }

  function selectRevised(revisedId: string): void {
    router.push(comparisonHref(baseEstimate.id, revisedId))
  }

  const query = `baseEstimateId=${baseEstimate.id}&revisedEstimateId=${revisedEstimate.id}`

  return (
    <div className="estimate-comparison-controls flex flex-wrap items-end gap-3">
      <Button variant="ghost" asChild>
        <Link
          href={`/dashboard/projects/${projectId}/estimate?estimateId=${revisedEstimate.id}`}
        >
          <IconArrowLeft className="size-4" />
          Estimate
        </Link>
      </Button>
      <div className="min-w-[210px] space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Base version</p>
        <Select value={baseEstimate.id} onValueChange={selectBase}>
          <SelectTrigger aria-label="Base estimate version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {estimates.map((estimate) => (
              <SelectItem
                key={estimate.id}
                value={estimate.id}
                disabled={estimate.id === revisedEstimate.id}
              >
                {versionLabel(estimate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-[210px] space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          Revised version
        </p>
        <Select value={revisedEstimate.id} onValueChange={selectRevised}>
          <SelectTrigger aria-label="Revised estimate version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {estimates.map((estimate) => (
              <SelectItem
                key={estimate.id}
                value={estimate.id}
                disabled={estimate.id === baseEstimate.id}
              >
                {versionLabel(estimate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button className="ml-auto" asChild>
        <Link
          href={`/print/projects/${projectId}/estimate/compare?${query}`}
          target="_blank"
        >
          <IconPrinter className="size-4" />
          Print comparison
        </Link>
      </Button>
    </div>
  )
}
