"use client"

import * as React from "react"
import { IconDotsVertical } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatDollars } from "@/lib/format"

/**
 * Columns and pieces shared by the invoice, bill, payment and credit memo
 * tables, which have always looked the same.
 */

type Identified = { readonly id: string }

export type BadgeVariant = "secondary" | "default" | "outline" | "destructive"

export function selectColumn<T>(): ColumnDef<T> {
  return {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label="select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        aria-label="select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  }
}

/** A dollar amount column ("$1,234.56"); the financial tables store dollars. */
export function dollarsColumn<T>(
  accessorKey: Extract<keyof T, string>,
  header: string,
  read: (record: T) => number,
): ColumnDef<T> {
  return {
    accessorKey,
    header,
    cell: ({ row }) => formatDollars(read(row.original)),
  }
}

type RecordActionsProps<T extends Identified> = {
  readonly record: T
  readonly onEdit?: (record: T) => void
  readonly onDelete?: (id: string) => void
  readonly buttonClassName: string
  readonly buttonSize?: "icon"
}

/** The Edit / Delete menu on each row. */
function RecordActions<T extends Identified>({
  record,
  onEdit,
  onDelete,
  buttonClassName,
  buttonSize,
}: RecordActionsProps<T>): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={buttonSize} className={buttonClassName}>
          <IconDotsVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEdit?.(record)}>
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => onDelete?.(record.id)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function actionsColumn<T extends Identified>(
  onEdit?: (record: T) => void,
  onDelete?: (id: string) => void,
): ColumnDef<T> {
  return {
    id: "actions",
    cell: ({ row }) => (
      <RecordActions
        record={row.original}
        onEdit={onEdit}
        onDelete={onDelete}
        buttonClassName="size-8 p-0"
      />
    ),
  }
}

/** The mobile row's menu button. */
export function MobileRecordActions<T extends Identified>(props: {
  readonly record: T
  readonly onEdit?: (record: T) => void
  readonly onDelete?: (id: string) => void
}): React.ReactElement {
  return <RecordActions {...props} buttonSize="icon" buttonClassName="size-8 shrink-0" />
}

/** The dashed "nothing yet" box shown on phones. */
export function RecordsEmpty({ title, hint }: { readonly title: string; readonly hint: string }): React.ReactElement {
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-muted-foreground">{title}</p>
      <p className="text-sm text-muted-foreground/70 mt-1">
        {hint}
      </p>
    </div>
  )
}

export const searchInputClass = { mobile: "w-full", desktop: "w-full sm:max-w-sm" } as const
