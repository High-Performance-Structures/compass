"use client"

import * as React from "react"
import { IconDotsVertical, IconMail, IconUserCircle } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"

import type { UserWithRelations } from "@/app/actions/users"
import { useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { RecordSearchInput, RecordTable, recordSelectionColumn, useRecordTable } from "@/components/record-table"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { USER_ROLE_OPTIONS, userRoleLabel } from "@/lib/user-roles"

type PeopleTableProps = {
  readonly users: readonly UserWithRelations[]
  readonly onEditUser?: (user: UserWithRelations) => void
  readonly onDeactivateUser?: (userId: string) => void
  readonly onReinviteUser?: (user: UserWithRelations) => void
  readonly onSelectionChange?: (userIds: readonly string[]) => void
}

type PeopleRowActions = Pick<PeopleTableProps, "onEditUser" | "onDeactivateUser" | "onReinviteUser">

type AccessFilter = "all" | "active" | "invited"

const ACCESS_FILTERS: readonly { readonly value: AccessFilter; readonly label: string; readonly pinned?: boolean }[] = [
  { value: "all", label: "All", pinned: true },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invitation pending" },
]

const SHEET_ID = "settings.people"

function displayName(user: UserWithRelations): string {
  return user.displayName || user.email.split("@")[0] || user.email
}

function NamedBadges({ items }: { readonly items: readonly { readonly name: string }[] }): React.ReactElement {
  const [first] = items
  if (!first) return <span className="text-muted-foreground">-</span>
  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline">{first.name}</Badge>
      {items.length > 1 && <Badge variant="secondary">+{items.length - 1}</Badge>}
    </div>
  )
}

function PersonMenu({ user, actions }: { readonly user: UserWithRelations; readonly actions: PeopleRowActions }): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="size-8 p-0">
          <span className="sr-only">open menu</span>
          <IconDotsVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {user.accessStatus === "invited" ? (
          <DropdownMenuItem onClick={() => actions.onReinviteUser?.(user)}>
            Send invitation again
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => actions.onEditUser?.(user)}>
              Edit User
            </DropdownMenuItem>
            <DropdownMenuItem>Assign to Project</DropdownMenuItem>
            <DropdownMenuItem>Assign to Team</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => actions.onDeactivateUser?.(user.id)}
            >
              Deactivate
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The team members sheet's columns ("settings.people" in the list sheet registry). */
export function peopleColumns(actions: PeopleRowActions): ColumnDef<UserWithRelations>[] {
  return [
    recordSelectionColumn((user: UserWithRelations) => displayName(user)),
    {
      id: "name",
      header: "Name",
      accessorFn: (user) => displayName(user),
      cell: ({ row }) => {
        const user = row.original
        const canOpen = Boolean(actions.onEditUser) && user.accessStatus !== "invited"
        return (
          <div className="flex items-center gap-3">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.displayName || "user"} className="size-8 rounded-full" />
            ) : (
              <IconUserCircle className="size-8 text-muted-foreground" />
            )}
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                {canOpen ? (
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => actions.onEditUser?.(user)}>
                    {displayName(user)}
                  </button>
                ) : (
                  <span className="font-medium">{displayName(user)}</span>
                )}
                {user.accessStatus === "invited" && <Badge variant="secondary">Invitation pending</Badge>}
              </div>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <IconMail className="size-3" />
                {user.email}
              </span>
            </div>
          </div>
        )
      },
    },
    {
      id: "role",
      header: "Role",
      accessorFn: (user) => userRoleLabel(user.role),
      cell: ({ row }) => {
        const role = row.original.role
        return (
          <Badge variant={role === "admin" ? "default" : role === "office" ? "secondary" : "outline"}>
            {userRoleLabel(role)}
          </Badge>
        )
      },
    },
    {
      id: "teams",
      header: "Teams",
      accessorFn: (user) => user.teams[0]?.name ?? "",
      cell: ({ row }) => <NamedBadges items={row.original.teams} />,
    },
    {
      id: "groups",
      header: "Groups",
      accessorFn: (user) => user.groups[0]?.name ?? "",
      cell: ({ row }) => <NamedBadges items={row.original.groups} />,
    },
    {
      id: "projects",
      header: "Projects",
      accessorFn: (user) => user.projectCount,
      cell: ({ row }) =>
        row.original.projectCount === 0 ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <span className="text-sm">{row.original.projectCount}</span>
        ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      size: 48,
      cell: ({ row }) => <PersonMenu user={row.original} actions={actions} />,
    },
  ]
}

function matchesSearch(user: UserWithRelations, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (user.displayName ?? "").toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)
}

function matchesAccess(user: UserWithRelations, filter: AccessFilter): boolean {
  return filter === "all" || user.accessStatus === filter
}

function isAccessFilter(value: string): value is AccessFilter {
  return ACCESS_FILTERS.some((option) => option.value === value)
}

const userRowId = (user: UserWithRelations): string => user.id

/** Team members (Settings › Team): searched, filtered by role and access, sorted by any column. */
export function PeopleTable({
  users,
  onEditUser,
  onDeactivateUser,
  onReinviteUser,
  onSelectionChange,
}: PeopleTableProps): React.ReactElement {
  const startFilter = useListSheetStartFilter(SHEET_ID, "all")
  const [access, setAccess] = React.useState<AccessFilter>(isAccessFilter(startFilter) ? startFilter : "all")
  const [search, setSearch] = React.useState("")
  const [role, setRole] = React.useState("")

  const columns = React.useMemo(
    () => peopleColumns({ onEditUser, onDeactivateUser, onReinviteUser }),
    [onEditUser, onDeactivateUser, onReinviteUser],
  )
  const searched = React.useMemo(
    () => users.filter((user) => matchesSearch(user, search) && (role === "" || user.role === role)),
    [users, search, role],
  )
  const visible = React.useMemo(() => searched.filter((user) => matchesAccess(user, access)), [searched, access])
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: userRowId,
    resetKey: `${access}|${role}|${search}`,
    enableSelection: true,
    sheetId: "settings.people",
  })

  const rowSelection = table.getState().rowSelection
  React.useEffect(() => {
    onSelectionChange?.(Object.keys(rowSelection).filter((id) => rowSelection[id]))
  }, [rowSelection, onSelectionChange])

  const openUser = onEditUser
    ? (user: UserWithRelations): void => {
        if (user.accessStatus !== "invited") onEditUser(user)
      }
    : undefined

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <StatusFilterBar
          kind="button"
          label="Filter users by Compass access"
          selected={access}
          onSelect={setAccess}
          options={ACCESS_FILTERS.map((option) => ({
            ...option,
            count: searched.filter((user) => matchesAccess(user, option.value)).length,
          }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <RecordSearchInput
            value={search}
            onChange={setSearch}
            label="Search users"
            placeholder="Search by name or email..."
            className="sm:w-72"
          />
          <SearchableCombobox
            className="h-9 w-full sm:w-[180px]"
            value={role || "all"}
            onValueChange={(value) => setRole(value === "all" ? "" : value)}
            options={[
              { value: "all", label: "All Roles" },
              ...USER_ROLE_OPTIONS.filter((option) => users.some((user) => user.role === option.value)),
            ]}
            ariaLabel="Filter by role"
            placeholder="Filter by role"
            searchPlaceholder="Search roles..."
            emptyMessage="No matching roles."
          />
        </div>
      </div>
      <RecordTable
        table={table}
        itemLabel="users"
        emptyMessage="No users found"
        rowIdPrefix="person"
        onRowOpen={openUser}
      />
    </div>
  )
}
