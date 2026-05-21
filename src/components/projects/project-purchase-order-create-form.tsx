"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconPlus, IconShoppingCart, IconTrash } from "@tabler/icons-react"

import {
  createPurchaseOrderRequest,
  type CreatePurchaseOrderLineInput,
} from "@/app/actions/project-operations"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

type DraftPurchaseOrderLine = {
  readonly id: string
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly quantity: string
  readonly unitCost: string
  readonly unit: string
  readonly amount: string
  readonly taxGroup: string
}

type TextLineField =
  | "description"
  | "phaseCode"
  | "costCode"
  | "quantity"
  | "unitCost"
  | "unit"
  | "amount"
  | "taxGroup"

const DOCUMENT_INPUT_CLASS =
  "rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0 focus-visible:border-foreground"
const DOCUMENT_SELECT_CLASS =
  "h-9 w-full rounded-none border-x-0 border-t-0 bg-background px-0 text-sm shadow-none outline-none focus:border-foreground"
const LINE_INPUT_CLASS =
  "h-8 rounded-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:bg-background"

function newLine(): DraftPurchaseOrderLine {
  return {
    id: crypto.randomUUID(),
    description: "",
    phaseCode: "",
    costCode: "",
    quantity: "1",
    unitCost: "",
    unit: "",
    amount: "",
    taxGroup: "",
  }
}

