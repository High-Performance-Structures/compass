"use client"

// The two input types used by the project registry edit form on the Projects
// page: a text field (or a Drive Browse field) and a select field.

import * as React from "react"
import { DriveItemField } from "@/components/google/drive-item-field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function RegistryTextField({
  label,
  name,
  value,
  placeholder,
  drive,
}: {
  readonly label: string
  readonly name: string
  readonly value: string | null
  readonly placeholder?: string
  /** A Drive folder or file id: chosen with Browse instead of typed. */
  readonly drive?: "file" | "folder"
}): React.ReactElement {
  if (drive) {
    return (
      <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        <DriveItemField key={value ?? ""} name={name} defaultValue={value ?? ""} valueAs="id" choose={drive} ariaLabel={label} browseTitle={label} />
      </div>
    )
  }
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Input
        name={name}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="h-9 bg-background text-sm font-normal text-foreground"
      />
    </label>
  )
}

export function RegistrySelectField({
  label,
  name,
  value,
  options,
}: {
  readonly label: string
  readonly name: string
  readonly value: string
  readonly options: readonly {
    readonly value: string
    readonly label: string
  }[]
}): React.ReactElement {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Select name={name} defaultValue={value}>
        <SelectTrigger className="w-full bg-background font-normal text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
