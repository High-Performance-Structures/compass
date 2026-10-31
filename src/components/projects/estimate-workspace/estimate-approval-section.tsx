"use client"

import Link from "next/link"
import { IconFileDescription, IconReceiptTax, IconSend } from "@tabler/icons-react"

import {
  markProjectEstimateSentOutsideCompass,
  prepareProjectEstimateForClientSignature,
  type ProjectEstimateSummary,
  type ProjectEstimateWorkspace,
} from "@/app/actions/project-estimates"
import { Button } from "@/components/ui/button"
import {
  acceptedEstimateDateLabel,
  acceptedEstimateEvidenceUrl,
} from "@/lib/estimates/accepted-document"
import {
  estimateAcceptanceMethodLabel,
  isEstimateAcceptanceMethod,
} from "@/lib/estimates/manual-acceptance"

import { EstimateManualAcceptanceForm } from "./estimate-manual-acceptance-form"
import type { EstimateWorkspaceRunner } from "./use-estimate-line-editor"

/** The approval state the workspace keeps across estimate versions. */
export type EstimateApprovalState = {
  readonly signatureMessage: string | null
  readonly setSignatureMessage: (message: string | null) => void
  readonly acceptanceChangesContract: boolean
  readonly setAcceptanceChangesContract: (value: boolean) => void
  readonly manualAcceptanceAttested: boolean
  readonly setManualAcceptanceAttested: (value: boolean) => void
}

