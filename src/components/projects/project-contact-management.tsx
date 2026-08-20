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
  removeProjectContact,
  saveProjectContact,
  type ProjectContactDirectoryOption,
  type ProjectContactItem,
  type ProjectContactMutationInput,
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
}: {
  readonly options: readonly ProjectContactDirectoryOption[]
  readonly selected: ProjectContactDirectoryOption | null
  readonly onSelect: (option: ProjectContactDirectoryOption) => void
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
            {selected ? selected.displayName : "Choose a contact or enter one manually..."}
          </span>
          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search customers, vendors, or staff..." />
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
}: {
  readonly projectId: string
  readonly contact?: ProjectContactItem | null
  readonly directoryOptions: readonly ProjectContactDirectoryOption[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [directoryOpenKey, setDirectoryOpenKey] = useState<string | null>(null)
  const [availableDirectoryOptions, setAvailableDirectoryOptions] = useState(
    directoryOptions
  )
  const [input, setInput] = useState(() => initialInput(projectId, contact))
  const [showNewVendor, setShowNewVendor] = useState(false)
  const [newVendorName, setNewVendorName] = useState("")
  const [showNewVendorContact, setShowNewVendorContact] = useState(false)
  const [newVendorContactName, setNewVendorContactName] = useState("")
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
  const selectedVendor =
    selectedDirectory?.sourceType === "vendor" ? selectedDirectory : null
  const selectedVendorContact = selectedVendor?.vendorContacts.find(
    (vendorContact) => vendorContact.id === input.vendorContactId
  ) ?? null
  const identityManagedByActiveUser =
    input.directorySourceType === null
      ? (contact?.identityManagedByActiveUser ?? false)
      : (selectedVendorContact?.identityManagedByActiveUser ??
        selectedDirectory?.identityManagedByActiveUser ??
        false)

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
      setShowNewVendor(false)
      setNewVendorName("")
      setShowNewVendorContact(false)
      setNewVendorContactName("")
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
        title: "",
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
                : "Phone, email, and address stay synchronized with the linked company directory record."}
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
                  />
                  <p className="text-xs text-muted-foreground">
                    Choose from all {vendorOptions.length} Sage and Compass vendor companies.
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
                        value={input.vendorContactId ?? "company-only"}
                        onValueChange={applyVendorContact}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a person" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="company-only">
                            Company only (no specific person)
                          </SelectItem>
                          {selectedVendor.vendorContacts.map((vendorContact) => (
                            <SelectItem key={vendorContact.id} value={vendorContact.id}>
                              {vendorContact.name}
                              {vendorContact.title ? ` · ${vendorContact.title}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
            ) : (
              !isEditing && (
                <div className="grid gap-2">
                  <Label>
                    {input.contactType === "owner"
                      ? "Customer directory"
                      : "Settings team"}
                  </Label>
                  <DirectoryPicker
                    key={directoryOpenKey ?? input.contactType}
                    options={availableDirectoryOptions.filter((option) =>
                      input.contactType === "owner"
                        ? option.sourceType === "customer"
                        : option.sourceType === "team"
                    )}
                    selected={selectedDirectory}
                    onSelect={applyDirectoryOption}
                  />
                  <p className="text-xs text-muted-foreground">
                    Select an existing record to prefill the form, or enter one manually.
                  </p>
                </div>
              )
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="project-contact-name">Contact name</Label>
                <Input
                  id="project-contact-name"
                  required
                  value={input.displayName}
                  onChange={(event) => updateInput("displayName", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-company">Company</Label>
                <Input
                  id="project-contact-company"
                  value={input.companyName}
                  onChange={(event) => updateInput("companyName", event.target.value)}
                  readOnly={selectedVendor !== null}
                />
              </div>
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
                  disabled={identityManagedByActiveUser}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-phone">Phone</Label>
                <Input
                  id="project-contact-phone"
                  type="tel"
                  value={input.phone}
                  onChange={(event) => updateInput("phone", event.target.value)}
                  disabled={identityManagedByActiveUser}
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="project-contact-address">Address</Label>
                <Input
                  id="project-contact-address"
                  value={input.address}
                  onChange={(event) => updateInput("address", event.target.value)}
                  disabled={identityManagedByActiveUser}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-cost-code">Primary cost code</Label>
                <Input
                  id="project-contact-cost-code"
                  value={input.primaryCostCode}
                  onChange={(event) => updateInput("primaryCostCode", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-csi">CSI division</Label>
                <Input
                  id="project-contact-csi"
                  value={input.csiDivision}
                  onChange={(event) => updateInput("csiDivision", event.target.value)}
                  placeholder="09"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-csi-name">CSI division name</Label>
                <Input
                  id="project-contact-csi-name"
                  value={input.csiDivisionName}
                  onChange={(event) => updateInput("csiDivisionName", event.target.value)}
                  placeholder="Finishes"
                />
              </div>
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
