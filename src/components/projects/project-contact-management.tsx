"use client"

import {
  IconCheck,
  IconChevronDown,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  createCustomerDirectoryContact,
  type CustomerRelationshipType,
} from "@/app/actions/customers"
import {
  removeProjectContact,
  saveProjectContact,
  type ProjectContactCostCodeOption,
  type ProjectContactDirectoryOption,
  type ProjectContactItem,
  type ProjectContactMutationInput,
  type ProjectContactSageOptions,
  type ProjectContactType,
} from "@/app/actions/project-contacts"
import {
  createVendor,
  createVendorContact,
} from "@/app/actions/vendors"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { PROJECT_WORKFLOW_ROLE_LENSES } from "@/lib/project-workflow-roles"
import { cn } from "@/lib/utils"

const CUSTOM_PROJECT_ROLE_VALUE = "custom-project-role"
const EXTERNAL_PROJECT_ROLES = [
  "Owner / Client",
  "Subcontractor",
  "Supplier",
] as const
const PROJECT_ROLE_LABELS = [
  ...PROJECT_WORKFLOW_ROLE_LENSES.map((role) => role.label),
  ...EXTERNAL_PROJECT_ROLES,
] as const

function isPresetProjectRole(value: string): boolean {
  return PROJECT_ROLE_LABELS.some((role) => role === value)
}

function defaultProjectRole(type: ProjectContactType): string {
  switch (type) {
    case "owner":
      return "Owner / Client"
    case "supplier":
      return "Supplier"
    case "subcontractor":
      return "Subcontractor"
    case "internal":
      return ""
  }
}

function directorySourceLabel(
  sourceType: ProjectContactDirectoryOption["sourceType"]
): string {
  switch (sourceType) {
    case "customer":
      return "Customers"
    case "vendor":
      return "Vendors and subcontractors"
    case "team":
      return "Internal team"
  }
}

function initialInput(
  projectId: string,
  contact: ProjectContactItem | null
): ProjectContactMutationInput {
  const directorySourceType = contact?.vendorId
    ? "vendor"
    : contact?.sourceEntityType === "customer"
      ? "customer"
      : contact?.sourceEntityType === "user"
        ? "team"
        : null
  const directorySourceId =
    contact?.vendorId ??
    (directorySourceType && contact?.sourceEntityId
      ? contact.sourceEntityId
      : null)

  return {
    projectId,
    contactId: contact?.id ?? null,
    directorySourceType,
    directorySourceId,
    vendorId: contact?.vendorId ?? null,
    vendorContactId: contact?.vendorContactId ?? null,
    contactType: contact?.contactType ?? "owner",
    displayName: contact?.displayName ?? "",
    companyName: contact?.companyName ?? "",
    role: contact?.role ?? "",
    trade: contact?.trade ?? "",
    csiDivision: contact?.csiDivision ?? "",
    csiDivisionName: contact?.csiDivisionName ?? "",
    primaryCostCode: contact?.primaryCostCode ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    address: contact?.address ?? "",
    notes: contact?.notes ?? "",
    ownerPortalVisible: contact?.ownerPortalVisible ?? false,
    subVendorPortalVisible: contact?.subVendorPortalVisible ?? false,
    internalVisible: contact?.internalVisible ?? true,
    primaryContact: contact?.primaryContact ?? false,
  }
}

function isVendorContactType(type: ProjectContactType): boolean {
  return type === "supplier" || type === "subcontractor"
}

function groupedDirectoryOptions(
  options: readonly ProjectContactDirectoryOption[]
): readonly {
  readonly sourceType: ProjectContactDirectoryOption["sourceType"]
  readonly options: readonly ProjectContactDirectoryOption[]
}[] {
  return (["customer", "vendor", "team"] satisfies readonly ProjectContactDirectoryOption["sourceType"][])
    .map((sourceType) => ({
      sourceType,
      options: options.filter((option) => option.sourceType === sourceType),
    }))
    .filter((group) => group.options.length > 0)
}