function numberFromText(value: string): number | null {
  const trimmed = value.replaceAll(",", "").trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function cleanText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function lineAmount(line: DraftPurchaseOrderLine): number {
  const amount = numberFromText(line.amount)
  if (amount !== null) return amount

  const quantity = numberFromText(line.quantity) ?? 0
  const unitCost = numberFromText(line.unitCost) ?? 0
  return quantity * unitCost
}

function toLineInput(line: DraftPurchaseOrderLine): CreatePurchaseOrderLineInput {
  return {
    description: cleanText(line.description),
    phaseCode: cleanText(line.phaseCode),
    costCode: cleanText(line.costCode),
    quantity: numberFromText(line.quantity),
    unitCost: numberFromText(line.unitCost),
    unit: cleanText(line.unit),
    amount: lineAmount(line),
    taxGroup: cleanText(line.taxGroup),
  }
}

function Field({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export function ProjectPurchaseOrderCreateForm({
  projectId,
}: {
  readonly projectId: string
}): React.ReactElement {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [lines, setLines] = React.useState<readonly DraftPurchaseOrderLine[]>([
    newLine(),
  ])
  const [sageVendorId, setSageVendorId] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  const total = lines.reduce((sum, line) => sum + lineAmount(line), 0)
  const codedLineCount = lines.filter(
    (line) => cleanText(line.costCode) !== null
  ).length
  const hasVendorId = cleanText(sageVendorId) !== null

  function addLine(): void {
    setLines((current) => [...current, newLine()])
  }

  function removeLine(id: string): void {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.id !== id)
    )
  }

  function updateLine(
    id: string,
    field: TextLineField,
    value: string
  ): void {
    setLines((current) =>
      current.map((line) =>
        line.id === id
          ? {
              ...line,
              [field]: value,
            }
          : line
      )
    )
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    const form = formRef.current
    if (!form) return

    setSubmitting(true)
    setMessage(null)

    try {
      const formData = new FormData(form)
      const result = await createPurchaseOrderRequest(projectId, {
        title: String(formData.get("title") ?? ""),
        description: cleanText(String(formData.get("description") ?? "")),
        companyName: cleanText(String(formData.get("companyName") ?? "")),
        sageVendorId: cleanText(String(formData.get("sageVendorId") ?? "")),
        assigneeName: cleanText(String(formData.get("assigneeName") ?? "")),
        shipTo: cleanText(String(formData.get("shipTo") ?? "")),
        orderDate: cleanText(String(formData.get("orderDate") ?? "")),
        dueDate: cleanText(String(formData.get("dueDate") ?? "")),
        priority: String(formData.get("priority") ?? "normal"),
        lines: lines.map(toLineInput),
      })

      if (!result.success) {
        throw new Error(result.error)
      }

      form.reset()
      setLines([newLine()])
      setSageVendorId("")
      setMessage("P.O. request saved in Compass.")
      setOpen(false)
      router.refresh()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not stage the P.O. request."
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="flex justify-end border-y py-3">
        <SheetTrigger asChild>
          <Button type="button">
            <IconPlus className="size-4" />
            New PO
          </Button>
        </SheetTrigger>
      </div>
      <SheetContent className="w-[min(96vw,1180px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Request Purchase Order</SheetTitle>
          <SheetDescription>
            Enter the vendor once, then code each purchase line for job tracking,
            printing, supplier email, and optional accounting sync.
          </SheetDescription>
        </SheetHeader>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-4 px-5 pb-6"
        >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
          <span className="font-medium">Draft totals</span>
          <span className="text-muted-foreground">
            {money(total)} total · {codedLineCount}/{lines.length} lines coded
          </span>
        </div>
        <div className="space-y-3">
          <Field label="P.O. title / scope">
            <Input
              name="title"
              placeholder="ICF bracing rental"
              required
              className={DOCUMENT_INPUT_CLASS}
            />
          </Field>
          <Field label="Overall notes">
            <Textarea
              name="description"
              placeholder="Overall scope, delivery notes, or billing context"
              className={`min-h-24 ${DOCUMENT_INPUT_CLASS}`}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Vendor / supplier">
              <Input
                name="companyName"
                placeholder="Vendor or supplier name"
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Accounting vendor ID (optional)">
              <Input
                name="sageVendorId"
                value={sageVendorId}
                onChange={(event) => setSageVendorId(event.target.value)}
                placeholder="Sage/vendor number if available"
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Internal owner">
              <Input
                name="assigneeName"
                placeholder="PM/APM responsible"
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Ship to / delivery location">
              <Input
                name="shipTo"
                placeholder="Jobsite, office, or pickup"
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="P.O. date">
              <Input
                name="orderDate"
                type="date"
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Required by">
              <Input
                name="dueDate"
                type="date"
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Priority">
              <select
                name="priority"
                defaultValue="normal"
                className={DOCUMENT_SELECT_CLASS}
              >
                <option value="normal">Normal priority</option>
                <option value="high">High priority</option>
                <option value="low">Low priority</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="border-y">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
            <div>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Line items
              </h3>
              <p className="text-xs text-muted-foreground">
                Use one line per cost code, phase, material group, or scope item.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <IconPlus className="size-4" />
              Add line
            </Button>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[920px]">
              <div className="grid grid-cols-[2rem_minmax(12rem,1fr)_5rem_6rem_5rem_6rem_5rem_6rem_5rem_2.5rem] gap-2 border-b py-2 text-xs font-medium text-muted-foreground">
                <span>#</span>
                <span>Description</span>
                <span>Phase</span>
                <span>Cost code</span>
                <span>Qty</span>
                <span>Unit cost</span>
                <span>Unit</span>
                <span>Amount</span>
                <span>Tax</span>
                <span />
              </div>
              {lines.map((line, index) => (
                <div
                  key={line.id}
                  className="grid grid-cols-[2rem_minmax(12rem,1fr)_5rem_6rem_5rem_6rem_5rem_6rem_5rem_2.5rem] gap-2 border-b py-2 last:border-b-0"
                >
                  <span className="pt-2 text-xs font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  <Input
                    value={line.description}
                    onChange={(event) =>
                      updateLine(line.id, "description", event.target.value)
                    }
                    placeholder="Scope or item"
                    className={LINE_INPUT_CLASS}
                  />
                  <Input
                    value={line.phaseCode}
                    onChange={(event) =>
                      updateLine(line.id, "phaseCode", event.target.value)
                    }
                    placeholder="Phase"
                    className={LINE_INPUT_CLASS}
                  />
                  <Input
                    value={line.costCode}
                    onChange={(event) =>
                      updateLine(line.id, "costCode", event.target.value)
                    }
                    placeholder="CSI"
                    className={LINE_INPUT_CLASS}
                  />
                  <Input
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(line.id, "quantity", event.target.value)
                    }
                    inputMode="decimal"
                    placeholder="1"
                    className={LINE_INPUT_CLASS}
                  />
                  <Input
                    value={line.unitCost}
                    onChange={(event) =>
                      updateLine(line.id, "unitCost", event.target.value)
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    className={LINE_INPUT_CLASS}
                  />
                  <Input
                    value={line.unit}
                    onChange={(event) =>
                      updateLine(line.id, "unit", event.target.value)
                    }
                    placeholder="EA"
                    className={LINE_INPUT_CLASS}
                  />
                  <Input
                    value={line.amount}
                    onChange={(event) =>
                      updateLine(line.id, "amount", event.target.value)
                    }
                    inputMode="decimal"
                    placeholder={String(lineAmount(line) || "")}
                    className={LINE_INPUT_CLASS}
                  />
                  <Input
                    value={line.taxGroup}
                    onChange={(event) =>
                      updateLine(line.id, "taxGroup", event.target.value)
                    }
                    placeholder="Tax"
                    className={LINE_INPUT_CLASS}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    disabled={lines.length === 1}
                    onClick={() => removeLine(line.id)}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-y py-3">
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">PO total</p>
              <p className="font-semibold">{money(total)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Accounting coding</p>
              <p className="font-semibold">
                {codedLineCount}/{lines.length} lines coded
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Accounting sync</p>
              <p className="font-semibold">
                {hasVendorId ? "Vendor ID entered" : "Works without vendor ID"}
              </p>
            </div>
          </div>
        </div>

        {message && (
          <p className="border-l-2 border-l-primary px-3 py-2 text-sm text-muted-foreground">
            {message}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            <IconShoppingCart className="size-4" />
            {submitting ? "Staging PO..." : "Create PO Request"}
          </Button>
        </div>
      </form>
      </SheetContent>
    </Sheet>
  )
}
