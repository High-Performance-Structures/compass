"use client"

import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { IconCircleCheck, IconDeviceFloppy } from "@tabler/icons-react"

import {
  markProjectOwnerPayApplicationReady,
  updateProjectOwnerPayApplicationLine,
  type ProjectOwnerPayApplicationDraft,
  type ProjectOwnerPayApplicationLine,
} from "@/app/actions/project-financial-workflows"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"

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
      onMessage(result.success ? `${line.costCode} saved.` : result.error)
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={save}
      className="grid gap-2 border-b px-3 py-3 text-sm lg:grid-cols-[minmax(14rem,1.6fr)_repeat(7,minmax(7rem,.7fr))_auto] lg:items-center"
    >
      <div className="min-w-0">
        <p className="font-medium">{line.costCode} · {line.description}</p>
        <p className="text-xs text-muted-foreground">
          {line.divisionCode} · {line.divisionName}
        </p>
      </div>
      <span className="text-right">{money(line.adjustedEstimate)}</span>
      <span className="text-right">{money(line.previousWorkCompleted)}</span>
      <Input
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

export function ProjectOwnerPayApplicationEditor({
  projectId,
  application,
}: {
  readonly projectId: string
  readonly application: ProjectOwnerPayApplicationDraft
}): React.ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const editable = application.status === "draft"

  function readyForReview(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await markProjectOwnerPayApplicationReady(
        projectId,
        application.id
      )
      setMessage(
        result.success
          ? "Pay application is ready for internal Sage review."
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
              <Badge>{application.status.replaceAll("_", " ")}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Period to {application.periodTo ?? "not set"} · Contract budget revision locked to this draw
            </p>
          </div>
          {editable && (
            <Button onClick={readyForReview} disabled={isPending || application.currentPaymentDue <= 0}>
              <IconCircleCheck className="size-4" />Ready for Sage review
            </Button>
          )}
        </div>
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

      <section className="clarity-panel overflow-x-auto">
        <div className="min-w-[1080px]">
          <div className="grid grid-cols-[minmax(14rem,1.6fr)_repeat(7,minmax(7rem,.7fr))_auto] gap-2 border-b bg-muted/35 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
            <span>Cost code</span>
            <span className="text-right">Adjusted</span>
            <span className="text-right">Previous</span>
            <span>Current work</span>
            <span>Stored</span>
            <span>Retainage %</span>
            <span className="text-right">Total</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Visibility</span>
          </div>
          {application.lines.map((line) => (
            <PayApplicationLineEditor
              key={line.id}
              projectId={projectId}
              applicationId={application.id}
              line={line}
              editable={editable}
              onMessage={setMessage}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
