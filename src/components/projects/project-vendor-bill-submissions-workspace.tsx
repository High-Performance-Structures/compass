"use client"

import * as React from "react"
import {
  IconFileInvoice,
  IconPaperclip,
  IconPlus,
  IconReceipt,
  IconSend,
  IconTrash,
} from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import {
  updateVendorBillSubmissionCoding,
  type ProjectVendorBillSubmissionContext,
  type VendorBillCostCodeOption,
  type VendorBillSubmissionItem,
} from "@/app/actions/project-vendor-bill-submissions"
import { ProjectSelectionComboboxInput } from "@/components/projects/project-selection-combobox-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type EditableLine = {
  readonly id: string
  readonly description: string
  readonly amount: string
  readonly costCode: string
  readonly phaseCode: string
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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

function reviewStatusLabel(value: string): string {
  switch (value) {
    case "needs_coding":
      return "Needs coding"
    case "ready_for_sage":
      return "Ready for Sage"
    case "rejected":
      return "Rejected"
    case "needs_review":
      return "Needs review"
    default:
      return value
  }
}

function statusBadgeClass(value: string): string {
  if (value === "ready_for_sage") return "border-green-700/30 bg-green-700/10 text-green-800"
  if (value === "rejected") return "border-red-700/30 bg-red-700/10 text-red-800"
  if (value === "needs_coding") return "border-amber-700/30 bg-amber-700/10 text-amber-800"
  return "border-primary/30 bg-primary/10 text-primary"
}

function cleanAmount(value: string): number {
  const amount = Number(value.replace(/[$,]/g, "").trim())
  return Number.isFinite(amount) ? amount : 0
}

function newEditableLine(): EditableLine {
  return {
    id: `new-${crypto.randomUUID()}`,
    description: "",
    amount: "",
    costCode: "",
    phaseCode: "",
  }
}

function costCodeOptions(
  options: readonly VendorBillCostCodeOption[]
): readonly { readonly value: string; readonly label: string; readonly description: string }[] {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.divisionLabel,
  }))
}