/** Signature routes, manual acceptance and the accepted-estimate summary. */
export function EstimateApprovalSection({
  runner,
  estimate,
  workspace,
  editable,
  hidden,
  approval,
}: {
  readonly runner: EstimateWorkspaceRunner
  readonly estimate: ProjectEstimateSummary
  readonly workspace: ProjectEstimateWorkspace
  readonly editable: boolean
  readonly hidden: boolean
  readonly approval: EstimateApprovalState
}): React.ReactElement {
  const { projectId, isPending, startTransition, setMessage, finish } = runner
  const { signatureMessage, setSignatureMessage } = approval
  const acceptedEvidenceUrl = acceptedEstimateEvidenceUrl(estimate)

  function prepareForSignature(): void {
    setMessage(null)
    setSignatureMessage("Preparing the final signature package…")
    // Reserve the tab during the user gesture so popup blockers do not discard
    // the Foxit session after the asynchronous PDF and envelope work finishes.
    const foxitWindow = window.open("about:blank", "_blank")
    if (foxitWindow) {
      foxitWindow.opener = null
      foxitWindow.document.title = "Preparing Foxit signature package"
      foxitWindow.document.body.textContent =
        "Compass is preparing the estimate for Foxit. This tab will continue automatically."
    }
    startTransition(async () => {
      const result = await prepareProjectEstimateForClientSignature(
        projectId,
        estimate.id
      )
      const resultMessage = result.success
        ? "Signature package prepared. Review it in Foxit and use Foxit’s Send button only when it is ready. If the Foxit tab did not open, use Review and send in Foxit below."
        : result.error
      setSignatureMessage(resultMessage)
      finish(resultMessage)
      if (result.success) {
        if (foxitWindow) {
          foxitWindow.location.replace(result.embeddedSessionUrl)
        }
      } else {
        foxitWindow?.close()
      }
    })
  }

  function markSentOutsideCompass(): void {
    if (!window.confirm("Confirm that this exact version is being sent or printed for signatures outside Compass. It will become read-only; changes require a duplicate version.")) return
    setMessage(null)
    startTransition(async () => {
      const result = await markProjectEstimateSentOutsideCompass(projectId, estimate.id)
      finish(
        result.success
          ? "Version frozen for outside signatures. Upload or link the fully signed copy when complete."
          : result.error
      )
    })
  }

  return (
      <section
        className="clarity-panel-strong p-4"
        hidden={hidden}
      >
        <div className="flex items-start gap-3">
          <IconReceiptTax className="mt-0.5 size-5 text-primary" />
          <div className="flex-1">
            <h2 className="font-semibold">Approval and accounting handoff</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Prepare and review the final package without locking the estimate.
              When it is sent from Foxit, this version is frozen against edits.
              It locks automatically only after every required signer finishes,
              or after a complete manually signed copy is recorded.
            </p>
            <div className="mt-3 border-y py-3">
              <p className="text-sm font-medium">Choose the signature route</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Send this estimate by itself for H, N, D, and change-order work,
                or assemble the estimate as CA22 inside a full construction contract packet.
              </p>
              <Button className="mt-3" variant="outline" asChild>
                <Link href={`/dashboard/projects/${projectId}/contracts`}>
                  <IconFileDescription className="size-4" />Full construction contract
                </Link>
              </Button>
            </div>
            {editable && (
              <Button className="mt-3" onClick={prepareForSignature} disabled={isPending || workspace.lines.length === 0}>
                <IconSend className="size-4" />Prepare estimate-only version for client signature
              </Button>
            )}
            {editable && (
              <Button className="ml-2 mt-3" variant="outline" onClick={markSentOutsideCompass} disabled={isPending || workspace.lines.length === 0}>
                Sent / printed for signatures outside Compass
              </Button>
            )}
            {editable && estimate.foxitStatus === "preparing" && estimate.foxitEmbeddedSessionUrl && (
              <Button className="ml-2 mt-3" variant="outline" asChild>
                <Link href={estimate.foxitEmbeddedSessionUrl} target="_blank">
                  Review and send in Foxit
                </Link>
              </Button>
            )}
            {editable && !estimate.contractTerms?.trim() && (
              <p className="mt-3 text-sm text-muted-foreground">
                Contract terms are required. Add and save them under Contract
                terms &amp; acknowledgements before preparing the final
                signature package.
              </p>
            )}
            {signatureMessage && (
              <div
                className="mt-3 rounded-md border bg-muted/35 px-3 py-2 text-sm"
                role="status"
                aria-live="polite"
              >
                {signatureMessage}
              </div>
            )}
            {estimate.status === "signature_pending" && workspace.canEdit && (
              <div className="mt-4 space-y-5 border-t pt-4">
                {estimate.foxitStatus === "completed" && (
                  <div>
                    <h3 className="text-sm font-semibold">Signed in Foxit</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Every signer completed this version. Because it changes the accepted contract, record the
                      acceptance below and choose whether it replaces the contract or becomes a change order.
                    </p>
                  </div>
                )}
                {estimate.foxitStatus !== "not_applicable" && estimate.foxitStatus !== "completed" && (
                  <div>
                    <h3 className="text-sm font-semibold">Foxit signatures in progress</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This version is read-only. Compass will accept and lock it automatically after Foxit confirms that every required signer has completed the envelope.
                    </p>
                  </div>
                )}

                <EstimateManualAcceptanceForm
                  runner={runner}
                  estimate={estimate}
                  approval={approval}
                />
              </div>
            )}
            {estimate.status === "accepted" && (
              <div className="mt-4 border-t pt-4 text-sm">
                <p className="font-medium text-success">
                  Accepted estimate is locked. Budget changes now require an executed change order.
                </p>
                <dl className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Acceptance method</dt>
                    <dd>
                      {isEstimateAcceptanceMethod(estimate.acceptanceMethod)
                        ? estimateAcceptanceMethodLabel(estimate.acceptanceMethod)
                        : "Previously recorded acceptance"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Acceptance date</dt>
                    <dd>
                      {acceptedEstimateDateLabel(
                        estimate.signedAt ?? estimate.acceptedAt
                      )}
                    </dd>
                  </div>
                  {estimate.acceptanceRecordedByName && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Recorded by</dt>
                      <dd>{estimate.acceptanceRecordedByName}</dd>
                    </div>
                  )}
                  {estimate.acceptanceNote && (
                    <div className="md:col-span-2">
                      <dt className="text-xs text-muted-foreground">Acceptance note</dt>
                      <dd className="whitespace-pre-wrap">{estimate.acceptanceNote}</dd>
                    </div>
                  )}
                </dl>
                {acceptedEvidenceUrl && (
                  <Button className="mt-3" variant="outline" size="sm" asChild>
                    <Link href={acceptedEvidenceUrl} target="_blank">
                      <IconFileDescription className="size-4" />
                      {estimate.acceptanceEvidenceLabel ?? "Open signed estimate"}
                    </Link>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
  )
}
