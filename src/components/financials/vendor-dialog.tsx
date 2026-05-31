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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Vendor } from "@/db/schema"

interface VendorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: Vendor | null
  categories: readonly string[]
  onSubmit: (data: {
    name: string
    category: string
    email: string
    phone: string
    address: string
  }) => void
}

export function VendorDialog({
  open,
  onOpenChange,
  initialData,
  categories,
  onSubmit,
}: VendorDialogProps) {
  const [name, setName] = React.useState("")
  const [category, setCategory] = React.useState("Subcontractor")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [address, setAddress] = React.useState("")

  React.useEffect(() => {
    if (initialData) {
      setName(initialData.name)
      setCategory(initialData.category)
      setEmail(initialData.email ?? "")
      setPhone(initialData.phone ?? "")
      setAddress(initialData.address ?? "")
    } else {
      setName("")
      setCategory("Subcontractor")
      setEmail("")
      setPhone("")
      setAddress("")
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
                Name *
              </Label>
              <Input
                id="vendor-name"
                className="h-9"
                placeholder="Vendor name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="vendor-category" className="text-xs">
                Category *
              </Label>
              <Select value={category} onValueChange={setCategory}>
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
                Email
              </Label>
              <Input
                id="vendor-email"
                type="email"
                className="h-9"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-phone" className="text-xs">
                Phone
              </Label>
              <Input
                id="vendor-phone"
                className="h-9"
                placeholder="(555) 123-4567"
                value={phone}
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
              onChange={(e) => setAddress(e.target.value)}
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
            {initialData ? "Save Changes" : "Create Vendor"}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </ResponsiveDialog>
  )
}
