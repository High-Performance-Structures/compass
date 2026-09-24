"use client"

import * as React from "react"
import { IconPlus, IconTrash } from "@tabler/icons-react"
import type {
  VendorCompanyMutationInput,
  VendorDirectoryCompany,
} from "@/app/actions/vendors"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ContactDraft = {
  readonly key: string
  readonly id: string | null
  readonly name: string
  readonly title: string
  readonly email: string
  readonly phone: string
  readonly isPrimary: boolean
}

interface VendorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: VendorDirectoryCompany | null
  categories: readonly string[]
  onSubmit: (data: VendorCompanyMutationInput) => void
  onSageEditContact?: (contactId: string, name: string) => void
  onSageLinkContact?: (contactId: string, name: string, lineNumber: number | null) => void
  onSageCreateContact?: () => void
  onSageEditCompany?: () => void
  onSageLinkCompany?: () => void
  onLinkAccount?: (contactId: string, name: string, userId: string | null) => void
  readOnly?: boolean
}

export function VendorDialog({
  open,
  onOpenChange,
  initialData,
  categories,
  onSubmit,
  onSageEditContact,
  onSageLinkContact,
  onSageCreateContact,
  onSageEditCompany,
  onSageLinkCompany,
  onLinkAccount,
  readOnly = false,
}: VendorDialogProps) {
  const [name, setName] = React.useState("")
  const [category, setCategory] = React.useState("Subcontractor")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [contacts, setContacts] = React.useState<readonly ContactDraft[]>([])
  const sageLinked = Boolean(initialData?.sageVendorId || initialData?.sageVendorNumber)
  const sageVerified = Boolean(initialData?.sageVendorId)
  const locked = sageLinked || readOnly

  React.useEffect(() => {
    if (initialData) {
      setName(initialData.name)
      setCategory(initialData.category)
      setEmail(initialData.email ?? "")
      setPhone(initialData.phone ?? "")
      setAddress(initialData.address ?? "")
      setContacts(
        initialData.contacts.map((contact) => ({
          key: contact.id,
          id: contact.id,
          name: contact.name,
          title: contact.title ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          isPrimary: contact.isPrimary,
        }))
      )
    } else {
      setName("")
      setCategory("Subcontractor")
      setEmail("")
      setPhone("")
      setAddress("")
      setContacts([])
    }
  }, [initialData, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      category,
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        title: contact.title,
        email: contact.email,
        phone: contact.phone,
        isPrimary: contact.isPrimary,
      })),
    })
  }

  function addContact(): void {
    setContacts((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        id: null,
        name: "",
        title: "",
        email: "",
        phone: "",
        isPrimary: current.length === 0,
      },
    ])
  }

  function updateContact(
    key: string,
    field: "name" | "title" | "email" | "phone",
    value: string
  ): void {
    setContacts((current) =>
      current.map((contact) =>
        contact.key === key ? { ...contact, [field]: value } : contact
      )
    )
  }

  function makePrimary(key: string): void {
    setContacts((current) =>
      current.map((contact) => ({
        ...contact,
        isPrimary: contact.key === key,
      }))
    )
  }

  function removeContact(key: string): void {
    setContacts((current) => {
      const removed = current.find((contact) => contact.key === key)
      const remaining = current.filter((contact) => contact.key !== key)
      if (!removed?.isPrimary || remaining.length === 0) return remaining
      return remaining.map((contact, index) => ({
        ...contact,
        isPrimary: index === 0,
      }))
    })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Vendor" : "Add Vendor"}
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody>
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-3 space-y-1.5">
              <Label htmlFor="vendor-name" className="text-xs">
                Company name *
              </Label>
              <Input
                id="vendor-name"
                className="h-9"
                placeholder="Vendor company name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                disabled={locked}
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="vendor-category" className="text-xs">
                Category *
              </Label>
              <Select value={category} onValueChange={setCategory} disabled={locked}>
                <SelectTrigger
                  id="vendor-category"
                  className="h-9"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((categoryOption) => (
                    <SelectItem key={categoryOption} value={categoryOption}>
                      {categoryOption}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-email" className="text-xs">
                Company email
              </Label>
              <Input
                id="vendor-email"
                type="email"
                className="h-9"
                placeholder="email@example.com"
                value={email}
                disabled={locked}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-phone" className="text-xs">
                Company phone
              </Label>
              <Input
                id="vendor-phone"
                className="h-9"
                placeholder="(555) 123-4567"
                value={phone}
                disabled={locked}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendor-address" className="text-xs">
              Address
            </Label>
            <Input
              id="vendor-address"
              className="h-9"
              placeholder="Street, city, state"
              value={address}
              disabled={locked}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>People at this company</Label>
                <p className="text-xs text-muted-foreground">
                  Add multiple contacts, each with their own email and phone.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addContact} disabled={locked}>
                <IconPlus className="size-4" />
                Add person
              </Button>
              {sageVerified && onSageCreateContact ? (
                <Button type="button" variant="outline" size="sm" onClick={onSageCreateContact}>Propose Sage person</Button>
              ) : null}
            </div>
            {contacts.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No contact people have been added.
              </p>
            ) : (
              <div className="grid gap-3">
                {contacts.map((contact, index) => (
                  <div key={contact.key} className="grid gap-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Contact {index + 1}</p>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={contact.isPrimary ? "secondary" : "ghost"}
                          onClick={() => makePrimary(contact.key)}
                          disabled={locked}
                        >
                          {contact.isPrimary ? "Primary" : "Make primary"}
                        </Button>
                        {contact.id && initialData?.contacts.some((saved) => saved.id === contact.id && saved.sageContactId) && onSageEditContact ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => onSageEditContact(contact.id ?? "", contact.name)}>
                            Propose Sage edit
                          </Button>
                        ) : null}
                        {contact.id && sageVerified && !initialData?.contacts.some((saved) => saved.id === contact.id && saved.sageContactId) && onSageLinkContact ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => onSageLinkContact(contact.id ?? "", contact.name, initialData?.contacts.find((saved) => saved.id === contact.id)?.sageLineNumber ?? null)}>
                            Verify Sage link
                          </Button>
                        ) : null}
                        {contact.id && onLinkAccount ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => onLinkAccount(contact.id ?? "", contact.name, initialData?.contacts.find((saved) => saved.id === contact.id)?.userId ?? null)}>
                            Compass account
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeContact(contact.key)}
                          aria-label={`Remove contact ${index + 1}`}
                          disabled={locked}
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        required
                        disabled={locked}
                        value={contact.name}
                        onChange={(event) =>
                          updateContact(contact.key, "name", event.target.value)
                        }
                        placeholder="Contact name"
                      />
                      <Input
                        value={contact.title}
                        disabled={locked}
                        onChange={(event) =>
                          updateContact(contact.key, "title", event.target.value)
                        }
                        placeholder="Title"
                      />
                      <Input
                        type="email"
                        value={contact.email}
                        disabled={locked}
                        onChange={(event) =>
                          updateContact(contact.key, "email", event.target.value)
                        }
                        placeholder="Email"
                      />
                      <Input
                        type="tel"
                        value={contact.phone}
                        disabled={locked}
                        onChange={(event) =>
                          updateContact(contact.key, "phone", event.target.value)
                        }
                        placeholder="Phone"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-9"
          >
            Cancel
          </Button>
          {initialData && !sageVerified && onSageLinkCompany ? (
            <Button type="button" variant="outline" onClick={onSageLinkCompany}>Verify Sage link</Button>
          ) : null}
          {sageLinked && !readOnly ? (
            sageVerified ? (
              <Button type="button" onClick={onSageEditCompany} disabled={!onSageEditCompany}>
                Propose Sage company edit
              </Button>
            ) : null
          ) : !readOnly ? (
            <Button type="submit" className="h-9">
              {initialData ? "Save Changes" : "Create Vendor"}
            </Button>
          ) : null}
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}
