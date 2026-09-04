"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconCheck,
  IconChevronDown,
  IconPencil,
  IconPlus,
  IconShoppingCart,
  IconTrash,
} from "@tabler/icons-react"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import {
  createPurchaseOrderRequest,
  updatePurchaseOrderRequest,
  type CreatePurchaseOrderLineInput,
  type ProjectPurchaseOrderCostCodeOption,
  type ProjectPurchaseOrderItem,
  type ProjectPurchaseOrderPhaseOption,
} from "@/app/actions/project-operations"
import { ProjectAssigneePicker } from "@/components/projects/project-assignee-picker"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { reportStaleDeployment } from "@/lib/deployment/version"
import {
  isStaleServerActionError,
  purchaseOrderSubmissionErrorMessage,
} from "@/lib/purchase-orders/action-errors"
import { canRemovePurchaseOrderLine } from "@/lib/purchase-orders/draft-edit"
import {
  purchaseOrderCostCodesForPhase,
  purchaseOrderSiteContactOptions,
  purchaseOrderVendorOptions,
} from "@/lib/purchase-orders/form-options"
import {
  initialPurchaseOrderShipToState,
  purchaseOrderShipToValue,
  type PurchaseOrderShipToState,
} from "@/lib/purchase-orders/ship-to"
import { purchaseOrderSiteContactSelection } from "@/lib/purchase-orders/site-contact"

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

type PurchaseOrderPickerOption = {
  readonly value: string
  readonly label: string
  readonly description?: string
}

