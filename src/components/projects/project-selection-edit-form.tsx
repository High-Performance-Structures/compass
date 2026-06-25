"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCheck, IconPencil, IconPalette } from "@tabler/icons-react"

import {
  updateProjectSelection,
  type ProjectSelectionItem,
  type ProjectSelectionOptions,
  type ProjectSelectionStatus,
} from "@/app/actions/project-selections"
import { ProjectSelectionComboboxInput } from "@/components/projects/project-selection-combobox-input"
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

type FormState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "error"; readonly message: string }

const STATUS_OPTIONS: readonly {
  readonly value: ProjectSelectionStatus
  readonly label: string
}[] = [
  { value: "needed", label: "Needed" },
  { value: "proposed", label: "Proposed" },
  { value: "owner_review", label: "Owner review" },
  { value: "approved", label: "Approved" },
  { value: "pricing", label: "Pricing" },
  { value: "rfq_sent", label: "RFQ sent" },
  { value: "ordered", label: "Ordered" },
  { value: "installed", label: "Installed" },
  { value: "unavailable", label: "Unavailable" },
  { value: "deferred", label: "Deferred" },
]

const DOCUMENT_INPUT_CLASS =
  "rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:border-foreground focus-visible:ring-0"
const DOCUMENT_SELECT_CLASS =
  "w-full rounded-none border-x-0 border-t-0 px-0 shadow-none"
const DOCUMENT_TEXTAREA_CLASS =
  "rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:border-foreground focus-visible:ring-0"

function fieldValue(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  return typeof value === "string" ? value : null
}

function textValue(value: string | null): string {
  return value ?? ""
}

