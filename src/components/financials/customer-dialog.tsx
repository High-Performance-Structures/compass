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
import type { Customer } from "@/db/schema"

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
  }) => void
}

export function CustomerDialog({
  open,
  onOpenChange,
  initialData,
  onSubmit,
}: CustomerDialogProps) {
  const [name, setName] = React.useState("")
  const [company, setCompany] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [notes, setNotes] = React.useState("")

  React.useEffect(() => {
    if (initialData) {
      setName(initialData.name)
      setCompany(initialData.company ?? "")
      setEmail(initialData.email ?? "")
      setPhone(initialData.phone ?? "")
      setAddress(initialData.address ?? "")
      setNotes(initialData.notes ?? "")
    } else {
      setName("")
      setCompany("")
      setEmail("")
      setPhone("")
      setAddress("")
      setNotes("")
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
    })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={initialData ? "Edit Customer" : "Add Customer"}
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-company" className="text-xs">
              Company
            </Label>
            <Input
              id="cust-company"
              className="h-9"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-email" className="text-xs">
              Email
            </Label>
            <Input
              id="cust-email"
              type="email"
              className="h-9"
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-address" className="text-xs">
              Address
            </Label>
            <Textarea
              id="cust-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="text-sm"
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
              className="text-sm"
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
          <Button type="submit" className="h-9">
            {initialData ? "Save Changes" : "Create Customer"}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}
