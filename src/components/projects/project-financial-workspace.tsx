"use client"

import {
  useState,
  useTransition,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import {
  IconFileDollar,
  IconExternalLink,
  IconReceipt,
  IconRefresh,
  IconSend,
} from "@tabler/icons-react"

import { refreshProjectContractBudget } from "@/app/actions/project-contract-budget"
import {
  createProjectOwnerPayApplicationDraft,
  createProjectVendorBillDraft,
  type ProjectFinancialCostCodeOption,
  type ProjectFinancialPhaseOption,
  type ProjectFinancialWorkflowItem,
} from "@/app/actions/project-financial-workflows"
import { ProjectSelectionComboboxInput } from "@/components/projects/project-selection-combobox-input"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DriveItemField } from "@/components/google/drive-item-field"
import { ProjectFinancialQueueTable } from "@/components/projects/project-financial-queue-table"

function textField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim()
  return value.length > 0 ? value : null
}

function requiredTextField(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim()
}

function moneyField(formData: FormData, name: string): number | null {
  const rawValue = String(formData.get(name) ?? "").replace(/[$,]/g, "").trim()
  if (rawValue.length === 0) return null
  const value = Number(rawValue)
  return Number.isFinite(value) ? value : null
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  readonly label: string
  readonly htmlFor: string
  readonly children: React.ReactNode
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function FinancialFormPanel({
  id,
  title,
  description,
  accentClassName,
  icon,
  actionLabel,
  isPending,
  onSubmit,
  children,
}: {
  readonly id?: string
  readonly title: string
  readonly description: string
  readonly accentClassName: string
  readonly icon: ReactNode
  readonly actionLabel: string
  readonly isPending: boolean
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly children: ReactNode
}): ReactElement {
  return (
    <form
      id={id}
      className={`clarity-panel-strong overflow-hidden border-l-4 ${accentClassName}`}
      onSubmit={onSubmit}
    >
      <div className="clarity-section-header flex items-start gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
          {icon}
        </span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-3 px-4 py-4">{children}</div>
      <div className="border-t bg-muted/20 px-4 py-3">
        <Button type="submit" className="w-full" disabled={isPending}>
          {actionLabel}
          <IconSend className="size-4" />
        </Button>
      </div>
    </form>
  )
}

export function ProjectFinancialWorkspace({
  projectId,
  items,
  phaseOptions,
  costCodeOptions,
  projectDriveFolderId,
}: {
  readonly projectId: string
  readonly items: readonly ProjectFinancialWorkflowItem[]
  readonly phaseOptions: readonly ProjectFinancialPhaseOption[]
  readonly costCodeOptions: readonly ProjectFinancialCostCodeOption[]
  readonly projectDriveFolderId: string | null
}): ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  // Imported copies of bills listed under Received payments show there, once.
  const queueItems = items.filter((item) => item.shownUnder === null)
  const shownElsewhere = items.length - queueItems.length
  const differingCopies = items.flatMap((item) => (item.shownUnderNote ? [item.shownUnderNote] : []))
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [vendorBillFormVersion, setVendorBillFormVersion] = useState(0)
  // form.reset() can't clear the Drive field's own state, so remount it.
  const [payApplicationFormVersion, setPayApplicationFormVersion] = useState(0)
  const projectDriveUrl = projectDriveFolderId
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(projectDriveFolderId)}`
    : null

  function handleVendorBill(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectVendorBillDraft(projectId, {
        vendorName: requiredTextField(formData, "vendorName"),
        billNumber: textField(formData, "billNumber"),
        billDate: textField(formData, "billDate"),
        dueDate: textField(formData, "dueDate"),
        amount: moneyField(formData, "amount"),
        costCode: textField(formData, "costCode"),
        phaseCode: textField(formData, "phaseCode"),
        description: textField(formData, "description"),
      })
      setMessage(result.success ? "Vendor bill staged for review." : result.error)
      if (result.success) {
        form.reset()
        setVendorBillFormVersion((version) => version + 1)
      }
      router.refresh()
    })
  }

  function handlePayApplication(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectOwnerPayApplicationDraft(projectId, {
        applicationNumber: textField(formData, "applicationNumber"),
        periodTo: textField(formData, "periodTo"),
        amount: moneyField(formData, "amount"),
        notes: textField(formData, "notes"),
        supportingPackageUrl: textField(formData, "supportingPackageUrl"),
      })
      setMessage(
        result.success ? "Owner pay application staged." : result.error
      )
      if (result.success) {
        form.reset()
        setPayApplicationFormVersion((version) => version + 1)
      }
      router.refresh()
    })
  }

  function handleRebuildBudget(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await refreshProjectContractBudget(projectId)
      setMessage(
        !result.success
          ? result.error
          : result.changed
            ? `Contract budget rebuilt as revision ${result.revisionNumber}. Draft pay applications moved onto it.`
            : `Contract budget revision ${result.revisionNumber} is already up to date.`
      )
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {message && (
        <div className="rounded-md border bg-muted/45 px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <FinancialFormPanel
          key={`vendor-bill-${vendorBillFormVersion}`}
          title="Enter Vendor Bill"
          description={
            developerModeEnabled
              ? "Stage a project bill for Sage review."
              : "Stage a project bill for review."
          }
          accentClassName="border-l-brand-compass-blue"
          icon={<IconReceipt className="size-5" />}
          actionLabel="Stage Bill"
          isPending={isPending}
          onSubmit={handleVendorBill}
        >
            <FormField label="Vendor" htmlFor="vendorName">
              <Input id="vendorName" name="vendorName" required />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Bill number" htmlFor="billNumber">
                <Input id="billNumber" name="billNumber" />
              </FormField>
              <FormField label="Amount" htmlFor="vendorBillAmount">
                <Input id="vendorBillAmount" name="amount" inputMode="decimal" />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Bill date" htmlFor="billDate">
                <Input id="billDate" name="billDate" type="date" />
              </FormField>
              <FormField label="Due date" htmlFor="vendorBillDueDate">
                <Input id="vendorBillDueDate" name="dueDate" type="date" />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Phase" htmlFor="vendorBillPhase">
                <ProjectSelectionComboboxInput
                  id="vendorBillPhase"
                  name="phaseCode"
                  options={phaseOptions}
                  placeholder="Choose or type a phase"
                  emptyMessage="No matching phases."
                  manualInputLabel="Use custom phase"
                />
              </FormField>
              <FormField label="Cost code" htmlFor="vendorBillCostCode">
                <ProjectSelectionComboboxInput
                  id="vendorBillCostCode"
                  name="costCode"
                  options={costCodeOptions}
                  placeholder="Choose or type a cost code"
                  emptyMessage="No matching cost codes."
                  manualInputLabel="Use custom cost code"
                />
              </FormField>
            </div>
            <FormField label="Description" htmlFor="vendorBillDescription">
              <Textarea id="vendorBillDescription" name="description" rows={3} />
            </FormField>
        </FinancialFormPanel>

        <FinancialFormPanel
          title="Owner Pay Application"
          description="Create the next G702/G703 draw from the current accepted contract budget."
          accentClassName="border-l-brand-hps-primary"
          icon={<IconFileDollar className="size-5" />}
          actionLabel="Create From Budget"
          isPending={isPending}
          onSubmit={handlePayApplication}
        >
            <FormField label="Application number" htmlFor="applicationNumber">
              <Input id="applicationNumber" name="applicationNumber" />
            </FormField>
            <FormField label="Period to" htmlFor="periodTo">
              <Input id="periodTo" name="periodTo" type="date" />
            </FormField>
            <p className="text-xs text-muted-foreground">
              Contract value, approved changes, prior billing, and cost-code
              lines come from the locked budget revision. Enter current work
              and stored materials on the generated G703 before review.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handleRebuildBudget}
              >
                <IconRefresh className="size-4" />
                Rebuild contract budget
              </Button>
              <span className="text-xs text-muted-foreground">
                From the signed estimate and executed change orders. Draft
                pay applications keep the work entered.
              </span>
            </div>
            <FormField label="Notes" htmlFor="payApplicationNotes">
              <Textarea id="payApplicationNotes" name="notes" rows={7} />
            </FormField>
            <FormField
              label="Supporting package link"
              htmlFor="supportingPackageUrl"
            >
              <DriveItemField
                key={`supporting-package-${payApplicationFormVersion}`}
                id="supportingPackageUrl"
                name="supportingPackageUrl"
                projectId={projectId}
                ariaLabel="Supporting package"
                browseTitle="Choose the supporting package"
                allowOtherLinks
              />
              {projectDriveUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={projectDriveUrl} target="_blank" rel="noreferrer">
                    <IconExternalLink className="size-4" />
                    Open project Drive
                  </a>
                </Button>
              )}
            </FormField>
        </FinancialFormPanel>
      </section>

      <section className="clarity-panel overflow-hidden">
        <div className="clarity-section-header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Project Financial Queue</h2>
            <p className="text-xs text-muted-foreground">
              {developerModeEnabled
                ? "Review current drafts and read-only historical owner billing."
                : "Review project financial records and their current status."}
            </p>
          </div>
          <Badge variant="outline">{queueItems.length} records</Badge>
        </div>
        {shownElsewhere > 0 && (
          <p className="px-4 pt-3 text-xs text-muted-foreground">
            {shownElsewhere === 1 ? "1 imported bill is" : `${shownElsewhere} imported bills are`} shown under Received payments.
            {differingCopies.length > 0 && ` ${differingCopies.join("; ")}.`}
          </p>
        )}

        {queueItems.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No project financial records have been staged yet.
          </p>
        ) : (
          <div className="p-4">
            <ProjectFinancialQueueTable
              items={queueItems}
              projectId={projectId}
              projectDriveUrl={projectDriveUrl}
              developerModeEnabled={developerModeEnabled}
            />
          </div>
        )}
      </section>
    </div>
  )
}