function normalizedOptionText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function PurchaseOrderOptionPicker({
  value,
  options,
  placeholder,
  ariaLabel,
  onValueChange,
}: {
  readonly value: string
  readonly options: readonly PurchaseOrderPickerOption[]
  readonly placeholder: string
  readonly ariaLabel: string
  readonly onValueChange: (value: string) => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const normalizedQuery = normalizedOptionText(query)
  const selected =
    options.find((option) => option.value === value) ?? null
  const filteredOptions = options.filter((option) => {
    if (normalizedQuery.length === 0) return true
    return normalizedOptionText(
      `${option.value} ${option.label} ${option.description ?? ""}`
    ).includes(normalizedQuery)
  })
  const typedValue = query.trim()
  const canUseTypedValue =
    typedValue.length > 0 &&
    normalizedOptionText(typedValue) !== normalizedOptionText(value)

  function chooseValue(nextValue: string): void {
    onValueChange(nextValue)
    setQuery("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={ariaLabel}
          className="h-8 w-full min-w-0 justify-between rounded-none bg-transparent px-1 text-left text-xs font-normal hover:bg-background"
        >
          <span className="truncate">
            {selected?.label ?? (value || placeholder)}
          </span>
          <IconChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-3rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={`Search ${placeholder.toLowerCase()}...`}
          />
          <CommandList className="compass-content-scroll max-h-72">
            <CommandEmpty>No matching options.</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.value} ${option.label}`}
                  onSelect={() => chooseValue(option.value)}
                >
                  <IconCheck
                    className={
                      option.value === value ? "size-4 opacity-100" : "size-4 opacity-0"
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => chooseValue("")}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUseTypedValue}
              onClick={() => chooseValue(typedValue)}
            >
              Use typed value
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

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

function textFromNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : ""
}

function draftLinesFromPurchaseOrder(
  purchaseOrder: ProjectPurchaseOrderItem | null
): readonly DraftPurchaseOrderLine[] {
  if (purchaseOrder === null) return [newLine()]
  if (purchaseOrder.lines.length === 0) return []

  return purchaseOrder.lines.map((line) => ({
    id: line.id,
    description: line.description,
    phaseCode: line.phaseCode ?? "",
    costCode: line.costCode ?? "",
    quantity: textFromNumber(line.quantity),
    unitCost: textFromNumber(line.unitCost),
    unit: line.unit ?? "",
    amount:
      line.amount === line.quantity * line.unitCost
        ? ""
        : textFromNumber(line.amount),
    taxGroup: line.taxGroup ?? "",
  }))
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

type SharedPurchaseOrderFormProps = {
  readonly projectId: string
  readonly jobsiteAddress: string | null
  readonly contactOptions: readonly ProjectTaskAssigneeOption[]
  readonly siteContactOptions: readonly ProjectTaskAssigneeOption[]
  readonly phaseOptions: readonly ProjectPurchaseOrderPhaseOption[]
  readonly costCodeOptions: readonly ProjectPurchaseOrderCostCodeOption[]
}

type PurchaseOrderFormProps = SharedPurchaseOrderFormProps &
  (
    | { readonly kind: "create" }
    | {
        readonly kind: "edit"
        readonly purchaseOrder: ProjectPurchaseOrderItem
      }
  )

function ProjectPurchaseOrderForm(
  props: PurchaseOrderFormProps
): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const {
    projectId,
    jobsiteAddress,
    contactOptions,
    siteContactOptions,
    phaseOptions,
    costCodeOptions,
  } = props
  const purchaseOrder = props.kind === "edit" ? props.purchaseOrder : null
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [lines, setLines] = React.useState<readonly DraftPurchaseOrderLine[]>(
    () => draftLinesFromPurchaseOrder(purchaseOrder)
  )
  const [sageVendorId, setSageVendorId] = React.useState(
    purchaseOrder?.sageVendorId ?? ""
  )
  const [companyName, setCompanyName] = React.useState(
    purchaseOrder?.companyName ?? ""
  )
  const [assigneeName, setAssigneeName] = React.useState(
    purchaseOrder?.assigneeName ?? ""
  )
  const [siteContactPhone, setSiteContactPhone] = React.useState(
    purchaseOrder?.siteContactPhone ?? ""
  )
  const [shipTo, setShipTo] = React.useState<PurchaseOrderShipToState>(() =>
    initialPurchaseOrderShipToState({
      storedShipTo: purchaseOrder?.sageShipTo ?? null,
      jobsiteAddress,
    })
  )
  const [submitting, setSubmitting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const vendorOptions = React.useMemo(
    () => purchaseOrderVendorOptions(contactOptions),
    [contactOptions]
  )
  const internalSiteContactOptions = React.useMemo(
    () => purchaseOrderSiteContactOptions(siteContactOptions),
    [siteContactOptions]
  )

  const total = lines.reduce((sum, line) => sum + lineAmount(line), 0)
  const codedLineCount = lines.filter(
    (line) => cleanText(line.costCode) !== null
  ).length
  const hasVendorId = cleanText(sageVendorId) !== null

  function addLine(): void {
    setLines((current) => [...current, newLine()])
  }

  function removeLine(id: string): void {
    setLines((current) => {
      if (!canRemovePurchaseOrderLine(current.length, purchaseOrder !== null)) {
        return current
      }
      return current.filter((line) => line.id !== id)
    })
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

  function handleOpenChange(nextOpen: boolean): void {
    if (nextOpen) {
      setMessage(null)
      if (purchaseOrder !== null) {
        setLines(draftLinesFromPurchaseOrder(purchaseOrder))
        setSageVendorId(purchaseOrder.sageVendorId ?? "")
        setCompanyName(purchaseOrder.companyName ?? "")
        setAssigneeName(purchaseOrder.assigneeName ?? "")
        setSiteContactPhone(purchaseOrder.siteContactPhone ?? "")
        setShipTo(
          initialPurchaseOrderShipToState({
            storedShipTo: purchaseOrder.sageShipTo,
            jobsiteAddress,
          })
        )
      }
    }
    setOpen(nextOpen)
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
      const request = {
        title: String(formData.get("title") ?? ""),
        description: cleanText(String(formData.get("description") ?? "")),
        companyName: cleanText(companyName),
        sageVendorId: cleanText(String(formData.get("sageVendorId") ?? "")),
        assigneeName: cleanText(assigneeName),
        siteContactPhone: cleanText(siteContactPhone),
        shipTo: purchaseOrderShipToValue({ state: shipTo, jobsiteAddress }),
        orderDate: cleanText(String(formData.get("orderDate") ?? "")),
        dueDate: cleanText(String(formData.get("dueDate") ?? "")),
        priority: String(formData.get("priority") ?? "normal"),
        lines: lines.map(toLineInput),
      }
      const result =
        purchaseOrder === null
          ? await createPurchaseOrderRequest(projectId, request)
          : await updatePurchaseOrderRequest(projectId, purchaseOrder.id, {
              ...request,
              expectedRevision: purchaseOrder.revision,
            })

      if (!result.success) {
        throw new Error(result.error)
      }

      if (purchaseOrder === null) {
        form.reset()
        setLines([newLine()])
        setSageVendorId("")
        setCompanyName("")
        setAssigneeName("")
        setSiteContactPhone("")
        setShipTo(
          initialPurchaseOrderShipToState({
            storedShipTo: null,
            jobsiteAddress,
          })
        )
      }
      setMessage(
        purchaseOrder === null
          ? "P.O. request saved in Compass."
          : "Purchase order draft updated."
      )
      setOpen(false)
      if (purchaseOrder === null) {
        router.push(
          `/dashboard/projects/${projectId}/purchase-orders?created=${encodeURIComponent(
            result.id
          )}`
        )
      }
      router.refresh()
    } catch (error) {
      const isStaleAction = isStaleServerActionError(error)
      if (isStaleAction) reportStaleDeployment()
      setMessage(
        purchaseOrderSubmissionErrorMessage(
          error,
          purchaseOrder === null ? "create" : "update"
        )
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant={purchaseOrder === null ? "default" : "outline"}
          size={purchaseOrder === null ? "default" : "sm"}
        >
          {purchaseOrder === null ? (
            <IconPlus className="size-4" />
          ) : (
            <IconPencil className="size-4" />
          )}
          {purchaseOrder === null ? "New PO" : "Edit draft"}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,1180px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>
            {purchaseOrder === null
              ? "Request Purchase Order"
              : `Edit ${purchaseOrder.sourceRecordNumber ?? "Purchase Order"}`}
          </SheetTitle>
          <SheetDescription>
            {purchaseOrder === null
              ? "Enter the vendor once, then code each purchase line for job tracking, printing, supplier email, and optional accounting sync."
              : "Update the draft header, delivery details, and individual line items before sending or accounting sync."}
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
              defaultValue={purchaseOrder?.title ?? ""}
              required
              className={DOCUMENT_INPUT_CLASS}
            />
          </Field>
          <Field label="Overall notes">
            <Textarea
              name="description"
              placeholder="Overall scope, delivery notes, or billing context"
              defaultValue={purchaseOrder?.description ?? ""}
              className={`min-h-24 ${DOCUMENT_INPUT_CLASS}`}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Vendor / supplier">
              <ProjectAssigneePicker
                value={companyName}
                options={vendorOptions}
                placeholder="Choose vendor or type a name..."
                onValueChange={(value, option) =>
                  setCompanyName(option?.companyName ?? value)
                }
                className="rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0"
              />
            </Field>
            {developerModeEnabled ? (
              <Field label="Accounting vendor ID (optional)">
                <Input
                  name="sageVendorId"
                  value={sageVendorId}
                  onChange={(event) => setSageVendorId(event.target.value)}
                  placeholder="Sage/vendor number if available"
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
            ) : (
              <input type="hidden" name="sageVendorId" value={sageVendorId} />
            )}
            <Field label="Site contact">
              <ProjectAssigneePicker
                value={assigneeName}
                options={internalSiteContactOptions}
                placeholder="Choose staff or type an external name..."
                onValueChange={(value, option) => {
                  const contact = purchaseOrderSiteContactSelection({
                    name: value,
                    currentName: assigneeName,
                    currentPhone: siteContactPhone,
                    option,
                  })
                  setAssigneeName(contact.name)
                  setSiteContactPhone(contact.phone)
                }}
                className="rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0"
              />
            </Field>
            <Field label="Site contact phone">
              <Input
                type="tel"
                value={siteContactPhone}
                onChange={(event) => setSiteContactPhone(event.target.value)}
                placeholder="Select staff or enter a phone number"
                autoComplete="tel"
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <div className="space-y-2">
              <Field label="Ship to / delivery location">
                <select
                  value={shipTo.choice}
                  onChange={(event) => {
                    const choice = event.target.value
                    if (choice === "jobsite") {
                      setShipTo((current) => ({ ...current, choice: "jobsite" }))
                    } else if (choice === "pickup") {
                      setShipTo((current) => ({ ...current, choice: "pickup" }))
                    } else if (choice === "other") {
                      setShipTo((current) => ({ ...current, choice: "other" }))
                    }
                  }}
                  className={DOCUMENT_SELECT_CLASS}
                >
                  <option value="jobsite" disabled={jobsiteAddress === null}>
                    Jobsite
                  </option>
                  <option value="pickup">Pick-Up</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              {shipTo.choice === "jobsite" && jobsiteAddress !== null && (
                <Input
                  aria-label="Jobsite shipping address"
                  value={jobsiteAddress}
                  readOnly
                  className={DOCUMENT_INPUT_CLASS}
                />
              )}
              {shipTo.choice === "pickup" && (
                <p className="text-xs text-muted-foreground">
                  Supplier pickup; no delivery address required.
                </p>
              )}
              {shipTo.choice === "other" && (
                <Input
                  aria-label="Other shipping address"
                  value={shipTo.otherAddress}
                  onChange={(event) =>
                    setShipTo((current) => ({
                      ...current,
                      otherAddress: event.target.value,
                    }))
                  }
                  placeholder="Enter another delivery address"
                  className={DOCUMENT_INPUT_CLASS}
                  required
                />
              )}
              {jobsiteAddress === null && (
                <p className="text-xs text-muted-foreground">
                  Add a project address to enable Jobsite delivery.
                </p>
              )}
            </div>
            <Field label="P.O. date">
              <Input
                name="orderDate"
                type="date"
                defaultValue={purchaseOrder?.sageOrderDate ?? ""}
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Required by">
              <Input
                name="dueDate"
                type="date"
                defaultValue={purchaseOrder?.dueDate ?? ""}
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Priority">
              <select
                name="priority"
                defaultValue={purchaseOrder?.priority ?? "normal"}
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
            <div className="min-w-[1120px]">
              <div className="grid grid-cols-[2rem_minmax(12rem,1fr)_11rem_13rem_5rem_6rem_5rem_6rem_5rem_2.5rem] gap-2 border-b py-2 text-xs font-medium text-muted-foreground">
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
                  className="grid grid-cols-[2rem_minmax(12rem,1fr)_11rem_13rem_5rem_6rem_5rem_6rem_5rem_2.5rem] gap-2 border-b py-2 last:border-b-0"
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
                  <PurchaseOrderOptionPicker
                    value={line.phaseCode}
                    options={phaseOptions}
                    placeholder="Phase"
                    ariaLabel={`Choose phase for line ${index + 1}`}
                    onValueChange={(value) =>
                      updateLine(line.id, "phaseCode", value)
                    }
                  />
                  <PurchaseOrderOptionPicker
                    value={line.costCode}
                    options={
                      purchaseOrderCostCodesForPhase(
                        costCodeOptions,
                        line.phaseCode
                      )
                    }
                    placeholder="Cost code"
                    ariaLabel={`Choose cost code for line ${index + 1}`}
                    onValueChange={(value) =>
                      updateLine(line.id, "costCode", value)
                    }
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
                    disabled={
                      !canRemovePurchaseOrderLine(
                        lines.length,
                        purchaseOrder !== null
                      )
                    }
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
            {developerModeEnabled && (
              <div>
                <p className="text-xs text-muted-foreground">Accounting sync</p>
                <p className="font-semibold">
                  {hasVendorId ? "Vendor ID entered" : "Works without vendor ID"}
                </p>
              </div>
            )}
          </div>
        </div>

        {message && (
          <p
            role="alert"
            className="border-l-2 border-l-primary px-3 py-2 text-sm text-muted-foreground"
          >
            {message}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            <IconShoppingCart className="size-4" />
            {submitting
              ? purchaseOrder === null
                ? "Staging PO..."
                : "Saving changes..."
              : purchaseOrder === null
                ? "Create PO Request"
                : "Save changes"}
          </Button>
        </div>
      </form>
      </SheetContent>
    </Sheet>
  )
}

export function ProjectPurchaseOrderCreateForm(
  props: SharedPurchaseOrderFormProps
): React.ReactElement {
  return <ProjectPurchaseOrderForm {...props} kind="create" />
}

export function ProjectPurchaseOrderEditForm(
  props: SharedPurchaseOrderFormProps & {
    readonly purchaseOrder: ProjectPurchaseOrderItem
  }
): React.ReactElement {
  return <ProjectPurchaseOrderForm {...props} kind="edit" />
}
