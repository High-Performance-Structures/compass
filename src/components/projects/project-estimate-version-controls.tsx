"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { IconColumns3, IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  duplicateProjectEstimate,
  type ProjectEstimateSummary,
} from "@/app/actions/project-estimates"
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

export function ProjectEstimateVersionControls({
  projectId,
  estimates,
  activeEstimate,
  canEdit,
}: {
  readonly projectId: string
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly activeEstimate: ProjectEstimateSummary
  readonly canEdit: boolean
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const otherVersion = estimates.find(
    (estimate) => estimate.id !== activeEstimate.id
  )

  function openVersion(estimateId: string): void {
    router.push(
      `/dashboard/projects/${projectId}/estimate?estimateId=${estimateId}`
    )
  }

  function duplicateVersion(): void {
    if (
      !window.confirm(
        `Create an editable next version from version ${activeEstimate.versionNumber}? The current working version will be preserved and locked.`
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await duplicateProjectEstimate(projectId, activeEstimate.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Editable next estimate version created.")
      router.push(
        `/dashboard/projects/${projectId}/estimate?estimateId=${result.id}`
      )
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select value={activeEstimate.id} onValueChange={openVersion}>
        <SelectTrigger className="w-[190px]" aria-label="Estimate version">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {estimates.map((estimate) => (
            <SelectItem key={estimate.id} value={estimate.id}>
              {versionLabel(estimate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {otherVersion && (
        <Button variant="outline" asChild>
          <Link
            href={`/dashboard/projects/${projectId}/estimate/compare?baseEstimateId=${otherVersion.id}&revisedEstimateId=${activeEstimate.id}`}
          >
            <IconColumns3 className="size-4" />
            Compare versions
          </Link>
        </Button>
      )}
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          onClick={duplicateVersion}
          disabled={isPending}
        >
          <IconCopy className="size-4" />
          {isPending ? "Creating version…" : "Duplicate as next version"}
        </Button>
      )}
    </div>
  )
}
