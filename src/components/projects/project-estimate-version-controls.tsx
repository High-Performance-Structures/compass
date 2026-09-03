"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { IconColumns3, IconCopy, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deleteProjectEstimateDraft,
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
  canDelete,
}: {
  readonly projectId: string
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly activeEstimate: ProjectEstimateSummary
  readonly canEdit: boolean
  readonly canDelete: boolean
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

  function deleteDraft(): void {
    if (
      !window.confirm(
        `Permanently delete draft version ${activeEstimate.versionNumber}? This deletes the entire draft, including its estimate lines, cost breakdowns, basis references, and imported RFQ bid links. This cannot be undone.`
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await deleteProjectEstimateDraft(
        projectId,
        activeEstimate.id
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Estimate draft deleted.")
      router.push(`/dashboard/projects/${projectId}/estimate`)
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
      {canDelete && activeEstimate.status === "draft" && (
        <Button
          type="button"
          variant="destructive"
          onClick={deleteDraft}
          disabled={isPending}
        >
          <IconTrash className="size-4" />
          {isPending ? "Deleting draft…" : "Delete draft"}
        </Button>
      )}
    </div>
  )
}
