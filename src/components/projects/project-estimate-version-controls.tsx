"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { IconColumns3, IconCopy, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deleteProjectEstimateDraft,
  duplicateProjectEstimate,
  type ProjectEstimateSummary,
} from "@/app/actions/project-estimates"
import type { ProjectFamilySummary } from "@/app/actions/project-families"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  family,
}: {
  readonly projectId: string
  readonly estimates: readonly ProjectEstimateSummary[]
  readonly activeEstimate: ProjectEstimateSummary
  readonly canEdit: boolean
  readonly canDelete: boolean
  readonly family: ProjectFamilySummary | null
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [destinationPhaseId, setDestinationPhaseId] = useState(
    family?.currentPhaseId ?? "current"
  )
  const [versionNumber, setVersionNumber] = useState("")
  const destinationPhase = family?.phases.find(
    (phase) => phase.id === destinationPhaseId
  )
  const destinationProjectId = destinationPhase?.projectId ?? projectId
  const otherVersion = estimates.find(
    (estimate) => estimate.id !== activeEstimate.id
  )

  function openVersion(estimateId: string): void {
    router.push(
      `/dashboard/projects/${projectId}/estimate?estimateId=${estimateId}`
    )
  }

  function duplicateVersion(): void {
    startTransition(async () => {
      const result = await duplicateProjectEstimate(projectId, activeEstimate.id, {
        destinationPhaseId:
          !family || destinationPhaseId === family.currentPhaseId
            ? null
            : destinationPhaseId,
        versionNumber: versionNumber.trim() ? Number(versionNumber) : null,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDuplicateOpen(false)
      toast.success("Editable estimate copy created.")
      router.push(
        `/dashboard/projects/${destinationProjectId}/estimate?estimateId=${result.id}`
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
        <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" disabled={isPending}>
              <IconCopy className="size-4" />
              Duplicate estimate
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Duplicate estimate</DialogTitle>
              <DialogDescription>
                Copy version {activeEstimate.versionNumber} into an editable estimate in the chosen project phase.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="estimate-destination-phase">Destination phase</Label>
                <Select
                  value={destinationPhaseId}
                  onValueChange={(phaseId) => {
                    setDestinationPhaseId(phaseId)
                    setVersionNumber("")
                  }}
                  disabled={isPending}
                >
                  <SelectTrigger id="estimate-destination-phase" aria-label="Destination phase">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {family ? family.phases.map((phase) => (
                      <SelectItem
                        key={phase.id}
                        value={phase.id}
                        disabled={!phase.projectId}
                      >
                        Phase {phase.sequence} · {phase.name}
                        {phase.projectNumber ? ` · ${phase.projectNumber}` : ""}
                        {phase.projectId ? "" : " · Activate first"}
                      </SelectItem>
                    )) : (
                      <SelectItem value="current">Current project</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {family && <p className="text-xs text-muted-foreground">{family.family.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimate-destination-version">New version number</Label>
                <Input
                  id="estimate-destination-version"
                  type="number"
                  min={1}
                  max={9999}
                  step={1}
                  value={versionNumber}
                  onChange={(event) => setVersionNumber(event.target.value)}
                  placeholder="Next available version"
                  disabled={isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank for the next available version. A chosen number must be higher than existing versions in the destination.
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Any current working estimate in the destination phase will be locked. Review copied terms and relink basis documents after copying to another phase.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDuplicateOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={duplicateVersion} disabled={isPending || !destinationProjectId || (Boolean(family) && !destinationPhase?.projectId)}>
                {isPending ? "Creating copy…" : "Create copy"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
