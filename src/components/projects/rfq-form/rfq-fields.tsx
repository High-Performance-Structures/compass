"use client"

import type * as React from "react"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** A small muted label over one RFQ form input. */
export function RfqField({
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

/** The RFQ's priority: normal, high, critical or low. */
export function RfqPrioritySelect({
  priority,
  onPriorityChange,
}: {
  readonly priority: string
  readonly onPriorityChange: (priority: string) => void
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        Priority
      </Label>
      <Select value={priority} onValueChange={onPriorityChange}>
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
  )
}
