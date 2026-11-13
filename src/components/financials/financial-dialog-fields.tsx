"use client"

import type * as React from "react"

import { ProjectCombobox } from "@/components/projects/project-combobox"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ResponsiveDialogFooter } from "@/components/ui/responsive-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Customer, Project, Vendor } from "@/db/schema"
import type { LineItem } from "@/lib/domain/financials/rules"

import { LineItemsEditor } from "./line-items-editor"

/*
 * The fields the money dialogs share: invoice, vendor bill, credit memo and
 * payment (each *-dialog.tsx in this folder). Each dialog keeps its own state
 * and save; these only draw the inputs so they look and behave the same.
 */

/** A small label over one input. */
function DialogField({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

/** "None" first, for dialogs where the customer or vendor is optional. */
const noneOption = (what: string) => ({ value: "", label: "None", keywords: `clear no ${what}` })

export function CustomerField({
  label,
  customers,
  value,
  onChange,
  optional = false,
}: {
  readonly label: string
  readonly customers: readonly Customer[]
  readonly value: string
  readonly onChange: (customerId: string) => void
  readonly optional?: boolean
}): React.ReactElement {
  const options = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    description: customer.company ?? customer.email ?? undefined,
    keywords: [customer.company, customer.email, customer.phone].filter(Boolean).join(" "),
  }))
  return (
    <DialogField label={label}>
      <SearchableCombobox
        options={optional ? [noneOption("customer"), ...options] : options}
        value={value}
        onValueChange={onChange}
        ariaLabel="Choose customer"
        placeholder="Select customer"
        searchPlaceholder="Search name, company, or email..."
        emptyMessage="No matching customers."
        className="h-9"
      />
    </DialogField>
  )
}

export function VendorField({
  label,
  vendors,
  value,
  onChange,
  optional = false,
}: {
  readonly label: string
  readonly vendors: readonly Vendor[]
  readonly value: string
  readonly onChange: (vendorId: string) => void
  readonly optional?: boolean
}): React.ReactElement {
  const options = vendors.map((vendor) => ({
    value: vendor.id,
    label: vendor.name,
    description: vendor.category,
    keywords: [vendor.category, vendor.email, vendor.phone].filter(Boolean).join(" "),
  }))
  return (
    <DialogField label={label}>
      <SearchableCombobox
        options={optional ? [noneOption("vendor"), ...options] : options}
        value={value}
        onValueChange={onChange}
        ariaLabel="Choose vendor"
        placeholder="Select vendor"
        searchPlaceholder="Search name, category, or email..."
        emptyMessage="No matching vendors."
        className="h-9"
      />
    </DialogField>
  )
}

/** Optional project; "" means no project. */
export function ProjectField({
  projects,
  value,
  onChange,
}: {
  readonly projects: readonly Pick<Project, "id" | "name">[]
  readonly value: string
  readonly onChange: (projectId: string) => void
}): React.ReactElement {
  return (
    <DialogField label="Project">
      <ProjectCombobox
        projects={projects}
        value={value}
        onValueChange={onChange}
        specialOptions={[{ value: "", label: "None", keywords: "clear no project" }]}
        className="h-9"
      />
    </DialogField>
  )
}

export function TextField({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}): React.ReactElement {
  return (
    <DialogField label={label}>
      <Input className="h-9" value={value} onChange={(e) => onChange(e.target.value)} />
    </DialogField>
  )
}

/**
 * A choice from a fixed list. Each choice shows as `labels[choice]` when
 * given, else as the stored value with "_" as a space ("partially paid").
 */
export function ChoiceField({
  label,
  choices,
  labels,
  value,
  onChange,
  placeholder,
  disabledReason,
}: {
  readonly label: string
  readonly choices: readonly string[]
  readonly labels?: Readonly<Record<string, string>>
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  /** Read-only, with this short reason under it (e.g. the value comes from recorded payments). */
  readonly disabledReason?: string
}): React.ReactElement {
  return (
    <DialogField label={label}>
      <Select value={value} onValueChange={onChange} disabled={Boolean(disabledReason)}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {labels?.[choice] ?? choice.replace("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {disabledReason ? <p className="text-xs text-muted-foreground">{disabledReason}</p> : null}
    </DialogField>
  )
}

export function DateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (date: string) => void
  readonly placeholder: string
}): React.ReactElement {
  return (
    <DialogField label={label}>
      <DatePicker value={value} onChange={onChange} placeholder={placeholder} />
    </DialogField>
  )
}

/** A dollar amount; empty reads as 0. */
export function MoneyField({
  label,
  value,
  onChange,
  required = false,
}: {
  readonly label: string
  readonly value: number
  readonly onChange: (value: number) => void
  readonly required?: boolean
}): React.ReactElement {
  return (
    <DialogField label={label}>
      <Input
        type="number"
        className="h-9"
        min={0}
        step="any"
        value={value || ""}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        required={required}
      />
    </DialogField>
  )
}

export function MemoField({
  value,
  onChange,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
}): React.ReactElement {
  return (
    <DialogField label="Memo">
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className="text-sm" />
    </DialogField>
  )
}

/**
 * Marks money as preconstruction (design, plans, engineering under a separate
 * agreement), so it doesn't block replacing the construction contract
 * estimate. `verb` is "billed" for invoices, "received" for payments.
 */
export function PreconstructionField({
  verb,
  checked,
  onChange,
}: {
  readonly verb: "billed" | "received"
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
}): React.ReactElement {
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <span>
        Preconstruction billing
        <span className="block text-xs text-muted-foreground">
          Design, plans or engineering {verb} under a separate agreement. It doesn&apos;t block replacing the construction contract estimate.
        </span>
      </span>
    </label>
  )
}

export function LineItemsField({
  lines,
  onChange,
}: {
  readonly lines: LineItem[]
  readonly onChange: (lines: LineItem[]) => void
}): React.ReactElement {
  return (
    <DialogField label="Line Items">
      <LineItemsEditor value={lines} onChange={onChange} />
    </DialogField>
  )
}

/** Tax input plus the subtotal / tax / total preview (the server recomputes on save). */
export function TaxAndTotalsFields({
  tax,
  onTaxChange,
  subtotal,
  total,
}: {
  readonly tax: number
  readonly onTaxChange: (tax: number) => void
  readonly subtotal: number
  readonly total: number
}): React.ReactElement {
  return (
    <>
      <MoneyField label="Tax" value={tax} onChange={onTaxChange} />
      <div className="space-y-1.5 rounded-md bg-muted/50 p-3">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Subtotal:</span>
          <span className="font-medium">${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Tax:</span>
          <span className="font-medium">${tax.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm font-semibold pt-1 border-t">
          <span>Total:</span>
          <span>${total.toFixed(2)}</span>
        </div>
      </div>
    </>
  )
}

/** Cancel + submit. `submitLabel` is "Save Changes" when editing, "Create ..." when new. */
export function DialogSaveFooter({
  onCancel,
  submitLabel,
}: {
  readonly onCancel: () => void
  readonly submitLabel: string
}): React.ReactElement {
  return (
    <ResponsiveDialogFooter>
      <Button type="button" variant="outline" onClick={onCancel} className="h-9">
        Cancel
      </Button>
      <Button type="submit" className="h-9">
        {submitLabel}
      </Button>
    </ResponsiveDialogFooter>
  )
}
