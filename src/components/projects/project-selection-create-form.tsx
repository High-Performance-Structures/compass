"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconCheck, IconPalette, IconPlus } from "@tabler/icons-react"

import {
  createProjectSelection,
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

export function ProjectSelectionCreateForm({
  projectId,
  options,
  roomName = "",
  roomType = "",
  triggerLabel = "New Selection",
  triggerVariant = "default",
}: {
  readonly projectId: string
  readonly options: ProjectSelectionOptions
  readonly roomName?: string
  readonly roomType?: string
  readonly triggerLabel?: string
  readonly triggerVariant?: "default" | "outline" | "ghost"
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<FormState>({ kind: "idle" })
  const [selectionStatus, setSelectionStatus] =
    React.useState<ProjectSelectionStatus>("needed")
  const [selectedRoomType, setSelectedRoomType] = React.useState(roomType)
  const [division, setDivision] = React.useState("all")
  const formRef = React.useRef<HTMLFormElement | null>(null)
  const costCodeOptions = React.useMemo(
    () =>
      division !== "all"
        ? options.costCodes.filter((option) => option.divisionCode === division)
        : options.costCodes,
    [division, options.costCodes]
  )

  function resetDraft(): void {
    formRef.current?.reset()
    setSelectionStatus("needed")
    setSelectedRoomType(roomType)
    setDivision("all")
  }

  async function submitSelection(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    setStatus({ kind: "saving" })
    const formData = new FormData(event.currentTarget)
    const result = await createProjectSelection(projectId, {
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
    })

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    resetDraft()
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
        <Button type="button" variant={triggerVariant}>
          <IconPlus className="size-4" />
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,960px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Add Finish Selection</SheetTitle>
          <SheetDescription>
            Capture one selection with room context, product detail, and
            Sage-ready cost coding.
          </SheetDescription>
        </SheetHeader>

        <form
          ref={formRef}
          onSubmit={submitSelection}
          className="space-y-4 px-5 pb-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
            <span className="font-medium">
              {roomName ? `${roomName} selection` : "Selection draft"}
            </span>
            <span className="text-muted-foreground">
              {costCodeOptions.length} cost code
              {costCodeOptions.length === 1 ? "" : "s"} available
            </span>
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,.75fr)_minmax(0,.75fr)]">
              <Field label="Room">
                <Input
                  name="roomName"
                  defaultValue={roomName}
                  placeholder="Kitchen"
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
                placeholder="Sink faucet, tile, door hardware..."
                required
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,.65fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Field label="Qty">
                <Input
                  name="quantity"
                  inputMode="decimal"
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <Field label="Manufacturer">
                <ProjectSelectionComboboxInput
                  id="selection-manufacturer"
                  name="manufacturer"
                  options={options.manufacturers}
                  placeholder="Delta, Kohler..."
                  manualInputLabel="Use custom manufacturer"
                />
              </Field>
              <Field label="Type / model">
                <Input name="model" className={DOCUMENT_INPUT_CLASS} />
              </Field>
              <Field label="Color / finish">
                <Input name="colorFinish" className={DOCUMENT_INPUT_CLASS} />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field label="Supplier">
                <Input name="supplierName" className={DOCUMENT_INPUT_CLASS} />
              </Field>
              <Field label="Product link">
                <Input
                  name="productUrl"
                  type="url"
                  placeholder="https://..."
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
                  id="selection-cost-code"
                  name="costCode"
                  options={costCodeOptions}
                  placeholder="Search cost code"
                  emptyMessage="No cost codes in this division."
                />
              </Field>
              <Field label="Phase">
                <Input name="phaseCode" className={DOCUMENT_INPUT_CLASS} />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            <Field label="Category">
              <Input
                name="category"
                placeholder="Fixtures, flooring, cabinetry..."
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Description">
              <Input name="description" className={DOCUMENT_INPUT_CLASS} />
            </Field>
            <Field label="Notes">
              <Textarea
                name="notes"
                className={`min-h-24 ${DOCUMENT_TEXTAREA_CLASS}`}
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
                <IconPlus className="size-4" />
              )}
              {status.kind === "saving"
                ? "Saving selection..."
                : status.kind === "saved"
                  ? "Saved"
                  : "Add selection"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
