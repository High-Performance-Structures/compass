"use client"

import { statusLabel } from "@/lib/project-operations/status"
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
import type { ProjectFamilySummary } from "@/lib/domain/families/rules"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { EstimateMode } from "@/lib/estimates/estimate-modes"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function versionLabel(estimate: ProjectEstimateSummary): string {
  const date = estimate.estimateDate ?? estimate.createdAt.slice(0, 10)
  // Number and status keep look-alike versions apart (e.g. an accepted
  // contract estimate beside an unrelated imported draft).
  return `${estimate.estimateNumber} · v${estimate.versionNumber} · ${statusLabel(estimate.status)} · ${date}`
}

export function ProjectEstimateVersionControls({
  projectId,
  estimates,
  activeEstimate,
  canEdit,
  canDelete,
  family,
  estimateMode = "single",
}: {
  readonly projectId: string
  readonly estimates: readonly ProjectEstimateSummary[]
  /** "multiple": the department allows several estimates per job. */
  readonly estimateMode?: EstimateMode
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
  const multiple = estimateMode === "multiple"
  // Several estimates per job: a copy is a separate estimate unless chosen otherwise.
  const [kind, setKind] = useState<"separate" | "version">(multiple ? "separate" : "version")
  const [copyTitle, setCopyTitle] = useState(`${activeEstimate.title} (copy)`)
  const separate = multiple && kind === "separate"
  // Versions of the estimate that's open; other estimates are listed above.
  const versions = multiple
    ? estimates.filter((estimate) => estimate.estimateNumber === activeEstimate.estimateNumber)
    : estimates
  const destinationPhase = family?.phases.find(
    (phase) => phase.id === destinationPhaseId
  )
  const destinationProjectId = destinationPhase?.projectId ?? projectId
  const otherVersion = versions.find(
    (estimate) => estimate.id !== activeEstimate.id
  )

  function openVersion(estimateId: string): void {
    router.push(
      `/dashboard/projects/${projectId}/estimate?estimateId=${estimateId}`
    )
  }

  function duplicateVersion(): void {
    startTransition(async () => {
      const result = await duplicateProjectEstimate(projectId, activeEstimate.id, separate
        ? { destinationPhaseId: null, versionNumber: null, kind: "separate", title: copyTitle }
        : {
            destinationPhaseId:
              !family || destinationPhaseId === family.currentPhaseId
                ? null
                : destinationPhaseId,
            versionNumber: versionNumber.trim() ? Number(versionNumber) : null,
            kind: "version",
          })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDuplicateOpen(false)
      toast.success("Editable estimate copy created.")
      router.push(
        `/dashboard/projects/${separate ? projectId : destinationProjectId}/estimate?estimateId=${result.id}`
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
        <SelectTrigger className="w-[min(100%,22rem)]" aria-label="Estimate version">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((estimate) => (
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
        <Dialog
          open={duplicateOpen}
          onOpenChange={(next) => {
            setDuplicateOpen(next)
            if (next) {
              setKind(multiple ? "separate" : "version")
              setCopyTitle(`${activeEstimate.title} (copy)`)
            }
          }}
        >
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
                {multiple
                  ? `${activeEstimate.estimateNumber} · version ${activeEstimate.versionNumber}`
                  : `Copy version ${activeEstimate.versionNumber} into an editable estimate in the chosen project phase.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {multiple ? (
                <RadioGroup value={kind} onValueChange={(value) => setKind(value === "version" ? "version" : "separate")} className="gap-2">
                  <Label htmlFor="duplicate-separate" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[:checked]:border-primary">
                    <RadioGroupItem id="duplicate-separate" value="separate" className="mt-0.5" />
                    <span className="grid gap-1">
                      <span className="font-medium">A separate estimate</span>
                      <span className="text-sm text-muted-foreground">Gets the next estimate number. The original stays as it is and can still be sent and accepted.</span>
                    </span>
                  </Label>
                  <Label htmlFor="duplicate-version" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[:checked]:border-primary">
                    <RadioGroupItem id="duplicate-version" value="version" className="mt-0.5" />
                    <span className="grid gap-1">
                      <span className="font-medium">A new version of this estimate</span>
                      <span className="text-sm text-muted-foreground">Replaces version {activeEstimate.versionNumber}, which is kept for the record. Use this when the customer asked for changes.</span>
                    </span>
                  </Label>
                </RadioGroup>
              ) : null}
              {separate ? (
                <div className="space-y-2">
                  <Label htmlFor="estimate-copy-title">Name</Label>
                  <Input id="estimate-copy-title" value={copyTitle} maxLength={200} onChange={(event) => setCopyTitle(event.target.value)} disabled={isPending} />
                  <p className="text-xs text-muted-foreground">Lines, customer, tax district and terms are copied. Signatures and acceptance never are.</p>
                </div>
              ) : null}
              <div className="space-y-4" hidden={separate}>
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
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDuplicateOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="button" onClick={duplicateVersion} disabled={isPending || (separate ? copyTitle.trim() === "" : !destinationProjectId || (Boolean(family) && !destinationPhase?.projectId))}>
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
