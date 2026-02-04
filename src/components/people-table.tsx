"use client"

import * as React from "react"
import {
  IconDotsVertical,
  IconMail,
  IconUserCircle,
} from "@tabler/icons-react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table"

import type { UserWithRelations } from "@/app/actions/users"
import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MobileListCard } from "@/components/mobile-list-card"

interface PeopleTableProps {
  users: UserWithRelations[]
  onEditUser?: (user: UserWithRelations) => void
  onDeactivateUser?: (userId: string) => void
}

export function PeopleTable({
  users,
  onEditUser,
  onDeactivateUser,
}: PeopleTableProps) {
  const isMobile = useIsMobile()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [rowSelection, setRowSelection] = React.useState({})

  const columns: ColumnDef<UserWithRelations>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "displayName",
      header: "Name",
      cell: ({ row }) => {
        const user = row.original
        return (
          <div className="flex items-center gap-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName || "user"}
                className="size-8 rounded-full"
              />
            ) : (
              <IconUserCircle className="size-8 text-muted-foreground" />
            )}
            <div className="flex flex-col">
              <span className="font-medium">
                {user.displayName || user.email.split("@")[0]}
              </span>
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <IconMail className="size-3" />
                {user.email}
              </span>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => {
        const role = row.getValue("role") as string
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)
        return (
          <Badge
            variant={
              role === "admin"
                ? "default"
                : role === "office"
                  ? "secondary"
                  : "outline"
            }
          >
            {roleLabel}
          </Badge>
        )
      },
    },
    {
      id: "teams",
      header: "Teams",
      cell: ({ row }) => {
        const teams = row.original.teams
        if (teams.length === 0) return <span className="text-muted-foreground">-</span>
        if (teams.length === 1)
          return <Badge variant="outline">{teams[0].name}</Badge>
        return (
          <div className="flex items-center gap-1">
            <Badge variant="outline">{teams[0].name}</Badge>
            {teams.length > 1 && (
              <Badge variant="secondary">+{teams.length - 1}</Badge>
            )}
          </div>
        )
      },
    },
    {
      id: "groups",
      header: "Groups",
      cell: ({ row }) => {
        const groups = row.original.groups
        if (groups.length === 0) return <span className="text-muted-foreground">-</span>
        if (groups.length === 1)
          return <Badge variant="outline">{groups[0].name}</Badge>
        return (
          <div className="flex items-center gap-1">
            <Badge variant="outline">{groups[0].name}</Badge>
            {groups.length > 1 && (
              <Badge variant="secondary">+{groups.length - 1}</Badge>
            )}
          </div>
        )
      },
    },
    {
      id: "projects",
      header: "Projects",
      cell: ({ row }) => {
        const count = row.original.projectCount
        if (count === 0) return <span className="text-muted-foreground">-</span>
        return <span className="text-sm">{count}</span>
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const user = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="size-8 p-0">
                <span className="sr-only">open menu</span>
                <IconDotsVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEditUser?.(user)}>
                Edit User
              </DropdownMenuItem>
              <DropdownMenuItem>Assign to Project</DropdownMenuItem>
              <DropdownMenuItem>Assign to Team</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDeactivateUser?.(user.id)}
              >
                Deactivate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const table = useReactTable({
    data: users,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Search by name or email..."
          value={
            (table.getColumn("displayName")?.getFilterValue() as string) ?? ""
          }
          onChange={(event) =>
            table.getColumn("displayName")?.setFilterValue(event.target.value)
          }
          className="w-full sm:max-w-sm"
        />
        <div className="flex items-center gap-2">
          <Select
            value={
              (table.getColumn("role")?.getFilterValue() as string) ?? "all"
            }
            onValueChange={(value) =>
              table
                .getColumn("role")
                ?.setFilterValue(value === "all" ? "" : value)
            }
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="office">Office</SelectItem>
              <SelectItem value="field">Field</SelectItem>
              <SelectItem value="client">Client</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isMobile ? (
        <div className="rounded-md border overflow-hidden divide-y">
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => {
              const user = row.original
              const roleLabel = user.role.charAt(0).toUpperCase() + user.role.slice(1)
              const teamNames = user.teams.map((t) => t.name).join(", ")
              return (
                <MobileListCard
                  key={row.id}
                  avatar={
                    user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.displayName || "user"}
                        className="size-10 rounded-full"
                      />
                    ) : (
                      <IconUserCircle className="size-10 text-muted-foreground" />
                    )
                  }
                  title={user.displayName || user.email.split("@")[0]}
                  subtitle={user.email}
                  metadata={[
                    roleLabel,
                    ...(teamNames ? [teamNames] : []),
                    ...(user.projectCount > 0 ? [`${user.projectCount} projects`] : []),
                  ]}
                  actions={[
                    { label: "Edit User", onClick: () => onEditUser?.(user) },
                    { label: "Assign to Project", onClick: () => {} },
                    { label: "Assign to Team", onClick: () => {} },
                    {
                      label: "Deactivate",
                      onClick: () => onDeactivateUser?.(user.id),
                      destructive: true,
                    },
                  ]}
                />
              )
            })
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No users found
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-md border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className="whitespace-nowrap">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows?.length ? (
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="whitespace-nowrap">
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={columns.length}
                        className="h-24 text-center"
                      >
                        No users found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {table.getFilteredSelectedRowModel().rows.length} of{" "}
              {table.getFilteredRowModel().rows.length} row(s) selected
            </div>
            <div className="flex items-center justify-center sm:justify-end space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
