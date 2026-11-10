"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconArrowBackUp, IconCircleCheck, IconEye, IconRefresh, IconTrash } from "@tabler/icons-react"

import {
  deleteProjectOwnerPayApplicationDraft,
  markProjectOwnerPayApplicationReady,
  returnProjectOwnerPayApplicationToDraft,
  updateProjectOwnerPayApplicationBudget,
  setProjectOwnerPayApplicationDeposit,
  setProjectOwnerPayApplicationOwnerDetail,
  type ProjectOwnerPayApplicationDraft,
} from "@/app/actions/project-financial-workflows"
import { overBilledLines, type LineChangeOrder } from "@/lib/financials/pay-application-line-checks"
import type { PayRequestWorkArea } from "@/lib/financials/pay-request-work-areas"
import { PayRequestWorkAreas } from "@/components/financials/pay-request-work-areas"
import {
  PayApplicationBillingGrid,
  fieldNumber,
  type ShopTicketProvenance,
} from "@/components/projects/pay-application-billing-grid"
import { ContextualHelpBeacon } from "@/components/help/contextual-help-beacon"
import { PayApplicationBillingControls, payApplicationStatusLabel } from "@/components/projects/pay-application-billing-controls"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { formatDollars } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  PAY_APPLICATION_OWNER_DETAILS,
  PAY_APPLICATION_OWNER_DETAIL_LABELS,
  isPayApplicationOwnerDetail,
} from "@/lib/financials/pay-application-detail"