function SubmitBillDrawer({
  projectId,
  context,
}: {
  readonly projectId: string
  readonly context: ProjectVendorBillSubmissionContext
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const contact = context.matchingContact

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)
    setIsSubmitting(true)
    try {
      const form = event.currentTarget
      const formData = new FormData(form)
      formData.set(
        "linesJson",
        JSON.stringify(
          [
            {
              description: String(formData.get("description") ?? ""),
              amount: cleanAmount(String(formData.get("amount") ?? "")),
              costCode: null,
              phaseCode: null,
            },
          ]
        )
      )

      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/vendor-bill-submissions`,
        {
          method: "POST",
          body: formData,
        }
      )
      const result: unknown = await response.json()
      if (
        typeof result === "object" &&
        result !== null &&
        "success" in result &&
        result.success === true
      ) {
        setMessage("Bill submitted for review.")
        form.reset()
        setOpen(false)
        router.refresh()
        return
      }

      const error =
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "Unable to submit bill."
      setMessage(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <IconPlus className="size-4" />
          Submit bill
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Submit Bill</SheetTitle>
          <SheetDescription>
            Upload the invoice and enter the basic bill information. Compass
            staff will code it during review.
          </SheetDescription>
        </SheetHeader>

        <form className="space-y-5 px-4 pb-6" onSubmit={submit}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vendorName">Vendor / Company</Label>
              <Input
                id="vendorName"
                name="vendorName"
                defaultValue={contact?.companyName ?? contact?.displayName ?? ""}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendorEmail">Email</Label>
              <Input
                id="vendorEmail"
                name="vendorEmail"
                type="email"
                defaultValue={contact?.email ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billNumber">Bill / Invoice Number</Label>
              <Input id="billNumber" name="billNumber" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="billDate">Bill Date</Label>
                <Input id="billDate" name="billDate" type="date" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dueDate">Due Date</Label>
                <Input id="dueDate" name="dueDate" type="date" />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">What is this bill for?</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Brief scope, delivery, or invoice note..."
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="files">Attachment</Label>
            <Input id="files" name="files" type="file" multiple />
            <p className="text-xs text-muted-foreground">
              Invoices and backup are stored under 03_PayRequests / Compass
              Bill Submissions / Uncoded.
            </p>
          </div>

          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            <IconSend className="size-4" />
            {isSubmitting ? "Submitting..." : "Submit for review"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function SubmissionReviewDrawer({
  projectId,
  submission,
  costCodes,
  canReview,
}: {
  readonly projectId: string
  readonly submission: VendorBillSubmissionItem
  readonly costCodes: readonly VendorBillCostCodeOption[]
  readonly canReview: boolean
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState<string | null>(null)
  const [reviewStatus, setReviewStatus] = React.useState(submission.reviewStatus)
  const [reviewNotes, setReviewNotes] = React.useState(submission.reviewNotes ?? "")
  const [payRequestNumber, setPayRequestNumber] = React.useState(
    submission.payRequestNumber ?? ""
  )
  const [payRequestDate, setPayRequestDate] = React.useState(
    submission.payRequestDate ?? ""
  )
  const [isChangeOrder, setIsChangeOrder] = React.useState(
    submission.isChangeOrder
  )
  const [changeOrderNumber, setChangeOrderNumber] = React.useState(
    submission.changeOrderNumber ?? ""
  )
  const [lines, setLines] = React.useState<readonly EditableLine[]>(
    submission.lines.length > 0
      ? submission.lines.map((line) => ({
          id: line.id,
          description: line.description ?? "",
          amount: String(line.amount),
          costCode: line.costCode ?? "",
          phaseCode: line.phaseCode ?? "",
        }))
      : [newEditableLine()]
  )
  const options = React.useMemo(() => costCodeOptions(costCodes), [costCodes])

  function updateLine(id: string, patch: Partial<EditableLine>): void {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line))
    )
  }

  function removeLine(id: string): void {
    setLines((current) =>
      current.length > 1 ? current.filter((line) => line.id !== id) : current
    )
  }

  function save(): void {
    setMessage(null)
    startTransition(async () => {
      const result = await updateVendorBillSubmissionCoding(projectId, submission.id, {
        reviewStatus,
        reviewNotes,
        payRequestNumber,
        payRequestDate,
        isChangeOrder,
        changeOrderNumber,
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          amount: cleanAmount(line.amount),
          costCode: line.costCode,
          phaseCode: line.phaseCode,
        })),
      })
      setMessage(result.success ? "Review saved." : result.error)
      if (result.success) {
        setOpen(false)
        router.refresh()
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Review
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{submission.vendorName}</SheetTitle>
          <SheetDescription>
            {submission.billNumber ?? "No bill number"} · {money(submission.totalAmount)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Bill date
              </p>
              <p className="text-sm">{dateText(submission.billDate)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Due date
              </p>
              <p className="text-sm">{dateText(submission.dueDate)}</p>
            </div>
          </div>

          {submission.description && (
            <div className="border-l-2 border-primary/40 pl-3 text-sm">
              {submission.description}
            </div>
          )}

          {submission.attachments.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Attachments</h3>
                {submission.stampedFileUrl && (
                  <a
                    href={submission.stampedFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open stamped copy
                  </a>
                )}
              </div>
              <div className="grid gap-2">
                {submission.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.storageUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted",
                      !attachment.storageUrl && "pointer-events-none opacity-60"
                    )}
                  >
                    <IconPaperclip className="size-4" />
                    {attachment.fileName}
                  </a>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Draw / Pay Request</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`pay-request-number-${submission.id}`}>
                  Draw / Pay Request Number
                </Label>
                <Input
                  id={`pay-request-number-${submission.id}`}
                  value={payRequestNumber}
                  disabled={!canReview}
                  placeholder="Draw 03"
                  onChange={(event) => setPayRequestNumber(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`pay-request-date-${submission.id}`}>
                  Draw / Pay Request Date
                </Label>
                <Input
                  id={`pay-request-date-${submission.id}`}
                  value={payRequestDate}
                  disabled={!canReview}
                  type="date"
                  onChange={(event) => setPayRequestDate(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-3 border-l-2 border-primary/40 pl-3 sm:flex-row sm:items-center">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={isChangeOrder}
                  disabled={!canReview}
                  onCheckedChange={(checked) =>
                    setIsChangeOrder(checked === true)
                  }
                />
                Change order item
              </label>
              <Input
                value={changeOrderNumber}
                disabled={!canReview || !isChangeOrder}
                placeholder="Change order number"
                className="sm:max-w-xs"
                onChange={(event) => setChangeOrderNumber(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Coding Review</h3>
                <p className="text-xs text-muted-foreground">
                  Split this bill across cost codes as needed before Sage sync.
                </p>
              </div>
              {canReview && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLines((current) => [...current, newEditableLine()])
                  }
                >
                  <IconPlus className="size-4" />
                  Add split
                </Button>
              )}
            </div>
            {lines.map((line, index) => (
              <div
                key={line.id}
                className="grid gap-3 border-l-2 border-primary/40 pl-3 md:grid-cols-[minmax(0,1.4fr)_120px_minmax(0,1fr)_110px_40px]"
              >
                <div className="space-y-1.5">
                  <Label htmlFor={`review-description-${line.id}`}>
                    Description
                  </Label>
                  <Input
                    id={`review-description-${line.id}`}
                    value={line.description}
                    disabled={!canReview}
                    placeholder={`Line ${index + 1}`}
                    onChange={(event) =>
                      updateLine(line.id, { description: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`review-amount-${line.id}`}>Amount</Label>
                  <Input
                    id={`review-amount-${line.id}`}
                    value={line.amount}
                    disabled={!canReview}
                    inputMode="decimal"
                    onChange={(event) =>
                      updateLine(line.id, { amount: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`review-cost-code-${line.id}`}>Cost Code</Label>
                  <ProjectSelectionComboboxInput
                    id={`review-cost-code-${line.id}`}
                    name={`review-cost-code-${line.id}`}
                    options={options}
                    placeholder="Search cost codes..."
                    value={line.costCode}
                    onValueChange={(value) =>
                      updateLine(line.id, { costCode: value })
                    }
                    manualInputLabel="Use typed cost code"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`review-phase-${line.id}`}>Phase</Label>
                  <Input
                    id={`review-phase-${line.id}`}
                    value={line.phaseCode}
                    disabled={!canReview}
                    onChange={(event) =>
                      updateLine(line.id, { phaseCode: event.target.value })
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove split line"
                    disabled={!canReview || lines.length === 1}
                    onClick={() => removeLine(line.id)}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={reviewStatus}
                onValueChange={setReviewStatus}
                disabled={!canReview}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="needs_review">Needs review</SelectItem>
                  <SelectItem value="needs_coding">Needs coding</SelectItem>
                  <SelectItem value="ready_for_sage">Ready for Sage</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`review-notes-${submission.id}`}>Review Notes</Label>
              <Textarea
                id={`review-notes-${submission.id}`}
                value={reviewNotes}
                disabled={!canReview}
                onChange={(event) => setReviewNotes(event.target.value)}
              />
            </div>
          </div>

          {message && <p className="text-sm text-muted-foreground">{message}</p>}
          {canReview && (
            <Button onClick={save} disabled={isPending}>
              {isPending ? "Saving..." : "Save review"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SubmissionRow({
  projectId,
  submission,
  costCodes,
  canReview,
}: {
  readonly projectId: string
  readonly submission: VendorBillSubmissionItem
  readonly costCodes: readonly VendorBillCostCodeOption[]
  readonly canReview: boolean
}): React.ReactElement {
  return (
    <div className="grid gap-3 border-b py-4 last:border-b-0 lg:grid-cols-[minmax(0,1.1fr)_120px_130px_130px_110px] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{submission.vendorName}</h3>
          <Badge
            variant="outline"
            className={statusBadgeClass(submission.reviewStatus)}
          >
            {reviewStatusLabel(submission.reviewStatus)}
          </Badge>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {submission.billNumber ?? "No bill number"} ·{" "}
          {submission.description ?? "No description"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {submission.attachments.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <IconPaperclip className="size-3.5" />
              {submission.attachments.length} attachment
              {submission.attachments.length === 1 ? "" : "s"}
            </span>
          )}
          {submission.payRequestNumber && (
            <span>Draw {submission.payRequestNumber}</span>
          )}
          {submission.payRequestDate && (
            <span>Pay request {dateText(submission.payRequestDate)}</span>
          )}
          {submission.isChangeOrder && (
            <span>
              Change order
              {submission.changeOrderNumber
                ? ` ${submission.changeOrderNumber}`
                : ""}
            </span>
          )}
          {submission.stampedAt && <span>Stamped {dateText(submission.stampedAt)}</span>}
        </div>
      </div>
      <div className="text-sm">{money(submission.totalAmount)}</div>
      <div className="text-sm text-muted-foreground">
        Bill {dateText(submission.billDate)}
      </div>
      <div className="text-sm text-muted-foreground">
        Due {dateText(submission.dueDate)}
      </div>
      <SubmissionReviewDrawer
        projectId={projectId}
        submission={submission}
        costCodes={costCodes}
        canReview={canReview}
      />
    </div>
  )
}

export function ProjectVendorBillSubmissionsWorkspace({
  projectId,
  context,
}: {
  readonly projectId: string
  readonly context: ProjectVendorBillSubmissionContext
}): React.ReactElement {
  const pendingCount = context.submissions.filter(
    (submission) => submission.reviewStatus !== "ready_for_sage"
  ).length
  const readyCount = context.submissions.filter(
    (submission) => submission.reviewStatus === "ready_for_sage"
  ).length

  return (
    <div className="space-y-5">
      <section className="clarity-panel-strong p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <IconReceipt className="size-5 text-primary" />
              <h2 className="text-lg font-semibold">Bill Submissions</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Subs and suppliers can submit bills here. Internal financials stay
              separate until staff reviews and marks the submission ready.
            </p>
          </div>
          <SubmitBillDrawer projectId={projectId} context={context} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="border-l-2 border-primary/50 pl-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Visible to you
            </p>
            <p className="text-xl font-semibold">{context.submissions.length}</p>
          </div>
          <div className="border-l-2 border-amber-700/50 pl-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Needs review
            </p>
            <p className="text-xl font-semibold">{pendingCount}</p>
          </div>
          <div className="border-l-2 border-green-700/50 pl-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Ready for Sage
            </p>
            <p className="text-xl font-semibold">{readyCount}</p>
          </div>
        </div>
      </section>

      <section className="clarity-panel-strong">
        <div className="clarity-section-header flex items-center gap-2 px-4 py-3">
          <IconFileInvoice className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">
            {context.isInternal ? "Review Queue" : "My Submitted Bills"}
          </h2>
        </div>
        <div className="px-4">
          {context.submissions.length > 0 ? (
            context.submissions.map((submission) => (
              <SubmissionRow
                key={submission.id}
                projectId={projectId}
                submission={submission}
                costCodes={context.costCodes}
                canReview={context.canReview}
              />
            ))
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No bill submissions yet.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