function quantityValue(value: number | null): string {
  return value === null ? "" : String(value)
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

function initialDivision(
  selection: ProjectSelectionItem,
  options: ProjectSelectionOptions
): string {
  if (!selection.costCode) return "all"
  return (
    options.costCodes.find((option) => option.value === selection.costCode)
      ?.divisionCode ?? "all"
  )
}

export function ProjectSelectionEditForm({
  options,
  projectId,
  selection,
}: {
  readonly options: ProjectSelectionOptions
  readonly projectId: string
  readonly selection: ProjectSelectionItem
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<FormState>({ kind: "idle" })
  const [selectionStatus, setSelectionStatus] =
    React.useState<ProjectSelectionStatus>(selection.status)
  const [selectedRoomType, setSelectedRoomType] = React.useState(
    textValue(selection.roomType)
  )
  const [division, setDivision] = React.useState(() =>
    initialDivision(selection, options)
  )
  const costCodeOptions = React.useMemo(
    () =>
      division !== "all"
        ? options.costCodes.filter((option) => option.divisionCode === division)
        : options.costCodes,
    [division, options.costCodes]
  )

  async function submitSelection(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    setStatus({ kind: "saving" })
    const formData = new FormData(event.currentTarget)
    const result = await updateProjectSelection(projectId, selection.id, {
      roomName: fieldValue(formData, "roomName"),
      roomType: fieldValue(formData, "roomType"),
      category: fieldValue(formData, "category"),
      name: fieldValue(formData, "name"),
      description: fieldValue(formData, "description"),
      quantity: fieldValue(formData, "quantity"),
      manufacturer: fieldValue(formData, "manufacturer"),
      model: fieldValue(formData, "model"),
      colorFinish: fieldValue(formData, "colorFinish"),
      supplierName: fieldValue(formData, "supplierName"),
      productUrl: fieldValue(formData, "productUrl"),
      costCode: fieldValue(formData, "costCode"),
      phaseCode: fieldValue(formData, "phaseCode"),
      status: selectionStatus,
      notes: fieldValue(formData, "notes"),
      changeReason: fieldValue(formData, "changeReason"),
    })

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    setStatus({ kind: "saved" })
    setOpen(false)
    router.refresh()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setStatus({ kind: "idle" })
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconPencil className="size-4" />
          Edit
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,960px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Edit Finish Selection</SheetTitle>
          <SheetDescription>
            Approved selections can still be changed, but edits create review
            tasks for project follow-up.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submitSelection} className="space-y-4 px-5 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
            <span className="font-medium">{selection.name}</span>
            <span className="text-muted-foreground">
              {selection.status === "approved"
                ? "Approved edit trail enabled"
                : "Selection draft"}
            </span>
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,.75fr)_minmax(0,.75fr)]">
              <Field label="Room">
                <Input
                  name="roomName"
                  defaultValue={selection.roomName}
                  required
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <Field label="Room type">
                <Select
                  value={selectedRoomType}
                  onValueChange={setSelectedRoomType}
                >
                  <SelectTrigger className={DOCUMENT_SELECT_CLASS}>
                    <SelectValue placeholder="Select room type" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.roomTypes.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input
                  type="hidden"
                  name="roomType"
                  value={selectedRoomType}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={selectionStatus}
                  onValueChange={(value) => {
                    const next = STATUS_OPTIONS.find(
                      (option) => option.value === value
                    )
                    if (next) setSelectionStatus(next.value)
                  }}
                >
                  <SelectTrigger className={DOCUMENT_SELECT_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Selection">
              <Input
                name="name"
                defaultValue={selection.name}
                required
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,.65fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Field label="Qty">
                <Input
                  name="quantity"
                  defaultValue={quantityValue(selection.quantity)}
                  inputMode="decimal"
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <Field label="Manufacturer">
                <ProjectSelectionComboboxInput
                  id={`selection-manufacturer-${selection.id}`}
                  name="manufacturer"
                  options={options.manufacturers}
                  placeholder="Delta, Kohler..."
                  defaultValue={textValue(selection.manufacturer)}
                  manualInputLabel="Use custom manufacturer"
                />
              </Field>
              <Field label="Type / model">
                <Input
                  name="model"
                  defaultValue={textValue(selection.model)}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <Field label="Color / finish">
                <Input
                  name="colorFinish"
                  defaultValue={textValue(selection.colorFinish)}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field label="Supplier">
                <Input
                  name="supplierName"
                  defaultValue={textValue(selection.supplierName)}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <Field label="Product link">
                <Input
                  name="productUrl"
                  type="url"
                  defaultValue={textValue(selection.productUrl)}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
            </div>
          </div>

          <div className="border-y py-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,.85fr)_minmax(0,1fr)_minmax(0,.65fr)]">
              <Field label="Division">
                <Select value={division} onValueChange={setDivision}>
                  <SelectTrigger className={DOCUMENT_SELECT_CLASS}>
                    <SelectValue placeholder="All divisions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All divisions</SelectItem>
                    {options.divisions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Cost code">
                <ProjectSelectionComboboxInput
                  id={`selection-cost-code-${selection.id}`}
                  name="costCode"
                  options={costCodeOptions}
                  placeholder="Search cost code"
                  defaultValue={textValue(selection.costCode)}
                  emptyMessage="No cost codes in this division."
                />
              </Field>
              <Field label="Phase">
                <Input
                  name="phaseCode"
                  defaultValue={textValue(selection.phaseCode)}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            <Field label="Category">
              <Input
                name="category"
                defaultValue={selection.category}
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Description">
              <Input
                name="description"
                defaultValue={textValue(selection.description)}
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Notes">
              <Textarea
                name="notes"
                defaultValue={textValue(selection.notes)}
                className={`min-h-24 ${DOCUMENT_TEXTAREA_CLASS}`}
              />
            </Field>
            <Field label="Change reason">
              <Textarea
                name="changeReason"
                placeholder="Optional, but recommended when editing an approved selection."
                className={`min-h-20 ${DOCUMENT_TEXTAREA_CLASS}`}
              />
            </Field>
          </div>

          {status.kind === "error" && (
            <p className="border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive">
              {status.message}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={status.kind === "saving"}>
              {status.kind === "saving" ? (
                <IconPalette className="size-4" />
              ) : status.kind === "saved" ? (
                <IconCheck className="size-4" />
              ) : (
                <IconPencil className="size-4" />
              )}
              {status.kind === "saving"
                ? "Saving changes..."
                : status.kind === "saved"
                  ? "Saved"
                  : "Save changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
