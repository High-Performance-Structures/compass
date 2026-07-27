"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconCheck,
  IconChevronDown,
  IconExternalLink,
  IconFileText,
  IconPlus,
  IconSend,
  IconShoppingCartQuestion,
  IconTrash,
} from "@tabler/icons-react"

import {
  type CreateRfqDocumentLinkInput,
  type CreateRfqScopeLineInput,
  createRfqRequest,
} from "@/app/actions/project-operations"
import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import type {
  ProjectSelectionItem,
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/app/actions/project-selections"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import {
  RFQ_VENDOR_CATEGORY_OPTIONS,
  type RfqVendorCategoryOption,
} from "@/lib/project-rfq-categories"
import { cn } from "@/lib/utils"

type DraftRfqScopeLine = {
  readonly id: string
  readonly description: string
  readonly phaseCode: string
  readonly costCode: string
  readonly notes: string
}

type DraftRfqDocumentLink = {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly notes: string
}

type RfqLineField = "description" | "phaseCode" | "costCode" | "notes"
type RfqDocumentField = "label" | "url" | "notes"
type SelectionFilterState = {
  readonly division: string
  readonly costCode: string
  readonly roomName: string
}

type RfqStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }

const DOCUMENT_INPUT_CLASS =
  "rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0 focus-visible:border-foreground"
const LINE_INPUT_CLASS =
  "h-8 rounded-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:bg-background"
const ALL = "all"

function newLine(): DraftRfqScopeLine {
  return {
    id: crypto.randomUUID(),
    description: "",
    phaseCode: "",
    costCode: "",
    notes: "",
  }
}

