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
  IconSend,
} from "@tabler/icons-react"

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

function money(value: number | null): string {
  if (value === null) return "-"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function dateText(value: string | null): string {
  if (!value) return "-"
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function workflowLabel(type: ProjectFinancialWorkflowItem["type"]): string {
  if (type === "vendor_bill") return "Vendor bill"
  if (type === "owner_pay_application") return "Owner pay app"
  if (type === "owner_invoice") return "Owner invoice"
  if (type === "payment") return "Payment"
  if (type === "deposit") return "Deposit"
  if (type === "credit_memo") return "Credit memo"
  return "RFQ"
}

function syncLabel(item: ProjectFinancialWorkflowItem): string {
  if (item.syncStatus === "pending_sage") return "Pending Sage"
  if (item.syncStatus === "queued_sage") return "Queued"
  if (item.syncStatus === "synced") return "Synced"
  if (item.syncStatus === "compass_only") return "Compass only"
  return item.syncStatus
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
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [vendorBillFormVersion, setVendorBillFormVersion] = useState(0)
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
      if (result.success) form.reset()
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
            <FormField label="Notes" htmlFor="payApplicationNotes">
              <Textarea id="payApplicationNotes" name="notes" rows={7} />
            </FormField>
            <FormField
              label="Supporting package link"
              htmlFor="supportingPackageUrl"
            >
              <Input
                id="supportingPackageUrl"
                name="supportingPackageUrl"
                type="url"
                placeholder="https://drive.google.com/..."
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
          <Badge variant="outline">{items.length} records</Badge>
        </div>

        {items.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No project financial records have been staged yet.
          </p>
        ) : (
          <div className="m-4 overflow-hidden rounded-md border">
            <div className="grid grid-cols-[1fr_.7fr_.7fr_.8fr] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
              <span>Record</span>
              <span>Amount</span>
              <span>Date</span>
              <span>Status</span>
            </div>
            <div className="divide-y">
              {items.map((item) => {
                const supportingHref =
                  item.supportingPackageUrl ??
                  (item.type === "owner_pay_application"
                    ? projectDriveUrl
                    : null)
                return (
                  <div
                    key={item.id}
                    className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-[1fr_.7fr_.7fr_.8fr] sm:items-center sm:gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {workflowLabel(item.type)}
                        </span>
                        {item.sourceLabel && (
                          <Badge variant="secondary">{item.sourceLabel}</Badge>
                        )}
                        {item.number && (
                          <span className="text-xs text-muted-foreground">
                            {item.number}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-muted-foreground">
                        {item.title}
                      </p>
                      {item.companyName && (
                        <p className="truncate text-xs text-muted-foreground">
                          {item.companyName}
                        </p>
                      )}
                      {supportingHref && (
                        <Button
                          asChild
                          size="sm"
                          variant="link"
                          className="mt-1 h-auto justify-start p-0"
                        >
                          <a
                            href={supportingHref}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <IconExternalLink className="size-4" />
                            {item.supportingPackageUrl
                              ? "Open supporting package"
                              : "Open project Drive"}
                          </a>
                        </Button>
                      )}
                      {item.type === "owner_pay_application" &&
                        item.sourceRecordId &&
                        item.paymentBreakdown !== null && (
                          <Button
                            asChild
                            size="sm"
                            variant="link"
                            className="mt-1 h-auto justify-start p-0"
                          >
                            <a
                              href={`/dashboard/projects/${projectId}/financials/pay-applications/${item.sourceRecordId}`}
                            >
                              Edit G702 / G703
                            </a>
                          </Button>
                        )}
                    </div>
                    <div>
                      <span>{money(item.amount)}</span>
                      {item.paymentBreakdown &&
                        item.paymentBreakdown.depositApplied > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {money(item.paymentBreakdown.currentPaymentDue)} due
                            after {money(item.paymentBreakdown.depositApplied)}
                            {" deposit"}
                          </p>
                        )}
                    </div>
                    <span>{dateText(item.dueDate)}</span>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{item.status}</Badge>
                      {item.readOnly && (
                        <Badge variant="outline">Read only</Badge>
                      )}
                      {developerModeEnabled && (
                        <Badge variant="secondary">{syncLabel(item)}</Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
