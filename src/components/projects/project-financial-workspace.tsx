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
  IconReceipt,
  IconSend,
  IconShoppingCartQuestion,
} from "@tabler/icons-react"

import {
  createProjectOwnerPayApplicationDraft,
  createProjectRfqDraft,
  createProjectVendorBillDraft,
  type ProjectFinancialWorkflowItem,
} from "@/app/actions/project-financial-workflows"
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
  mode = "all",
}: {
  readonly projectId: string
  readonly items: readonly ProjectFinancialWorkflowItem[]
  readonly mode?: "all" | "rfq"
}): ReactElement {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const visibleItems =
    mode === "rfq" ? items.filter((item) => item.type === "rfq") : items

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
      if (result.success) form.reset()
      router.refresh()
    })
  }

  function handleRfq(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    setMessage(null)
    startTransition(async () => {
      const result = await createProjectRfqDraft(projectId, {
        title: requiredTextField(formData, "title"),
        vendorCategory: textField(formData, "vendorCategory"),
        requestedFrom: textField(formData, "requestedFrom"),
        responseDueDate: textField(formData, "responseDueDate"),
        priority: textField(formData, "priority") ?? "normal",
        scope: textField(formData, "scope"),
      })
      setMessage(result.success ? "RFQ draft created." : result.error)
      if (result.success) form.reset()
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

      <section
        className={
          mode === "rfq" ? "grid max-w-4xl gap-4" : "grid gap-4 xl:grid-cols-3"
        }
      >
        {mode === "all" && (
          <FinancialFormPanel
            title="Enter Vendor Bill"
            description="Stage a project bill for Sage review."
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
                <Input id="vendorBillPhase" name="phaseCode" />
              </FormField>
              <FormField label="Cost code" htmlFor="vendorBillCostCode">
                <Input id="vendorBillCostCode" name="costCode" />
              </FormField>
            </div>
            <FormField label="Description" htmlFor="vendorBillDescription">
              <Textarea id="vendorBillDescription" name="description" rows={3} />
            </FormField>
          </FinancialFormPanel>
        )}

        {mode === "all" && (
          <FinancialFormPanel
            title="Owner Pay Application"
            description="Stage an AIA-style draw request."
            accentClassName="border-l-brand-hps-primary"
            icon={<IconFileDollar className="size-5" />}
            actionLabel="Stage Pay App"
            isPending={isPending}
            onSubmit={handlePayApplication}
          >
            <FormField label="Application number" htmlFor="applicationNumber">
              <Input id="applicationNumber" name="applicationNumber" />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Period to" htmlFor="periodTo">
                <Input id="periodTo" name="periodTo" type="date" />
              </FormField>
              <FormField label="Amount" htmlFor="payApplicationAmount">
                <Input
                  id="payApplicationAmount"
                  name="amount"
                  inputMode="decimal"
                />
              </FormField>
            </div>
            <FormField label="Notes" htmlFor="payApplicationNotes">
              <Textarea id="payApplicationNotes" name="notes" rows={7} />
            </FormField>
          </FinancialFormPanel>
        )}

        <FinancialFormPanel
          id="rfq"
          title="Request for Quote"
          description="Draft scope by vendor category."
          accentClassName="border-l-brand-nutech-gold"
          icon={<IconShoppingCartQuestion className="size-5" />}
          actionLabel="Create RFQ"
          isPending={isPending}
          onSubmit={handleRfq}
        >
            <FormField label="Title" htmlFor="rfqTitle">
              <Input id="rfqTitle" name="title" required />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Vendor category" htmlFor="vendorCategory">
                <Input
                  id="vendorCategory"
                  name="vendorCategory"
                  placeholder="Concrete, plumbing, windows..."
                />
              </FormField>
              <FormField label="Requested from" htmlFor="requestedFrom">
                <Input id="requestedFrom" name="requestedFrom" />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Response due" htmlFor="responseDueDate">
                <Input id="responseDueDate" name="responseDueDate" type="date" />
              </FormField>
              <FormField label="Priority" htmlFor="rfqPriority">
                <Input id="rfqPriority" name="priority" defaultValue="normal" />
              </FormField>
            </div>
            <FormField label="Scope" htmlFor="rfqScope">
              <Textarea id="rfqScope" name="scope" rows={4} />
            </FormField>
        </FinancialFormPanel>
      </section>

      <section className="clarity-panel overflow-hidden">
        <div className="clarity-section-header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">
              {mode === "rfq" ? "RFQ Queue" : "Project Financial Queue"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {mode === "rfq"
                ? "Quote requests stay visible here and feed the sync review queue when needed."
                : "Drafts entered here feed developer-mode Sage sync review."}
            </p>
          </div>
          <Badge variant="outline">{visibleItems.length} records</Badge>
        </div>

        {visibleItems.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            {mode === "rfq"
              ? "No RFQs have been drafted for this project yet."
              : "No project financial records have been staged yet."}
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
              {visibleItems.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-2 px-3 py-3 text-sm sm:grid-cols-[1fr_.7fr_.7fr_.8fr] sm:items-center sm:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{workflowLabel(item.type)}</span>
                      {item.number && (
                        <span className="text-xs text-muted-foreground">
                          {item.number}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-muted-foreground">{item.title}</p>
                    {item.companyName && (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.companyName}
                      </p>
                    )}
                  </div>
                  <span>{money(item.amount)}</span>
                  <span>{dateText(item.dueDate)}</span>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{item.status}</Badge>
                    <Badge variant="secondary">{syncLabel(item)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