function DirectoryPicker({
  options,
  selected,
  onSelect,
  placeholder = "Choose a contact or enter one manually...",
  searchPlaceholder = "Search customers, vendors, or staff...",
}: {
  readonly options: readonly ProjectContactDirectoryOption[]
  readonly selected: ProjectContactDirectoryOption | null
  readonly onSelect: (option: ProjectContactDirectoryOption) => void
  readonly placeholder?: string
  readonly searchPlaceholder?: string
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const groups = groupedDirectoryOptions(options)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? selected.displayName : placeholder}
          </span>
          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No matching directory contact.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.sourceType}
                heading={directorySourceLabel(group.sourceType)}
              >
                {group.options.map((option) => (
                  <CommandItem
                    key={`${option.sourceType}:${option.id}`}
                    value={`${option.displayName} ${option.companyName ?? ""} ${option.email ?? ""}`}
                    onSelect={() => {
                      onSelect(option)
                      setOpen(false)
                    }}
                  >
                    <IconCheck
                      className={cn(
                        "mr-2 size-4",
                        selected?.id === option.id &&
                          selected.sourceType === option.sourceType
                          ? "opacity-100"
                          : "opacity-0"
                      )}
                    />
                    <div className="min-w-0">
                      <p className="truncate">{option.displayName}</p>
                      {(option.companyName || option.email) && (
                        <p className="truncate text-xs text-muted-foreground">
                          {[option.companyName, option.email].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CostCodePicker({
  options,
  value,
  onSelect,
}: {
  readonly options: readonly ProjectContactCostCodeOption[]
  readonly value: string
  readonly onSelect: (option: ProjectContactCostCodeOption | null) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="project-contact-cost-code"
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={options.length === 0 && !value}
        >
          <span className="truncate">
            {selected?.label ?? (value || "Choose a cost code...")}
          </span>
          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search cost codes..." />
          <CommandList className="max-h-72">
            <CommandEmpty>No matching cost code.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="Clear cost code"
                  onSelect={() => {
                    onSelect(null)
                    setOpen(false)
                  }}
                >
                  Clear cost code
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description}`}
                  onSelect={() => {
                    onSelect(option)
                    setOpen(false)
                  }}
                >
                  <IconCheck
                    className={cn(
                      "mr-2 size-4",
                      selected?.value === option.value
                        ? "opacity-100"
                        : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function VisibilityCheckbox({
  id,
  checked,
  label,
  description,
  onCheckedChange,
}: {
  readonly id: string
  readonly checked: boolean
  readonly label: string
  readonly description: string
  readonly onCheckedChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <div className="grid gap-1 leading-none">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function ProjectContactEditor({
  projectId,
  contact = null,
  directoryOptions,
  sageOptions,
}: {
  readonly projectId: string
  readonly contact?: ProjectContactItem | null
  readonly directoryOptions: readonly ProjectContactDirectoryOption[]
  readonly sageOptions: ProjectContactSageOptions
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [directoryOpenKey, setDirectoryOpenKey] = useState<string | null>(null)
  const [availableDirectoryOptions, setAvailableDirectoryOptions] = useState(
    directoryOptions
  )
  const [input, setInput] = useState(() => initialInput(projectId, contact))
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerCompany, setNewCustomerCompany] = useState("")
  const [newCustomerEmail, setNewCustomerEmail] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [newCustomerRelationship, setNewCustomerRelationship] =
    useState<CustomerRelationshipType>("client")
  const [showNewVendor, setShowNewVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState("")
  const [showNewVendorContact, setShowNewVendorContact] = useState(false)
  const [newVendorContactName, setNewVendorContactName] = useState("")
  const [newVendorContactTitle, setNewVendorContactTitle] = useState("")
  const [newVendorContactEmail, setNewVendorContactEmail] = useState("")
  const [newVendorContactPhone, setNewVendorContactPhone] = useState("")
  const [customRoleSelected, setCustomRoleSelected] = useState(
    () => Boolean(contact?.role && !isPresetProjectRole(contact.role))
  )
  const [isPending, startTransition] = useTransition()
  const isEditing = contact !== null
  const selectedDirectory = availableDirectoryOptions.find(
    (option) =>
      option.id === input.directorySourceId &&
      option.sourceType === input.directorySourceType
  ) ?? null
  const vendorOptions = availableDirectoryOptions.filter(
    (option) => option.sourceType === "vendor"
  )
  const customerOptions = availableDirectoryOptions.filter(
    (option) => option.sourceType === "customer"
  )
  const selectedVendor =
    selectedDirectory?.sourceType === "vendor" ? selectedDirectory : null
  const selectedVendorContact = selectedVendor?.vendorContacts.find(
    (vendorContact) => vendorContact.id === input.vendorContactId
  ) ?? null
  const legacyVendorPerson =
    selectedVendor &&
    !input.vendorContactId &&
    input.displayName.trim() &&
    input.displayName.trim() !== selectedVendor.displayName
      ? input.displayName.trim()
      : null
  const filteredCostCodes = input.csiDivision
    ? sageOptions.costCodes.filter(
        (option) => option.divisionCode === input.csiDivision
      )
    : sageOptions.costCodes
  const identityManagedByActiveUser =
    input.directorySourceType === null
      ? (contact?.identityManagedByActiveUser ?? false)
      : (selectedVendorContact?.identityManagedByActiveUser ??
        selectedDirectory?.identityManagedByActiveUser ??
        false)
  const identityReadOnly = selectedDirectory !== null || identityManagedByActiveUser

  function updateInput<Key extends keyof ProjectContactMutationInput>(
    key: Key,
    value: ProjectContactMutationInput[Key]
  ): void {
    setInput((current) => ({ ...current, [key]: value }))
  }

  function resetEditor(nextOpen: boolean): void {
    setOpen(nextOpen)
    if (nextOpen) {
      setInput(initialInput(projectId, contact))
      setAvailableDirectoryOptions(directoryOptions)
      setDirectoryOpenKey(null)
      setShowNewCustomer(false)
      setNewCustomerName("")
      setNewCustomerCompany("")
      setNewCustomerEmail("")
      setNewCustomerPhone("")
      setNewCustomerRelationship("client")
      setShowNewVendor(false)
      setNewVendorName("")
      setShowNewVendorContact(false)
      setNewVendorContactName("")
      setNewVendorContactTitle("")
      setNewVendorContactEmail("")
      setNewVendorContactPhone("")
      setCustomRoleSelected(
        Boolean(contact?.role && !isPresetProjectRole(contact.role))
      )
    }
  }

  function applyDirectoryOption(option: ProjectContactDirectoryOption): void {
    setDirectoryOpenKey(`${option.sourceType}:${option.id}`)
    setCustomRoleSelected(false)
    setInput((current) => {
      const contactType =
        option.sourceType === "vendor" &&
        isVendorContactType(current.contactType)
          ? current.contactType
          : option.suggestedContactType
      return {
        ...current,
        directorySourceType: option.sourceType,
        directorySourceId: option.id,
        vendorId: option.sourceType === "vendor" ? option.id : null,
        vendorContactId: null,
        contactType,
        displayName: option.displayName,
        companyName: option.companyName ?? "",
        email: option.email ?? "",
        phone: option.phone ?? "",
        address: option.address ?? "",
        role: defaultProjectRole(contactType),
        ownerPortalVisible:
          contactType === "internal" || current.ownerPortalVisible,
        subVendorPortalVisible:
          isVendorContactType(contactType) || current.subVendorPortalVisible,
      }
    })
  }

  function applyVendorContact(contactId: string): void {
    if (!selectedVendor) return
    if (contactId === "company-only") {
      setInput((current) => ({
        ...current,
        vendorContactId: null,
        displayName: selectedVendor.displayName,
        companyName: selectedVendor.displayName,
        email: selectedVendor.email ?? "",
        phone: selectedVendor.phone ?? "",
        address: selectedVendor.address ?? "",
      }))
      return
    }
    const vendorContact = selectedVendor.vendorContacts.find(
      (option) => option.id === contactId
    )
    if (!vendorContact) return
    setInput((current) => ({
      ...current,
      vendorContactId: vendorContact.id,
      displayName: vendorContact.name,
      companyName: selectedVendor.displayName,
      email: vendorContact.email ?? "",
      phone: vendorContact.phone ?? "",
      address: selectedVendor.address ?? "",
    }))
  }

  function applyDivision(divisionCode: string): void {
    if (divisionCode === "unassigned") {
      setInput((current) => ({
        ...current,
        csiDivision: "",
        csiDivisionName: "",
        primaryCostCode: "",
      }))
      return
    }
    const division = sageOptions.divisions.find(
      (option) => option.value === divisionCode
    )
    if (!division) return
    setInput((current) => {
      const selectedCostCode = sageOptions.costCodes.find(
        (option) => option.value === current.primaryCostCode
      )
      return {
        ...current,
        csiDivision: division.value,
        csiDivisionName: division.name,
        primaryCostCode:
          selectedCostCode?.divisionCode === division.value
            ? current.primaryCostCode
            : "",
      }
    })
  }

  function applyCostCode(
    option: ProjectContactCostCodeOption | null
  ): void {
    setInput((current) =>
      option
        ? {
            ...current,
            primaryCostCode: option.value,
            csiDivision: option.divisionCode,
            csiDivisionName: option.divisionName,
          }
        : { ...current, primaryCostCode: "" }
    )
  }

  function addCustomerContact(): void {
    const name = newCustomerName.trim()
    if (!name) return
    const email = newCustomerEmail.trim().toLowerCase()
    const company = newCustomerCompany.trim().toLowerCase()
    const existingMatches = customerOptions.filter((option) => {
      const sameEmail =
        email.length > 0 && option.email?.trim().toLowerCase() === email
      const sameNameAndCompany =
        option.displayName.trim().toLowerCase() === name.toLowerCase() &&
        (option.companyName?.trim().toLowerCase() ?? "") === company
      return sameEmail || sameNameAndCompany
    })
    if (existingMatches.length > 1) {
      toast.error(
        "More than one contact matches. Choose the correct existing contact from the list."
      )
      return
    }
    const existing = existingMatches[0]
    if (existing) {
      applyDirectoryOption(existing)
      setShowNewCustomer(false)
      toast.info("That client contact already exists and was selected.")
      return
    }

    startTransition(async () => {
      const result = await createCustomerDirectoryContact({
        name,
        company: newCustomerCompany || null,
        email: newCustomerEmail || null,
        phone: newCustomerPhone || null,
        address: null,
        notes: null,
        relationshipType: newCustomerRelationship,
      })
      if (!result.success || !result.id || !result.customer) {
        toast.error(result.error)
        return
      }
      const customer = result.customer
      const option: ProjectContactDirectoryOption = {
        id: result.id,
        sourceType: "customer",
        displayName: customer.name,
        companyName: customer.company,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        suggestedContactType: "owner",
        identityManagedByActiveUser: false,
        vendorContacts: [],
      }
      setAvailableDirectoryOptions((current) =>
        current.some(
          (existingOption) =>
            existingOption.sourceType === "customer" &&
            existingOption.id === option.id
        )
          ? current
          : [...current, option]
      )
      applyDirectoryOption(option)
      setShowNewCustomer(false)
      setNewCustomerName("")
      setNewCustomerCompany("")
      setNewCustomerEmail("")
      setNewCustomerPhone("")
      setNewCustomerRelationship("client")
      toast.success(
        result.existing
          ? "Existing client/lead contact selected."
          : "Client/lead contact added to Contacts and selected."
      )
    })
  }

  function addVendorCompany(): void {
    const name = newVendorName.trim()
    if (!name) return
    startTransition(async () => {
      const category =
        input.contactType === "supplier" ? "Supplier" : "Subcontractor"
      const result = await createVendor({
        name,
        category,
        email: "",
        phone: "",
        address: "",
        contacts: [],
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const option: ProjectContactDirectoryOption = {
        id: result.id,
        sourceType: "vendor",
        displayName: name,
        companyName: name,
        email: null,
        phone: null,
        address: null,
        suggestedContactType: input.contactType,
        identityManagedByActiveUser: false,
        vendorContacts: [],
      }
      setAvailableDirectoryOptions((current) => [...current, option])
      applyDirectoryOption(option)
      setNewVendorName("")
      setShowNewVendor(false)
      toast.success("Vendor company added.")
    })
  }

  function addVendorPerson(): void {
    if (!selectedVendor || !newVendorContactName.trim()) return
    startTransition(async () => {
      const result = await createVendorContact(selectedVendor.id, {
        id: null,
        name: newVendorContactName,
        title: newVendorContactTitle,
        email: newVendorContactEmail,
        phone: newVendorContactPhone,
        isPrimary: selectedVendor.vendorContacts.length === 0,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setAvailableDirectoryOptions((current) =>
        current.map((option) =>
          option.sourceType === "vendor" && option.id === selectedVendor.id
            ? {
                ...option,
                vendorContacts: [
                  ...option.vendorContacts,
                  {
                    id: result.contact.id,
                    name: result.contact.name,
                    title: result.contact.title,
                    email: result.contact.email,
                    phone: result.contact.phone,
                    isPrimary: result.contact.isPrimary,
                    identityManagedByActiveUser: false,
                  },
                ],
              }
            : option
        )
      )
      setInput((current) => ({
        ...current,
        vendorContactId: result.contact.id,
        displayName: result.contact.name,
        email: result.contact.email ?? "",
        phone: result.contact.phone ?? "",
      }))
      setNewVendorContactName("")
      setNewVendorContactTitle("")
      setNewVendorContactEmail("")
      setNewVendorContactPhone("")
      setShowNewVendorContact(false)
      toast.success("Vendor contact added.")
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveProjectContact(input)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(isEditing ? "Project contact updated." : "Project contact added.")
      if (result.warning) toast.warning(result.warning)
      setOpen(false)
      router.refresh()
    })
  }

  function remove(): void {
    if (!contact) return
    startTransition(async () => {
      const result = await removeProjectContact(projectId, contact.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Contact removed from this project.")
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={resetEditor}>
      <SheetTrigger asChild>
        <Button type="button" size={isEditing ? "icon-sm" : "sm"} variant={isEditing ? "outline" : "default"}>
          {isEditing ? <IconPencil className="size-4" /> : <IconPlus className="size-4" />}
          {!isEditing && "Add contact"}
          {isEditing && <span className="sr-only">Edit {contact.displayName}</span>}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>{isEditing ? "Edit project contact" : "Add project contact"}</SheetTitle>
            <SheetDescription>
              {identityManagedByActiveUser
                ? "This active Compass user manages their own phone, email, and address. Project role and visibility remain editable here."
                : selectedDirectory
                  ? "Phone, email, and address stay synchronized with the linked directory record."
                  : "Add a project contact or link an existing directory record."}
            </SheetDescription>
          </SheetHeader>

          <div className="grid flex-1 gap-5 px-4 py-5 sm:px-6">
            <div className="grid gap-2">
              <Label htmlFor="project-contact-type">Contact type</Label>
              <Select
                value={input.contactType}
                onValueChange={(value) => {
                  if (
                    value !== "owner" &&
                    value !== "supplier" &&
                    value !== "subcontractor" &&
                    value !== "internal"
                  ) {
                    return
                  }
                  const keepVendor =
                    isVendorContactType(input.contactType) &&
                    isVendorContactType(value)
                  setInput((current) => ({
                    ...current,
                    contactType: value,
                    role: defaultProjectRole(value),
                    ...(keepVendor
                      ? {}
                      : {
                          directorySourceType: null,
                          directorySourceId: null,
                          vendorId: null,
                          vendorContactId: null,
                        }),
                  }))
                  setCustomRoleSelected(false)
                }}
              >
                <SelectTrigger id="project-contact-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner / customer</SelectItem>
                  <SelectItem value="supplier">Supplier</SelectItem>
                  <SelectItem value="subcontractor">Subcontractor</SelectItem>
                  <SelectItem value="internal">Internal team</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isVendorContactType(input.contactType) ? (
              <div className="grid gap-4 rounded-lg border p-4">
                <div className="grid gap-2">
                  <Label>Vendor company</Label>
                  <DirectoryPicker
                    key={directoryOpenKey ?? "vendor"}
                    options={vendorOptions}
                    selected={selectedVendor}
                    onSelect={applyDirectoryOption}
                    placeholder="Choose a vendor company..."
                    searchPlaceholder="Search vendor companies..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Choose from all {vendorOptions.length} vendor companies.
                  </p>
                </div>
                {showNewVendor ? (
                  <div className="flex gap-2">
                    <Input
                      value={newVendorName}
                      onChange={(event) => setNewVendorName(event.target.value)}
                      placeholder="New vendor company name"
                      aria-label="New vendor company name"
                    />
                    <Button
                      type="button"
                      onClick={addVendorCompany}
                      disabled={isPending || !newVendorName.trim()}
                    >
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowNewVendor(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    onClick={() => setShowNewVendor(true)}
                  >
                    <IconPlus className="size-4" />
                    Add new vendor
                  </Button>
                )}

                {selectedVendor && (
                  <div className="grid gap-3 border-t pt-4">
                    <div className="grid gap-2">
                      <Label>Contact person</Label>
                      <Select
                        value={
                          input.vendorContactId ??
                          (legacyVendorPerson ? "legacy-person" : "company-only")
                        }
                        onValueChange={applyVendorContact}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a person" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="company-only">
                            No specific person (company assignment only)
                          </SelectItem>
                          {legacyVendorPerson && (
                            <SelectItem value="legacy-person">
                              {legacyVendorPerson} · imported contact
                            </SelectItem>
                          )}
                          {selectedVendor.vendorContacts.map((vendorContact) => (
                            <SelectItem key={vendorContact.id} value={vendorContact.id}>
                              {vendorContact.name}
                              {vendorContact.title ? ` · ${vendorContact.title}` : ""}
                              {vendorContact.email ? ` · ${vendorContact.email}` : ""}
                              {vendorContact.isPrimary ? " · Primary" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Select a person when project access or email invitations are needed.
                        Company-only assignments cannot be invited.
                      </p>
                    </div>
                    {showNewVendorContact ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          required
                          value={newVendorContactName}
                          onChange={(event) =>
                            setNewVendorContactName(event.target.value)
                          }
                          placeholder="Contact name"
                        />
                        <Input
                          value={newVendorContactTitle}
                          onChange={(event) =>
                            setNewVendorContactTitle(event.target.value)
                          }
                          placeholder="Title / position"
                        />
                        <Input
                          type="email"
                          value={newVendorContactEmail}
                          onChange={(event) =>
                            setNewVendorContactEmail(event.target.value)
                          }
                          placeholder="Email"
                        />
                        <Input
                          type="tel"
                          value={newVendorContactPhone}
                          onChange={(event) =>
                            setNewVendorContactPhone(event.target.value)
                          }
                          placeholder="Phone"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            onClick={addVendorPerson}
                            disabled={isPending || !newVendorContactName.trim()}
                          >
                            Add person
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setShowNewVendorContact(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-fit"
                        onClick={() => setShowNewVendorContact(true)}
                      >
                        <IconPlus className="size-4" />
                        Add contact person
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : input.contactType === "owner" ? (
              <div className="grid gap-4 rounded-lg border p-4">
                <div className="grid gap-2">
                  <Label>Client contact</Label>
                  <DirectoryPicker
                    key={directoryOpenKey ?? "customer"}
                    options={customerOptions}
                    selected={selectedDirectory}
                    onSelect={applyDirectoryOption}
                    placeholder="Choose a client or lead contact..."
                    searchPlaceholder="Search client and lead contacts..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Choose from {customerOptions.length} client and lead contacts.
                    Selection does not grant project access.
                  </p>
                </div>
                {showNewCustomer ? (
                  <div className="grid gap-2 border-t pt-4 sm:grid-cols-2">
                    <Input
                      required
                      value={newCustomerName}
                      onChange={(event) => setNewCustomerName(event.target.value)}
                      placeholder="Contact name"
                    />
                    <Input
                      value={newCustomerCompany}
                      onChange={(event) => setNewCustomerCompany(event.target.value)}
                      placeholder="Company / organization"
                    />
                    <Input
                      type="email"
                      value={newCustomerEmail}
                      onChange={(event) => setNewCustomerEmail(event.target.value)}
                      placeholder="Email"
                    />
                    <Input
                      type="tel"
                      value={newCustomerPhone}
                      onChange={(event) => setNewCustomerPhone(event.target.value)}
                      placeholder="Phone"
                    />
                    <Select
                      value={newCustomerRelationship}
                      onValueChange={(value) => {
                        if (value === "client" || value === "lead") {
                          setNewCustomerRelationship(value)
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Client or lead" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="client">Client</SelectItem>
                        <SelectItem value="lead">Lead</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={addCustomerContact}
                        disabled={isPending || !newCustomerName.trim()}
                      >
                        Add client
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setShowNewCustomer(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    onClick={() => setShowNewCustomer(true)}
                  >
                    <IconPlus className="size-4" />
                    Add new client contact
                  </Button>
                )}
              </div>
            ) : (
              !isEditing && (
                <div className="grid gap-2">
                  <Label>Settings team</Label>
                  <DirectoryPicker
                    key={directoryOpenKey ?? "internal"}
                    options={availableDirectoryOptions.filter(
                      (option) => option.sourceType === "team"
                    )}
                    selected={selectedDirectory}
                    onSelect={applyDirectoryOption}
                    placeholder="Choose a Settings team member..."
                    searchPlaceholder="Search Settings team..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Internal contacts come from active Settings team members.
                  </p>
                </div>
              )
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {!isVendorContactType(input.contactType) && (
                <div
                  className={cn(
                    "grid gap-2",
                    input.contactType === "internal" && "sm:col-span-2"
                  )}
                >
                  <Label htmlFor="project-contact-name">Contact name</Label>
                  <Input
                    id="project-contact-name"
                    required
                    value={input.displayName}
                    onChange={(event) => updateInput("displayName", event.target.value)}
                    readOnly={selectedDirectory !== null}
                  />
                </div>
              )}
              {input.contactType === "owner" && (
                <div className="grid gap-2">
                  <Label htmlFor="project-contact-company">Company</Label>
                  <Input
                    id="project-contact-company"
                    value={input.companyName}
                    onChange={(event) => updateInput("companyName", event.target.value)}
                    readOnly={selectedDirectory !== null}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="project-contact-role">Project role</Label>
                <Select
                  value={
                    customRoleSelected
                      ? CUSTOM_PROJECT_ROLE_VALUE
                      : input.role
                  }
                  onValueChange={(value) => {
                    if (value === CUSTOM_PROJECT_ROLE_VALUE) {
                      setCustomRoleSelected(true)
                      if (isPresetProjectRole(input.role)) updateInput("role", "")
                      return
                    }
                    setCustomRoleSelected(false)
                    updateInput("role", value)
                  }}
                >
                  <SelectTrigger id="project-contact-role" className="w-full">
                    <SelectValue placeholder="Choose a project role..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Project team</SelectLabel>
                      {PROJECT_WORKFLOW_ROLE_LENSES.map((role) => (
                        <SelectItem key={role.id} value={role.label}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>External</SelectLabel>
                      {EXTERNAL_PROJECT_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectItem value={CUSTOM_PROJECT_ROLE_VALUE}>
                      Other / custom role...
                    </SelectItem>
                  </SelectContent>
                </Select>
                {customRoleSelected && (
                  <Input
                    id="project-contact-custom-role"
                    value={input.role}
                    onChange={(event) => updateInput("role", event.target.value)}
                    placeholder="Enter the project role..."
                    aria-label="Custom project role"
                  />
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-trade">Trade / scope</Label>
                <Input
                  id="project-contact-trade"
                  value={input.trade}
                  onChange={(event) => updateInput("trade", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-email">Email</Label>
                <Input
                  id="project-contact-email"
                  type="email"
                  value={input.email}
                  onChange={(event) => updateInput("email", event.target.value)}
                  disabled={identityReadOnly}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-phone">Phone</Label>
                <Input
                  id="project-contact-phone"
                  type="tel"
                  value={input.phone}
                  onChange={(event) => updateInput("phone", event.target.value)}
                  disabled={identityReadOnly}
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="project-contact-address">Address</Label>
                <Input
                  id="project-contact-address"
                  value={input.address}
                  onChange={(event) => updateInput("address", event.target.value)}
                  disabled={identityReadOnly}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-csi">Estimating division</Label>
                <Select
                  value={input.csiDivision || "unassigned"}
                  onValueChange={applyDivision}
                >
                  <SelectTrigger id="project-contact-csi" className="w-full">
                    <SelectValue placeholder="Choose a division..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">No division</SelectItem>
                    {sageOptions.divisions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-cost-code">Cost code</Label>
                <CostCodePicker
                  options={filteredCostCodes}
                  value={input.primaryCostCode}
                  onSelect={applyCostCode}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Choosing a cost code automatically sets its division. Choose a
                division first to narrow the cost-code list.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="project-contact-notes">Notes</Label>
              <Textarea
                id="project-contact-notes"
                value={input.notes}
                onChange={(event) => updateInput("notes", event.target.value)}
                rows={4}
              />
            </div>

            <div className="grid gap-3">
              <Label>Visibility and responsibility</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <VisibilityCheckbox
                  id={`project-contact-internal-${contact?.id ?? "new"}`}
                  checked={input.internalVisible}
                  label="Internal visibility"
                  description="Show this contact to authorized staff."
                  onCheckedChange={(checked) => updateInput("internalVisible", checked)}
                />
                <VisibilityCheckbox
                  id={`project-contact-owner-${contact?.id ?? "new"}`}
                  checked={input.ownerPortalVisible}
                  label="Owner workspace"
                  description="Allow owners to see this contact."
                  onCheckedChange={(checked) => updateInput("ownerPortalVisible", checked)}
                />
                <VisibilityCheckbox
                  id={`project-contact-sub-${contact?.id ?? "new"}`}
                  checked={input.subVendorPortalVisible}
                  label="Sub/vendor workspace"
                  description="Allow approved subs and vendors to see this contact."
                  onCheckedChange={(checked) => updateInput("subVendorPortalVisible", checked)}
                />
                <VisibilityCheckbox
                  id={`project-contact-primary-${contact?.id ?? "new"}`}
                  checked={input.primaryContact}
                  label="Primary contact"
                  description="Make this the primary contact for its type."
                  onCheckedChange={(checked) => updateInput("primaryContact", checked)}
                />
              </div>
            </div>
          </div>

          <SheetFooter className="border-t px-4 py-4 sm:px-6">
            {isEditing && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" className="sm:mr-auto">
                    <IconTrash className="size-4" />
                    Remove from project
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {contact.displayName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the contact and any Compass access to this project. It does not delete the customer, vendor, or staff directory record, and imported source history is preserved for review.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isPending}
                      onClick={remove}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Remove contact
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isPending ||
                !input.displayName.trim() ||
                (isVendorContactType(input.contactType) && !input.vendorId)
              }
            >
              {isPending ? "Saving..." : "Save contact"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
