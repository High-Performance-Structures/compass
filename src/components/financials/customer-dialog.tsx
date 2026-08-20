"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Customer } from "@/db/schema"
import type { CustomerRelationshipType } from "@/app/actions/customers"
import { useDeveloperMode } from "@/components/developer-mode-provider"

interface CustomerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: Customer | null
  onSubmit: (data: {
    name: string
    company: string
    email: string
    phone: string
    address: string
    notes: string
    relationshipType: CustomerRelationshipType
  }) => void
}

export function CustomerDialog({
  open,
  onOpenChange,
  initialData,
  onSubmit,
}: CustomerDialogProps) {
  const { developerModeEnabled } = useDeveloperMode()
  const [name, setName] = React.useState("")
  const [company, setCompany] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [relationshipType, setRelationshipType] =
    React.useState<CustomerRelationshipType>("client")

  React.useEffect(() => {
    if (initialData) {
      setName(initialData.name)
      setCompany(initialData.company ?? "")
      setEmail(initialData.email ?? "")
      setPhone(initialData.phone ?? "")
      setAddress(initialData.address ?? "")
      setNotes(initialData.notes ?? "")
      setRelationshipType(
        initialData.sageClientId || initialData.sageClientNumber
          ? "client"
          : initialData.relationshipType === "lead"
            ? "lead"
            : "client"
      )
    } else {
      setName("")
      setCompany("")
      setEmail("")
      setPhone("")
      setAddress("")
      setNotes("")
      setRelationshipType("client")
    }
  }, [initialData, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit({
      name: name.trim(),
      company: company.trim(),
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
      notes: notes.trim(),
      relationshipType,
    })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Client / Lead" : "Add Client / Lead Contact"}
      description={
        developerModeEnabled
          ? "Maintain the directory contact without granting project access or creating a Sage client."
          : "Maintain the directory contact without granting project access."
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        <ResponsiveDialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="cust-name" className="text-xs">
              Name *
            </Label>
            <Input
              id="cust-name"
              className="h-9"
              placeholder="Contact name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-relationship" className="text-xs">
              Contact status
            </Label>
            <Select
              value={relationshipType}
              onValueChange={(value) => {
                if (value === "client" || value === "lead") {
                  setRelationshipType(value)
                }
              }}
              disabled={Boolean(
                initialData?.sageClientId || initialData?.sageClientNumber
              )}
            >
              <SelectTrigger id="cust-relationship" className="h-9">
                <SelectValue placeholder="Client or lead" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="lead">Lead</SelectItem>
              </SelectContent>
            </Select>
            {(initialData?.sageClientId || initialData?.sageClientNumber) && (
              <p className="text-xs text-muted-foreground">
                {developerModeEnabled
                  ? "Sage-linked directory records remain clients."
                  : "Linked directory records remain clients."}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-company" className="text-xs">
              Company
            </Label>
            <Input
              id="cust-company"
              className="h-9"
              placeholder="Company or organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cust-email" className="text-xs">
                Email
              </Label>
              <Input
                id="cust-email"
                type="email"
                className="h-9"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-phone" className="text-xs">
                Phone
              </Label>
              <Input
                id="cust-phone"
                className="h-9"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-address" className="text-xs">
              Address
            </Label>
            <Input
              id="cust-address"
              className="h-9"
              placeholder="Street, city, state"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-notes" className="text-xs">
              Notes
            </Label>
            <Textarea
              id="cust-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Additional notes..."
              className="text-sm resize-none"
            />
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
          <Button
            type="submit"
            className="h-9"
          >
            {initialData ? "Save Changes" : "Add to Contacts"}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}