/** What the client sees on this pay application. */
function PayApplicationClientDetail({
  projectId,
  application,
  onMessage,
}: {
  readonly projectId: string
  readonly application: ProjectOwnerPayApplicationDraft
  readonly onMessage: (message: string) => void
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const value = application.ownerDetailOverride ?? "default"

  function change(next: string): void {
    const detail = isPayApplicationOwnerDetail(next) ? next : null
    startTransition(async () => {
      const result = await setProjectOwnerPayApplicationOwnerDetail(projectId, application.id, detail)
      onMessage(result.success ? "Client detail saved." : result.error)
      router.refresh()
    })
  }

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Client sees</span>
      <Select value={value} onValueChange={change} disabled={isPending}>
        <SelectTrigger className="w-64" aria-label="Client detail for this pay application">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">
            {application.ownerDetailDefault.source === "estimate" ? "Match signed estimate" : "Company default"}
            {" "}({PAY_APPLICATION_OWNER_DETAIL_LABELS[application.ownerDetailDefault.detail]})
          </SelectItem>
          {PAY_APPLICATION_OWNER_DETAILS.map((detail) => (
            <SelectItem key={detail} value={detail}>
              {PAY_APPLICATION_OWNER_DETAIL_LABELS[detail]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

/** G702 "less deposit applied": the contract deposit taken off this draw. */
function PayApplicationDeposit({
  projectId,
  application,
  editable,
  onMessage,
}: {
  readonly projectId: string
  readonly application: ProjectOwnerPayApplicationDraft
  readonly editable: boolean
  readonly onMessage: (message: string) => void
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const beforeDeposit = Math.max(0, application.totalEarnedLessRetainage - application.previousCertificates)

  function apply(mode: "auto" | "manual", amount: number | null): void {
    startTransition(async () => {
      const result = await setProjectOwnerPayApplicationDeposit(projectId, application.id, { mode, amount })
      onMessage(result.success ? "Deposit applied." : result.error)
      router.refresh()
    })
  }

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const amount = fieldNumber(new FormData(event.currentTarget), "depositApplied")
    if (amount === null) {
      onMessage("Enter the deposit to apply as a dollar amount.")
      return
    }
    apply("manual", amount)
  }

  return (
    <section className="clarity-panel px-4 py-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold">Less deposit applied</h3>
          <p className="text-xs text-muted-foreground">
            Earned this draw before the deposit {formatDollars(beforeDeposit)} · deposit available {formatDollars(application.depositAvailable)} ·{" "}
            {application.depositAppliedMode === "auto" ? "applied automatically" : "set by hand"}
          </p>
        </div>
        {editable ? (
          <form onSubmit={save} className="flex flex-wrap items-center gap-2">
            <Input
              key={application.depositApplied}
              name="depositApplied"
              inputMode="decimal"
              defaultValue={application.depositApplied ? application.depositApplied.toFixed(2) : ""}
              className="w-36 text-right"
              aria-label="Deposit applied to this pay application"
            />
            <Button type="submit" variant="outline" size="sm" disabled={isPending}>
              Apply amount
            </Button>
            {application.depositAppliedMode === "manual" && (
              <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => apply("auto", null)}>
                Apply automatically
              </Button>
            )}
          </form>
        ) : (
          <p className="text-lg font-semibold tabular-nums">{formatDollars(application.depositApplied)}</p>
        )}
      </div>
    </section>
  )
}

export function ProjectOwnerPayApplicationEditor({
  projectId,
  application,
  shopTicketProvenance,
  lineChangeOrders = {},
  sageSynced = false,
  initialWorkArea,
  workAreas,
}: {
  readonly projectId: string
  readonly application: ProjectOwnerPayApplicationDraft
  /** Shop ticket amounts imported onto each line; empty when the person can't see shop tickets. */
  readonly shopTicketProvenance: readonly ShopTicketProvenance[]
  /** Change orders behind each row's change, by cost code and assembly; empty when not loaded. */
  readonly lineChangeOrders?: Readonly<Record<string, readonly LineChangeOrder[]>>
  /** Billed amounts are synced from Sage, so they are read only here. */
  readonly sageSynced?: boolean
  /** The "Work on" area from `?work=`. */
  readonly initialWorkArea: PayRequestWorkArea
  /** The page's other work areas, rendered on the server; Billing is the grid here. */
  readonly workAreas: Readonly<Record<Exclude<PayRequestWorkArea, "billing">, React.ReactNode>>
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const editable = application.status === "draft"
  const overBilled = overBilledLines(application.lines)
  const overBilledWarning =
    overBilled.length > 0
      ? `${overBilled.length === 1 ? `${overBilled[0]?.costCode} is` : `${overBilled.length} lines are`} billed past the scheduled value, often after a credit change order. Bill ${overBilled.length === 1 ? "it" : "them"} to 100% unless the overage is intended.`
      : null
  const amountsEditable = editable && !sageSynced

  function updateBudget(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectOwnerPayApplicationBudget(projectId, application.id)
      setMessage(result.success ? "Pay application updated to the current contract budget. Work already entered was kept, and fully billed lines stay at 100%." : result.error)
      router.refresh()
    })
  }

  function deleteDraft(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await deleteProjectOwnerPayApplicationDraft(projectId, application.id)
      if (!result.success) {
        setMessage(result.error)
        return
      }
      router.push(`/dashboard/projects/${projectId}/financials`)
    })
  }

  function returnToDraft(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await returnProjectOwnerPayApplicationToDraft(projectId, application.id)
      setMessage(result.success ? "Pay application is a draft again and can be edited." : result.error)
      router.refresh()
    })
  }

  function readyForReview(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await markProjectOwnerPayApplicationReady(
        projectId,
        application.id
      )
      setMessage(
        result.success
          ? developerModeEnabled
            ? "Pay application is ready for internal Sage review."
            : "Pay application is ready for review."
          : result.error
      )
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {message && <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm">{message}</div>}
      <section className="clarity-panel-strong overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Pay application {application.applicationNumber}</h2>
              <ContextualHelpBeacon topicId="financials.pay-applications" />
              <Badge>{payApplicationStatusLabel(application.status)}</Badge>
              {sageSynced && (
                <span className="text-xs font-normal text-muted-foreground" title="Billed amounts are synced from Sage">
                  [Sage]
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Period to {application.periodTo ?? "not set"} ·{" "}
              {sageSynced ? "Billed amounts synced from Sage" : "Contract budget revision locked to this draw"}
            </p>
            <div className="mt-2">
              <PayApplicationClientDetail projectId={projectId} application={application} onMessage={setMessage} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <a href={`/print/projects/${projectId}/pay-application?applicationId=${application.id}`} target="_blank" rel="noopener">
                <IconEye className="size-4" />
                Print Preview
              </a>
            </Button>
            <PayApplicationBillingControls projectId={projectId} application={application} onMessage={setMessage} />
            {application.status === "internal_review" && (
              <Button variant="outline" onClick={returnToDraft} disabled={isPending}>
                <IconArrowBackUp className="size-4" />
                Return to draft
              </Button>
            )}
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={isPending}>
                      <IconTrash className="size-4" />
                      Delete draft
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete pay application {application.applicationNumber}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The draft and the work entered on it are removed. Any deposit it applied becomes available to other drafts. This can&apos;t be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={deleteDraft}>Delete draft</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={isPending || (application.currentPaymentDue <= 0 && application.depositApplied <= 0)}>
                      <IconCircleCheck className="size-4" />
                      {developerModeEnabled ? "Ready for Sage review" : "Ready for review"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Mark pay application {application.applicationNumber} ready for review?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This locks the draw so it can be reviewed and entered in Sage. You can send it back to draft while it&apos;s in review.
                      </AlertDialogDescription>
                      {overBilledWarning && (
                        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                          {overBilledWarning}
                        </p>
                      )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep editing</AlertDialogCancel>
                      <AlertDialogAction onClick={readyForReview}>Mark ready</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        </div>
        {overBilledWarning && (
          <p role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <IconAlertTriangle className="size-4 shrink-0" />
            {overBilledWarning}
          </p>
        )}
        {!sageSynced && (application.newerBudgetRevision || application.assemblySplitStale) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/35 px-4 py-3 text-sm">
            <p>
              {application.newerBudgetRevision
                ? `Contract budget revision ${application.newerBudgetRevision.revisionNumber} is current, with changes this draft doesn't include yet, such as executed change orders.`
                : "The estimate's assemblies changed since this draft was made. Update it to bill by the current assemblies."}
            </p>
            <Button size="sm" onClick={updateBudget} disabled={isPending}>
              <IconRefresh className="size-4" />
              {application.newerBudgetRevision
                ? `Update to revision ${application.newerBudgetRevision.revisionNumber}`
                : "Update assemblies"}
            </Button>
          </div>
        )}
        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {[
            ["Contract to date", application.contractSumToDate],
            ["Completed + stored", application.totalCompletedStoredToDate],
            ["Current payment due", application.currentPaymentDue],
            ["Balance to finish", application.balanceToFinish],
          ].map(([label, value]) => (
            <div key={String(label)} className="px-4 py-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold">{formatDollars(Number(value))}</p>
            </div>
          ))}
        </div>
      </section>

      {(application.depositApplied > 0 || application.depositAvailable > 0) && (
        <PayApplicationDeposit
          projectId={projectId}
          application={application}
          editable={amountsEditable}
          onMessage={setMessage}
        />
      )}

      <PayRequestWorkAreas
        initialArea={initialWorkArea}
        areas={{
          billing: (
            <PayApplicationBillingGrid
              projectId={projectId}
              applicationId={application.id}
              lines={application.lines}
              editable={amountsEditable}
              shopTicketProvenance={shopTicketProvenance}
              lineChangeOrders={lineChangeOrders}
              onMessage={setMessage}
            />
          ),
          ...workAreas,
        }}
      />
    </div>
  )
}
