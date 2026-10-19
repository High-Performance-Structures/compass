"use client"

import { Fragment, useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { IconArrowBackUp, IconCircleCheck, IconDeviceFloppy, IconEye, IconRefresh, IconTrash } from "@tabler/icons-react"

import {
  deleteProjectOwnerPayApplicationDraft,
  markProjectOwnerPayApplicationReady,
  returnProjectOwnerPayApplicationToDraft,
  updateProjectOwnerPayApplicationBudget,
  setProjectOwnerPayApplicationDeposit,
  setProjectOwnerPayApplicationOwnerDetail,
  setProjectOwnerPayApplicationPercentComplete,
  updateProjectOwnerPayApplicationLine,
  type ProjectOwnerPayApplicationDraft,
  type ProjectOwnerPayApplicationLine,
} from "@/app/actions/project-financial-workflows"
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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

function fieldNumber(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? "").replaceAll(/[$,]/g, "").trim()
  if (!raw) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const LINE_GRID =
  "lg:grid-cols-[minmax(14rem,1.6fr)_repeat(8,minmax(6.5rem,.7fr))_auto]"

function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1_000) / 10 : 0
}

function PayApplicationLineEditor({
  projectId,
  applicationId,
  line,
  editable,
  onMessage,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly line: ProjectOwnerPayApplicationLine
  readonly editable: boolean
  readonly onMessage: (message: string) => void
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [ownerVisible, setOwnerVisible] = useState(line.ownerVisible)
  const impliedRetainage =
    line.totalCompletedStored > 0
      ? (line.retainageHeld / line.totalCompletedStored) * 100
      : 0

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const percent = fieldNumber(formData, "percentComplete")
    const percentChanged =
      percent !== null && Math.abs(percent - percentOf(line.totalCompletedStored, line.adjustedEstimate)) > 0.05
    startTransition(async () => {
      const result = await updateProjectOwnerPayApplicationLine(
        projectId,
        applicationId,
        line.id,
        {
          currentWorkCompleted: fieldNumber(formData, "currentWorkCompleted"),
          storedMaterials: fieldNumber(formData, "storedMaterials"),
          retainagePercent: fieldNumber(formData, "retainagePercent"),
          ownerVisible,
        }
      )
      if (!result.success || !percentChanged) {
        onMessage(result.success ? `${line.costCode} saved.` : result.error)
        router.refresh()
        return
      }
      const billed = await setProjectOwnerPayApplicationPercentComplete(projectId, applicationId, {
        scope: "line",
        key: line.id,
        percentComplete: percent,
      })
      onMessage(billed.success ? `${line.costCode} billed to ${percent}% complete.` : billed.error)
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={save}
      className={`grid gap-2 border-b px-3 py-3 text-sm ${LINE_GRID} lg:items-center`}
    >
      <div className="min-w-0">
        <p className="font-medium">{line.costCode} · {line.description}</p>
        <p className="text-xs text-muted-foreground">
          {line.assemblyName ?? `${line.divisionCode} · ${line.divisionName}`}
        </p>
      </div>
      <span className="text-right">{money(line.adjustedEstimate)}</span>
      <span className="text-right">{money(line.previousWorkCompleted)}</span>
      <Input
        key={line.currentWorkCompleted}
        name="currentWorkCompleted"
        inputMode="decimal"
        defaultValue={line.currentWorkCompleted || ""}
        disabled={!editable}
        aria-label={`Current work for ${line.costCode}`}
      />
      <Input
        name="storedMaterials"
        inputMode="decimal"
        defaultValue={line.storedMaterials || ""}
        disabled={!editable}
        aria-label={`Stored materials for ${line.costCode}`}
      />
      <Input
        name="retainagePercent"
        inputMode="decimal"
        defaultValue={impliedRetainage || ""}
        disabled={!editable}
        aria-label={`Retainage percent for ${line.costCode}`}
      />
      <Input
        key={line.totalCompletedStored}
        name="percentComplete"
        inputMode="decimal"
        defaultValue={percentOf(line.totalCompletedStored, line.adjustedEstimate) || ""}
        disabled={!editable}
        aria-label={`Percent complete to date for ${line.costCode}`}
      />
      <span className="text-right">{money(line.totalCompletedStored)}</span>
      <span className="text-right">{money(line.balanceToFinish)}</span>
      <div className="flex items-center justify-end gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <Checkbox
            checked={ownerVisible}
            onCheckedChange={(checked) => setOwnerVisible(checked === true)}
            disabled={!editable}
          />
          Owner
        </label>
        {editable && (
          <Button type="submit" size="icon" variant="outline" disabled={isPending}>
            <IconDeviceFloppy className="size-4" />
            <span className="sr-only">Save {line.costCode}</span>
          </Button>
        )}
      </div>
    </form>
  )
}

const GROUP_BY_OPTIONS = ["division", "assembly", "cost_code"] as const

type GroupBy = (typeof GROUP_BY_OPTIONS)[number]

const GROUP_BY_LABELS: Readonly<Record<GroupBy, string>> = {
  division: "Division",
  assembly: "Assembly",
  cost_code: "Cost code",
}

type LineGroup = {
  readonly scope: GroupBy
  /** Division code, assembly key ("" = outside any assembly), or cost code. */
  readonly key: string
  readonly label: string
  readonly lines: readonly ProjectOwnerPayApplicationLine[]
}

function lineGroups(lines: readonly ProjectOwnerPayApplicationLine[], groupBy: GroupBy): readonly LineGroup[] {
  const groups = new Map<string, { label: string; sort: number; lines: ProjectOwnerPayApplicationLine[] }>()
  lines.forEach((line, index) => {
    const key =
      groupBy === "division" ? line.divisionCode : groupBy === "assembly" ? line.assemblyKey ?? "" : line.costCode
    const label =
      groupBy === "division"
        ? `${line.divisionCode} · ${line.divisionName}`
        : groupBy === "assembly"
          ? line.assemblyName ?? "Other work"
          : `${line.costCode} · ${line.description}`
    const sort = groupBy === "assembly" ? (line.assemblyKey ? line.assemblySort : 1_000_000) : index
    const group = groups.get(key) ?? { label, sort, lines: [] }
    group.lines.push(line)
    groups.set(key, group)
  })
  return [...groups.entries()]
    .sort(([, left], [, right]) => left.sort - right.sort)
    .map(([key, group]) => ({ scope: groupBy, key, label: group.label, lines: group.lines }))
}

/** Group row: bill every line in a division, assembly or cost code to one percent complete. */
function PayApplicationGroupRow({
  projectId,
  applicationId,
  group,
  editable,
  onMessage,
}: {
  readonly projectId: string
  readonly applicationId: string
  readonly group: LineGroup
  readonly editable: boolean
  readonly onMessage: (message: string) => void
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const scheduled = group.lines.reduce((sum, line) => sum + line.adjustedEstimate, 0)
  const completed = group.lines.reduce((sum, line) => sum + line.totalCompletedStored, 0)
  const current = percentOf(completed, scheduled)
  const noun = GROUP_BY_LABELS[group.scope].toLowerCase()

  function bill(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const percent = fieldNumber(new FormData(event.currentTarget), "groupPercent")
    if (percent === null) {
      onMessage(`Enter the ${noun}'s percent complete as a number.`)
      return
    }
    startTransition(async () => {
      const result = await setProjectOwnerPayApplicationPercentComplete(projectId, applicationId, {
        scope: group.scope,
        key: group.key,
        percentComplete: percent,
      })
      onMessage(result.success ? `${group.label} billed to ${percent}% complete.` : result.error)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2 text-sm">
      <div>
        <p className="font-semibold">{group.label}</p>
        <p className="text-xs text-muted-foreground">
          {money(completed)} of {money(scheduled)} · {current}% complete to date
        </p>
      </div>
      {editable && (
        <form onSubmit={bill} className="flex items-center gap-2">
          <Input
            key={current}
            name="groupPercent"
            inputMode="decimal"
            defaultValue={current || ""}
            className="w-24 text-right"
            aria-label={`Percent complete to date for ${group.label}`}
          />
          <span className="text-xs text-muted-foreground">%</span>
          <Button type="submit" variant="outline" size="sm" disabled={isPending}>
            Bill {noun}
          </Button>
        </form>
      )}
    </div>
  )
}

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
            Company default ({PAY_APPLICATION_OWNER_DETAIL_LABELS[application.ownerDetail]})
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
            Earned this draw before the deposit {money(beforeDeposit)} · deposit available {money(application.depositAvailable)} ·{" "}
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
          <p className="text-lg font-semibold tabular-nums">{money(application.depositApplied)}</p>
        )}
      </div>
    </section>
  )
}

export function ProjectOwnerPayApplicationEditor({
  projectId,
  application,
}: {
  readonly projectId: string
  readonly application: ProjectOwnerPayApplicationDraft
}): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const hasAssemblies = application.lines.some((line) => line.assemblyKey !== null)
  const [groupBy, setGroupBy] = useState<GroupBy>(hasAssemblies ? "assembly" : "division")
  const editable = application.status === "draft"

  function updateBudget(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await updateProjectOwnerPayApplicationBudget(projectId, application.id)
      setMessage(result.success ? "Pay application updated to the current contract budget. Work already entered was kept." : result.error)
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
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Period to {application.periodTo ?? "not set"} · Contract budget revision locked to this draw
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
        {(application.newerBudgetRevision || application.assemblySplitStale) && (
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
              <p className="mt-1 text-lg font-semibold">{money(Number(value))}</p>
            </div>
          ))}
        </div>
      </section>

      {(application.depositApplied > 0 || application.depositAvailable > 0) && (
        <PayApplicationDeposit
          projectId={projectId}
          application={application}
          editable={editable}
          onMessage={setMessage}
        />
      )}

      <section className="clarity-panel overflow-x-auto">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-sm">
          <span className="text-muted-foreground">Bill by</span>
          {GROUP_BY_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={groupBy === option ? "default" : "outline"}
              disabled={option === "assembly" && !hasAssemblies}
              onClick={() => setGroupBy(option)}
            >
              {GROUP_BY_LABELS[option]}
            </Button>
          ))}
        </div>
        <div className="min-w-[1180px]">
          <div className={`grid gap-2 border-b bg-muted/35 px-3 py-2 text-xs font-medium uppercase text-muted-foreground grid-cols-[minmax(14rem,1.6fr)_repeat(8,minmax(6.5rem,.7fr))_auto]`}>
            <span>Cost code</span>
            <span className="text-right">Adjusted</span>
            <span className="text-right">Previous</span>
            <span>Current work</span>
            <span>Stored</span>
            <span>Retainage %</span>
            <span>% to date</span>
            <span className="text-right">Total</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Visibility</span>
          </div>
          {lineGroups(application.lines, groupBy).map((group) => (
            <Fragment key={`${group.scope}:${group.key}`}>
              <PayApplicationGroupRow
                projectId={projectId}
                applicationId={application.id}
                group={group}
                editable={editable}
                onMessage={setMessage}
              />
              {group.lines.map((line) => (
                <PayApplicationLineEditor
                  key={line.id}
                  projectId={projectId}
                  applicationId={application.id}
                  line={line}
                  editable={editable}
                  onMessage={setMessage}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </section>
    </div>
  )
}