function lineFromSelection(selection: ProjectSelectionItem): DraftRfqScopeLine {
  const detail = [
    selection.manufacturer ? `Manufacturer: ${selection.manufacturer}` : null,
    selection.model ? `Model: ${selection.model}` : null,
    selection.colorFinish ? `Finish: ${selection.colorFinish}` : null,
    selection.supplierName ? `Supplier: ${selection.supplierName}` : null,
    selection.productUrl ? `Product: ${selection.productUrl}` : null,
    selection.notes ? `Notes: ${selection.notes}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" | ")

  return {
    id: crypto.randomUUID(),
    description: `${selection.roomName}: ${selection.name}`,
    phaseCode: selection.phaseCode ?? "",
    costCode: selection.costCode ?? "",
    notes: detail,
  }
}

function newDocumentLink(): DraftRfqDocumentLink {
  return {
    id: crypto.randomUUID(),
    label: "",
    url: "",
    notes: "",
  }
}

function cleanValue(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeChoice(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function optionMatches(
  option: ProjectTaskAssigneeOption,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true

  return normalizeChoice(
    [
      option.name,
      option.label,
      option.companyName,
      option.email,
      option.contactType,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
  ).includes(normalizedQuery)
}

function categoryMatches(
  option: RfqVendorCategoryOption,
  normalizedQuery: string
): boolean {
  if (!normalizedQuery) return true
  return normalizeChoice(`${option.label} ${option.division ?? ""}`).includes(
    normalizedQuery
  )
}

function toScopeInput(line: DraftRfqScopeLine): CreateRfqScopeLineInput {
  return {
    description: cleanValue(line.description),
    phaseCode: cleanValue(line.phaseCode),
    costCode: cleanValue(line.costCode),
    notes: cleanValue(line.notes),
  }
}

function toDocumentInput(
  link: DraftRfqDocumentLink
): CreateRfqDocumentLinkInput {
  return {
    label: cleanValue(link.label),
    url: cleanValue(link.url),
    notes: cleanValue(link.notes),
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

function contactTypeLabel(value: string): string {
  if (value === "supplier") return "Supplier"
  if (value === "subcontractor") return "Subcontractor"
  if (value === "internal") return "Internal"
  if (value === "owner") return "Owner"
  return value
}

function selectionStatusLabel(status: ProjectSelectionItem["status"]): string {
  return status
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function flattenSelections(
  summary: ProjectSelectionsSummary
): readonly ProjectSelectionItem[] {
  return summary.rooms.flatMap((room) => room.selections)
}

function divisionForSelection(
  selection: ProjectSelectionItem,
  options: ProjectSelectionOptions
): string | null {
  if (!selection.costCode) return null
  return (
    options.costCodes.find((option) => option.value === selection.costCode)
      ?.divisionCode ?? selection.costCode.slice(0, 2)
  )
}

function selectionMatchesFilters({
  filters,
  options,
  selection,
}: {
  readonly filters: SelectionFilterState
  readonly options: ProjectSelectionOptions
  readonly selection: ProjectSelectionItem
}): boolean {
  if (filters.roomName !== ALL && selection.roomName !== filters.roomName) {
    return false
  }
  if (filters.costCode !== ALL && selection.costCode !== filters.costCode) {
    return false
  }
  if (filters.division !== ALL) {
    return divisionForSelection(selection, options) === filters.division
  }
  return true
}

export function ProjectRfqCreateForm({
  projectId,
  recipientOptions,
  selectionOptions,
  selectionsSummary,
}: {
  readonly projectId: string
  readonly recipientOptions: readonly ProjectTaskAssigneeOption[]
  readonly selectionOptions: ProjectSelectionOptions
  readonly selectionsSummary: ProjectSelectionsSummary
}): React.ReactElement {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [open, setOpen] = React.useState(false)
  const [recipientPickerOpen, setRecipientPickerOpen] = React.useState(false)
  const [categoryPickerOpen, setCategoryPickerOpen] = React.useState(false)
  const [recipientQuery, setRecipientQuery] = React.useState("")
  const [categoryQuery, setCategoryQuery] = React.useState("")
  const [selectedRecipientId, setSelectedRecipientId] = React.useState<
    string | null
  >(null)
  const [requestedFrom, setRequestedFrom] = React.useState("")
  const [recipientEmail, setRecipientEmail] = React.useState("")
  const [vendorCategory, setVendorCategory] = React.useState("")
  const [priority, setPriority] = React.useState("normal")
  const [selectionFilters, setSelectionFilters] =
    React.useState<SelectionFilterState>({
      division: ALL,
      costCode: ALL,
      roomName: ALL,
    })
  const [selectedSelectionIds, setSelectedSelectionIds] = React.useState<
    ReadonlySet<string>
  >(new Set())
  const [lines, setLines] = React.useState<readonly DraftRfqScopeLine[]>([
    newLine(),
  ])
  const [documentLinks, setDocumentLinks] = React.useState<
    readonly DraftRfqDocumentLink[]
  >([newDocumentLink()])
  const [status, setStatus] = React.useState<RfqStatus>({ kind: "idle" })
  const normalizedRecipientQuery = normalizeChoice(recipientQuery)
  const normalizedCategoryQuery = normalizeChoice(categoryQuery)
  const projectRecipientOptions = recipientOptions.filter(
    (option) =>
      option.source === "project" &&
      optionMatches(option, normalizedRecipientQuery)
  )
  const directoryRecipientOptions = recipientOptions.filter(
    (option) =>
      option.source === "directory" &&
      optionMatches(option, normalizedRecipientQuery)
  )
  const vendorCategoryOptions = RFQ_VENDOR_CATEGORY_OPTIONS.filter((option) =>
    categoryMatches(option, normalizedCategoryQuery)
  )
  const selectedRecipient = selectedRecipientId
    ? recipientOptions.find((option) => option.id === selectedRecipientId) ??
      null
    : null
  const lineCount = lines.filter(
    (line) => cleanValue(line.description) !== null
  ).length
  const documentCount = documentLinks.filter(
    (link) => cleanValue(link.url) !== null
  ).length
  const allSelections = React.useMemo(
    () => flattenSelections(selectionsSummary),
    [selectionsSummary]
  )
  const selectionCostCodes = React.useMemo(
    () =>
      selectionOptions.costCodes.filter((option) =>
        allSelections.some((selection) => selection.costCode === option.value)
      ),
    [allSelections, selectionOptions.costCodes]
  )
  const selectionDivisions = React.useMemo(
    () =>
      selectionOptions.divisions.filter((division) =>
        allSelections.some(
          (selection) =>
            divisionForSelection(selection, selectionOptions) === division.value
        )
      ),
    [allSelections, selectionOptions]
  )
  const filteredSelectionCostCodes = React.useMemo(
    () =>
      selectionFilters.division === ALL
        ? selectionCostCodes
        : selectionCostCodes.filter(
            (option) => option.divisionCode === selectionFilters.division
          ),
    [selectionCostCodes, selectionFilters.division]
  )
  const filteredSelections = React.useMemo(
    () =>
      allSelections.filter((selection) =>
        selectionMatchesFilters({
          filters: selectionFilters,
          options: selectionOptions,
          selection,
        })
      ),
    [allSelections, selectionFilters, selectionOptions]
  )
  const selectedSelections = React.useMemo(
    () =>
      allSelections.filter((selection) => selectedSelectionIds.has(selection.id)),
    [allSelections, selectedSelectionIds]
  )

  function selectRecipient(option: ProjectTaskAssigneeOption): void {
    setSelectedRecipientId(option.id)
    setRequestedFrom(option.companyName ?? option.name)
    setRecipientEmail(option.email ?? "")
    setVendorCategory(contactTypeLabel(option.contactType))
    setRecipientQuery("")
    setRecipientPickerOpen(false)
  }

  function useTypedRecipient(): void {
    const typedName = recipientQuery.trim()
    if (!typedName) return

    setSelectedRecipientId(null)
    setRequestedFrom(typedName)
    setRecipientQuery("")
    setRecipientPickerOpen(false)
  }

  function clearRecipient(): void {
    setSelectedRecipientId(null)
    setRequestedFrom("")
    setRecipientEmail("")
    setRecipientQuery("")
  }

  function selectVendorCategory(option: RfqVendorCategoryOption): void {
    setVendorCategory(option.label)
    setCategoryQuery("")
    setCategoryPickerOpen(false)
    if (option.division) {
      setSelectionFilters((current) => ({
        ...current,
        division: option.division ?? ALL,
        costCode:
          option.division === null ||
          selectionOptions.costCodes.some(
            (costCode) =>
              costCode.value === current.costCode &&
              costCode.divisionCode === option.division
          )
            ? current.costCode
            : ALL,
      }))
    }
  }

  function useTypedVendorCategory(): void {
    const typedCategory = categoryQuery.trim()
    if (!typedCategory) return
    setVendorCategory(typedCategory)
    setCategoryQuery("")
    setCategoryPickerOpen(false)
  }

  function clearVendorCategory(): void {
    setVendorCategory("")
    setCategoryQuery("")
  }

  function addLine(): void {
    setLines((current) => [...current, newLine()])
  }

  function toggleSelection(selectionId: string, checked: boolean): void {
    setSelectedSelectionIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(selectionId)
      } else {
        next.delete(selectionId)
      }
      return next
    })
  }

  function selectAllFilteredSelections(): void {
    setSelectedSelectionIds((current) => {
      const next = new Set(current)
      for (const selection of filteredSelections) {
        next.add(selection.id)
      }
      return next
    })
  }

  function clearSelectedSelections(): void {
    setSelectedSelectionIds(new Set())
  }

  function importSelectedSelections(): void {
    if (selectedSelections.length === 0) return
    const importedLines = selectedSelections.map(lineFromSelection)
    setLines((current) => {
      const meaningfulLines = current.filter(
        (line) =>
          cleanValue(line.description) !== null ||
          cleanValue(line.phaseCode) !== null ||
          cleanValue(line.costCode) !== null ||
          cleanValue(line.notes) !== null
      )
      return [...meaningfulLines, ...importedLines]
    })
    setSelectedSelectionIds(new Set())
  }

  function removeLine(id: string): void {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.id !== id)
    )
  }

  function updateLine(id: string, field: RfqLineField, value: string): void {
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

  function addDocumentLink(): void {
    setDocumentLinks((current) => [...current, newDocumentLink()])
  }

  function removeDocumentLink(id: string): void {
    setDocumentLinks((current) =>
      current.length === 1
        ? current
        : current.filter((link) => link.id !== id)
    )
  }

  function updateDocumentLink(
    id: string,
    field: RfqDocumentField,
    value: string
  ): void {
    setDocumentLinks((current) =>
      current.map((link) =>
        link.id === id
          ? {
              ...link,
              [field]: value,
            }
          : link
      )
    )
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    const form = formRef.current
    if (!form) return

    setStatus({ kind: "saving" })
    const formData = new FormData(form)
    const result = await createRfqRequest(projectId, {
      title: String(formData.get("title") ?? ""),
      vendorCategory: cleanValue(vendorCategory),
      requestedFrom: cleanValue(requestedFrom),
      recipientEmail: cleanValue(recipientEmail),
      responseDueDate: cleanValue(String(formData.get("responseDueDate") ?? "")),
      priority,
      scope: cleanValue(String(formData.get("scope") ?? "")),
      scopeItems: lines.map(toScopeInput),
      documentLinks: documentLinks.map(toDocumentInput),
    })

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    form.reset()
    setSelectedRecipientId(null)
    setRequestedFrom("")
    setRecipientEmail("")
    setVendorCategory("")
    setPriority("normal")
    setSelectedSelectionIds(new Set())
    setSelectionFilters({ division: ALL, costCode: ALL, roomName: ALL })
    setLines([newLine()])
    setDocumentLinks([newDocumentLink()])
    setStatus({ kind: "saved", message: "RFQ draft created." })
    setOpen(false)
    router.push(
      `/dashboard/projects/${projectId}/rfqs?created=${encodeURIComponent(
        result.id
      )}`
    )
    router.refresh()
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button">
          <IconPlus className="size-4" />
          New RFQ
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,1120px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Request for Quote</SheetTitle>
          <SheetDescription>
            Draft a scope, choose a vendor or trade, and track the response date.
          </SheetDescription>
        </SheetHeader>

        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-4 px-5 pb-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
            <span className="font-medium">RFQ draft</span>
            <span className="text-muted-foreground">
              {lineCount}/{lines.length} scope rows, {documentCount} document{" "}
              {documentCount === 1 ? "link" : "links"}
            </span>
          </div>

          <div className="space-y-3">
            <Field label="RFQ title / scope">
              <Input
                name="title"
                placeholder="Window package quote"
                required
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Overall scope">
              <Textarea
                name="scope"
                placeholder="Summarize the requested work, alternates, assumptions, or exclusions."
                className={`min-h-24 ${DOCUMENT_INPUT_CLASS}`}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Requested from
                </Label>
                <Popover
                  open={recipientPickerOpen}
                  onOpenChange={setRecipientPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-10 w-full justify-between rounded-none border-x-0 border-t-0 bg-background px-0 text-left font-normal shadow-none",
                        !requestedFrom && "text-muted-foreground"
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {requestedFrom || "Choose vendor, sub, or type a name..."}
                      </span>
                      <IconChevronDown className="size-4 shrink-0 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[min(30rem,calc(100vw-3rem))] p-0"
                  >
                    <div className="border-b p-3">
                      <Input
                        value={recipientQuery}
                        onChange={(event) =>
                          setRecipientQuery(event.target.value)
                        }
                        placeholder="Search contacts or type a name..."
                        autoFocus
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto p-2">
                      {projectRecipientOptions.length > 0 && (
                        <div className="space-y-1">
                          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                            Project &amp; team contacts
                          </p>
                          {projectRecipientOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => selectRecipient(option)}
                              className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">
                                  {option.companyName ?? option.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {option.email ?? contactTypeLabel(option.contactType)}
                                </span>
                              </span>
                              {selectedRecipientId === option.id && (
                                <IconCheck className="mt-0.5 size-4 shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {directoryRecipientOptions.length > 0 && (
                        <div className="mt-2 space-y-1 border-t pt-2">
                          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                            Directory contacts
                          </p>
                          {directoryRecipientOptions.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => selectRecipient(option)}
                              className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">
                                  {option.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  Not on this project yet
                                </span>
                              </span>
                              {selectedRecipientId === option.id && (
                                <IconCheck className="mt-0.5 size-4 shrink-0" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      {normalizedRecipientQuery &&
                        projectRecipientOptions.length === 0 &&
                        directoryRecipientOptions.length === 0 && (
                          <p className="px-2 py-3 text-sm text-muted-foreground">
                            No matching contacts.
                          </p>
                        )}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearRecipient}
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!recipientQuery.trim()}
                        onClick={useTypedRecipient}
                      >
                        Use typed name
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <Field label="Recipient email">
                <Input
                  value={recipientEmail}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  placeholder="optional for now"
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Vendor category / trade
                </Label>
                <Popover
                  open={categoryPickerOpen}
                  onOpenChange={setCategoryPickerOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "h-10 w-full justify-between rounded-none border-x-0 border-t-0 bg-background px-0 text-left font-normal shadow-none",
                        !vendorCategory && "text-muted-foreground"
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {vendorCategory || "Choose trade/category..."}
                      </span>
                      <IconChevronDown className="size-4 shrink-0 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[min(30rem,calc(100vw-3rem))] p-0"
                  >
                    <div className="border-b p-3">
                      <Input
                        value={categoryQuery}
                        onChange={(event) =>
                          setCategoryQuery(event.target.value)
                        }
                        placeholder="Search trade or type a category..."
                        autoFocus
                      />
                    </div>
                    <div className="compass-content-scroll max-h-72 overflow-y-auto p-2">
                      {vendorCategoryOptions.length > 0 ? (
                        vendorCategoryOptions.map((option) => (
                          <button
                            key={`${option.division ?? "misc"}-${option.label}`}
                            type="button"
                            onClick={() => selectVendorCategory(option)}
                            className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {option.label}
                              </span>
                              {option.division && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  Division {option.division}
                                </span>
                              )}
                            </span>
                            {vendorCategory === option.label && (
                              <IconCheck className="mt-0.5 size-4 shrink-0" />
                            )}
                          </button>
                        ))
                      ) : (
                        <p className="px-2 py-3 text-sm text-muted-foreground">
                          No matching categories.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearVendorCategory}
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!categoryQuery.trim()}
                        onClick={useTypedVendorCategory}
                      >
                        Use typed category
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <Field label="Response needed by">
                <Input
                  name="responseDueDate"
                  type="date"
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Priority
                </Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="w-full rounded-none border-x-0 border-t-0 px-0 shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="compass-content-scroll max-h-72">
                    <SelectItem value="normal">Normal priority</SelectItem>
                    <SelectItem value="high">High priority</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="low">Low priority</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {selectedRecipient?.source === "directory" && (
            <div className="border-l-4 border-brand-nutech-gold bg-card px-3 py-2 text-sm">
              <p className="font-medium">
                {selectedRecipient.name} is in the directory, but not on this
                project yet.
              </p>
              <p className="mt-1 text-muted-foreground">
                The RFQ can be drafted without granting project portal access.
                Add the contact to the project later if they need to see project
                materials.
              </p>
            </div>
          )}

          {allSelections.length > 0 && (
            <div className="border-y">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Import finish selections
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Pull room selections into this RFQ scope by room, division,
                    or cost code.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={filteredSelections.length === 0}
                    onClick={selectAllFilteredSelections}
                  >
                    Select filtered
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={selectedSelectionIds.size === 0}
                    onClick={clearSelectedSelections}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={selectedSelections.length === 0}
                    onClick={importSelectedSelections}
                  >
                    Import {selectedSelections.length || ""}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Division
                  </span>
                  <Select
                    value={selectionFilters.division}
                    onValueChange={(value) =>
                      setSelectionFilters((current) => ({
                        ...current,
                        division: value,
                        costCode:
                          value === ALL ||
                          selectionOptions.costCodes.some(
                            (option) =>
                              option.value === current.costCode &&
                              option.divisionCode === value
                          )
                            ? current.costCode
                            : ALL,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All divisions" />
                    </SelectTrigger>
                    <SelectContent className="compass-content-scroll max-h-80">
                      <SelectItem value={ALL}>All divisions</SelectItem>
                      {selectionDivisions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Cost code
                  </span>
                  <Select
                    value={selectionFilters.costCode}
                    onValueChange={(value) =>
                      setSelectionFilters((current) => ({
                        ...current,
                        costCode: value,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All cost codes" />
                    </SelectTrigger>
                    <SelectContent className="compass-content-scroll max-h-80">
                      <SelectItem value={ALL}>All cost codes</SelectItem>
                      {filteredSelectionCostCodes.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                          {option.needsSageReview
                            ? " - needs Sage review"
                            : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Room
                  </span>
                  <Select
                    value={selectionFilters.roomName}
                    onValueChange={(value) =>
                      setSelectionFilters((current) => ({
                        ...current,
                        roomName: value,
                      }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All rooms" />
                    </SelectTrigger>
                    <SelectContent className="compass-content-scroll max-h-80">
                      <SelectItem value={ALL}>All rooms</SelectItem>
                      {selectionsSummary.rooms.map((room) => (
                        <SelectItem key={room.roomName} value={room.roomName}>
                          {room.roomName} ({room.selections.length})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="max-h-72 overflow-y-auto border-t">
                {filteredSelections.length > 0 ? (
                  filteredSelections.map((selection) => (
                    <label
                      key={selection.id}
                      className="grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_7rem_8rem] gap-2 border-b px-2 py-2 text-sm last:border-b-0 hover:bg-accent/60"
                    >
                      <Checkbox
                        checked={selectedSelectionIds.has(selection.id)}
                        onCheckedChange={(checked) =>
                          toggleSelection(selection.id, checked === true)
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {selection.roomName}: {selection.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[selection.category, selection.manufacturer, selection.model]
                            .filter((value): value is string => Boolean(value))
                            .join(" · ") || "Selection detail"}
                        </span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {selection.costCode ?? "No code"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {selectionStatusLabel(selection.status)}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="px-2 py-4 text-sm text-muted-foreground">
                    No finish selections match these filters.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="border-y">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
              <div>
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <IconFileText className="size-4" />
                  Plans & specs package
                </h3>
                <p className="text-xs text-muted-foreground">
                  Add approved Drive links, plan sheets, specs, addenda, or
                  project photos that this vendor may use for pricing.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addDocumentLink}
              >
                <IconPlus className="size-4" />
                Add link
              </Button>
            </div>
            <div className="space-y-3 py-3">
              {documentLinks.map((link, index) => (
                <div
                  key={link.id}
                  className="grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 md:grid-cols-[minmax(9rem,.8fr)_minmax(16rem,1.4fr)_minmax(10rem,1fr)_2.5rem]"
                >
                  <Input
                    value={link.label}
                    onChange={(event) =>
                      updateDocumentLink(link.id, "label", event.target.value)
                    }
                    placeholder="Plan set, specs, addendum..."
                    className={DOCUMENT_INPUT_CLASS}
                    aria-label={`RFQ document ${index + 1} label`}
                  />
                  <div className="relative">
                    <Input
                      value={link.url}
                      onChange={(event) =>
                        updateDocumentLink(link.id, "url", event.target.value)
                      }
                      placeholder="https://drive.google.com/..."
                      className={`${DOCUMENT_INPUT_CLASS} pr-8`}
                      aria-label={`RFQ document ${index + 1} URL`}
                    />
                    {cleanValue(link.url) !== null && (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                        aria-label={`Open RFQ document ${index + 1}`}
                      >
                        <IconExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                  <Input
                    value={link.notes}
                    onChange={(event) =>
                      updateDocumentLink(link.id, "notes", event.target.value)
                    }
                    placeholder="Sheet range, revision, access note"
                    className={DOCUMENT_INPUT_CLASS}
                    aria-label={`RFQ document ${index + 1} notes`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    disabled={documentLinks.length === 1}
                    onClick={() => removeDocumentLink(link.id)}
                    aria-label={`Remove RFQ document ${index + 1}`}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-y">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
              <div>
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                  Scope rows
                </h3>
                <p className="text-xs text-muted-foreground">
                  Use rows for cost codes, phases, alternates, or quote sections.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <IconPlus className="size-4" />
                Add row
              </Button>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[820px]">
                <div className="grid grid-cols-[2rem_minmax(14rem,1fr)_5rem_6rem_minmax(10rem,.8fr)_2.5rem] gap-2 border-b py-2 text-xs font-medium text-muted-foreground">
                  <span>#</span>
                  <span>Description</span>
                  <span>Phase</span>
                  <span>Cost code</span>
                  <span>Notes</span>
                  <span />
                </div>
                {lines.map((line, index) => (
                  <div
                    key={line.id}
                    className="grid grid-cols-[2rem_minmax(14rem,1fr)_5rem_6rem_minmax(10rem,.8fr)_2.5rem] gap-2 border-b py-2 last:border-b-0"
                  >
                    <span className="pt-2 text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <Input
                      value={line.description}
                      onChange={(event) =>
                        updateLine(line.id, "description", event.target.value)
                      }
                      placeholder="Scope item"
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
                      value={line.notes}
                      onChange={(event) =>
                        updateLine(line.id, "notes", event.target.value)
                      }
                      placeholder="Alternate, allowance, detail"
                      className={LINE_INPUT_CLASS}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      disabled={lines.length === 1}
                      onClick={() => removeLine(line.id)}
                      aria-label={`Remove scope row ${index + 1}`}
                    >
                      <IconTrash className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {status.kind === "saved" && (
            <p className="border-l-2 border-l-brand-hps-primary px-3 py-2 text-sm text-brand-hps-primary">
              {status.message}
            </p>
          )}
          {status.kind === "error" && (
            <p className="border-l-2 border-l-destructive px-3 py-2 text-sm text-destructive">
              {status.message}
            </p>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={status.kind === "saving"}>
              {status.kind === "saving" ? (
                <IconSend className="size-4" />
              ) : (
                <IconShoppingCartQuestion className="size-4" />
              )}
              {status.kind === "saving" ? "Creating..." : "Create RFQ"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
