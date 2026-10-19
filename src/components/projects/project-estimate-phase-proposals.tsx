"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { IconArrowFork, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  deletePhaseProposal,
  exportEstimateAssemblyAsPhase,
  finishPhaseProposal,
  type ProjectPhaseProposalSummary,
} from "@/app/actions/estimate-phase-proposals"
import { Badge } from "@/components/ui/badge"
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
import type { PhaseProposalContractRemoval } from "@/lib/estimates/phase-proposals"
import { statusLabel } from "@/lib/project-operations/status"

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

function estimateHref(projectId: string, estimateId: string): string {
  return `/dashboard/projects/${encodeURIComponent(projectId)}/estimate?estimateId=${encodeURIComponent(estimateId)}`
}

/** "Export as phase" on one assembly of the contract estimate. */
export function EstimatePhaseExportButton({
  projectId,
  estimateId,
  assemblyId,
  assemblyName,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly assemblyId: string
  readonly assemblyName: string
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phaseName, setPhaseName] = useState(assemblyName)
  const [pending, startTransition] = useTransition()

  function exportPhase(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await exportEstimateAssemblyAsPhase(projectId, estimateId, assemblyId, phaseName)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setOpen(false)
      toast.success("Phase estimate created. The contract estimate is unchanged until it's accepted.")
      router.push(estimateHref(projectId, result.id))
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <IconArrowFork className="size-4" />
          Export as phase
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={exportPhase} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Export {assemblyName} as a phase</DialogTitle>
            <DialogDescription>
              Creates a separate estimate with just this assembly, to print, sign and approve on its own.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`phase-name-${assemblyId}`}>Phase name</Label>
            <Input
              id={`phase-name-${assemblyId}`}
              value={phaseName}
              maxLength={200}
              onChange={(event) => setPhaseName(event.target.value)}
              required
            />
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Nothing changes in the contract estimate or the project family until the phase estimate is accepted.</li>
            <li>When it&apos;s accepted, the assembly comes out of the contract estimate and the phase is added to the project family, ready to activate. If the contract estimate is already signed, a deduct change order is drafted instead.</li>
            <li>If it isn&apos;t accepted, delete the phase estimate; the contract estimate stays as it is.</li>
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || phaseName.trim() === ""}>
              {pending ? "Creating…" : "Create phase estimate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function removalText(proposal: ProjectPhaseProposalSummary, removal: PhaseProposalContractRemoval): string {
  switch (removal) {
    case "removed_from_estimate":
      return `${proposal.assemblyName} was removed from the contract estimate.`
    case "deduct_change_order":
      return proposal.deductChangeOrder
        ? `The contract estimate was signed, so deduct change order ${proposal.deductChangeOrder.number} was drafted for ${proposal.assemblyName}.`
        : `The contract estimate was signed, so a deduct change order was drafted for ${proposal.assemblyName}.`
    case "contract_out_for_signature":
      return `The contract estimate was out for signature, so it still includes ${proposal.assemblyName}. Revise it, or record a deduct change order once it's signed.`
    case "not_in_contract":
      return `The contract estimate no longer had an assembly named ${proposal.assemblyName}, so it wasn't changed.`
  }
}

function ProposalOutcome({ projectId, proposal }: {
  readonly projectId: string
  readonly proposal: ProjectPhaseProposalSummary
}): React.ReactElement | null {
  if (proposal.status !== "accepted") return null
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {proposal.familyPhase && (
        <p>
          Added to the project family as {proposal.familyPhase.projectNumber ?? "a new phase"}
          {proposal.familyPhase.projectId ? "." : ", ready to activate from the project page."}
        </p>
      )}
      {proposal.contractRemoval && <p>{removalText(proposal, proposal.contractRemoval)}</p>}
      {proposal.deductChangeOrder && (
        <Link
          className="text-primary underline-offset-4 hover:underline"
          href={`/dashboard/projects/${encodeURIComponent(projectId)}/change-orders/${encodeURIComponent(proposal.deductChangeOrder.id)}`}
        >
          Open {proposal.deductChangeOrder.number}
        </Link>
      )}
    </div>
  )
}

function useProposalActions(projectId: string): {
  readonly pending: boolean
  readonly remove: (proposal: ProjectPhaseProposalSummary, afterHref: string | null) => void
  readonly finish: (proposal: ProjectPhaseProposalSummary) => void
} {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  function remove(proposal: ProjectPhaseProposalSummary, afterHref: string | null): void {
    if (!window.confirm(`Delete the ${proposal.phaseName} phase estimate and all its versions? The contract estimate isn't affected. This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deletePhaseProposal(projectId, proposal.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Phase estimate deleted.")
      if (afterHref) router.push(afterHref)
      router.refresh()
    })
  }
  function finish(proposal: ProjectPhaseProposalSummary): void {
    startTransition(async () => {
      const result = await finishPhaseProposal(projectId, proposal.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Phase setup finished.")
      router.refresh()
    })
  }
  return { pending, remove, finish }
}

/**
 * On the contract estimate: its phase estimates. On a phase estimate: what
 * it is, and what happened when it was accepted.
 */
export function ProjectEstimatePhaseProposals({
  projectId,
  proposals,
  activeEstimate,
  canEdit,
  canDelete,
}: {
  readonly projectId: string
  readonly proposals: readonly ProjectPhaseProposalSummary[]
  readonly activeEstimate: { readonly id: string; readonly phaseProposalId: string | null; readonly changeOrderId: string | null; readonly status: string }
  readonly canEdit: boolean
  readonly canDelete: boolean
}): React.ReactElement | null {
  const { pending, remove, finish } = useProposalActions(projectId)
  const contractHref = `/dashboard/projects/${encodeURIComponent(projectId)}/estimate`

  if (activeEstimate.phaseProposalId) {
    const proposal = proposals.find((item) => item.id === activeEstimate.phaseProposalId)
    if (!proposal) return null
    const needsFinish = proposal.status !== "accepted" && activeEstimate.status === "accepted"
    return (
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border-l-4 border-l-primary bg-muted/30 px-4 py-3 text-sm">
        <div className="space-y-1">
          <p>
            <span className="font-medium">Phase estimate</span> for {proposal.phaseName}: {proposal.assemblyName} from{" "}
            {proposal.sourceEstimateNumber} version {proposal.sourceVersionNumber}.
          </p>
          {proposal.status === "accepted" ? (
            <ProposalOutcome projectId={projectId} proposal={proposal} />
          ) : (
            <p className="text-xs text-muted-foreground">
              The contract estimate is unchanged. Accepting this estimate takes {proposal.assemblyName} out of it (or
              drafts a deduct change order if it&apos;s signed) and adds {proposal.phaseName} to the project family.
            </p>
          )}
          {needsFinish && (
            <p className="text-xs text-destructive">The phase setup didn&apos;t finish when this estimate was accepted.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {needsFinish && canEdit && (
            <Button size="sm" disabled={pending} onClick={() => finish(proposal)}>Finish phase setup</Button>
          )}
          {proposal.canDelete && canDelete && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => remove(proposal, contractHref)}>
              <IconTrash className="size-4" />
              Delete phase estimate
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href={contractHref}>Back to contract estimate</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (activeEstimate.changeOrderId || proposals.length === 0) return null
  return (
    <section className="rounded-lg border px-4 py-3 text-sm">
      <h3 className="font-medium">Phase estimates</h3>
      <p className="text-xs text-muted-foreground">
        Assemblies offered as their own phase. Each leaves this estimate only when its phase estimate is accepted.
      </p>
      <ul className="mt-2 divide-y">
        {proposals.map((proposal) => (
          <li key={proposal.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {proposal.estimate ? (
                  <Link className="font-medium text-primary underline-offset-4 hover:underline" href={estimateHref(projectId, proposal.estimate.id)}>
                    {proposal.estimate.estimateNumber} · {proposal.phaseName}
                  </Link>
                ) : (
                  <span className="font-medium">{proposal.phaseName}</span>
                )}
                {proposal.estimate && <Badge variant="outline">{statusLabel(proposal.estimate.status)}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {proposal.assemblyName}
                {proposal.estimate ? ` · ${money(proposal.estimate.totalCents)}` : ""}
              </p>
              <ProposalOutcome projectId={projectId} proposal={proposal} />
            </div>
            {proposal.canDelete && canDelete && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(proposal, null)} aria-label={`Delete the ${proposal.phaseName} phase estimate`}>
                <IconTrash className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
