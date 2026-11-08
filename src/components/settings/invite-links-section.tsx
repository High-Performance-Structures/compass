"use client"

import * as React from "react"
import { IconCopy, IconTrash, IconPlus } from "@tabler/icons-react"
import type { ColumnDef } from "@tanstack/react-table"
import { toast } from "sonner"

import { getOrgInvites, revokeInvite } from "@/app/actions/invites"
import { useListSheetFilterLabel, useListSheetStartFilter } from "@/components/list-sheets/use-list-sheet"
import { RecordTable, useRecordTable } from "@/components/record-table"
import { StatusFilterBar } from "@/components/status-filter-bar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { userRoleLabel } from "@/lib/user-roles"
import { CreateInviteDialog } from "./create-invite-dialog"

type InviteRow = {
  readonly id: string
  readonly code: string
  readonly role: string
  readonly maxUses: number | null
  readonly useCount: number
  readonly expiresAt: string | null
  readonly isActive: boolean
  readonly createdAt: string
  readonly createdByName: string | null
}

type InviteStatus = "open" | "expired" | "used_up" | "revoked"
type InviteFilter = InviteStatus | "all"

const SHEET_ID = "settings.invite-links"

const INVITE_FILTERS: readonly { readonly value: InviteFilter; readonly label: string; readonly pinned?: boolean }[] = [
  { value: "open", label: "Open", pinned: true },
  { value: "expired", label: "Expired" },
  { value: "used_up", label: "Used up" },
  { value: "revoked", label: "Revoked" },
  { value: "all", label: "All", pinned: true },
]

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt) < new Date()
}

function isExhausted(invite: InviteRow): boolean {
  return invite.maxUses !== null && invite.useCount >= invite.maxUses
}

/** A link is open while it is active, unexpired and has uses left. */
function inviteStatus(invite: InviteRow): InviteStatus {
  if (!invite.isActive) return "revoked"
  if (isExpired(invite.expiresAt)) return "expired"
  if (isExhausted(invite)) return "used_up"
  return "open"
}

function matchesFilter(invite: InviteRow, filter: InviteFilter): boolean {
  return filter === "all" || inviteStatus(invite) === filter
}

function isInviteFilter(value: string): value is InviteFilter {
  return INVITE_FILTERS.some((option) => option.value === value)
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "Never"
  const date = new Date(expiresAt)
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

type InviteActions = {
  readonly onCopy: (code: string) => void
  readonly onRevoke: (inviteId: string) => void
}

/** The invite links sheet's columns ("settings.invite-links" in the list sheet registry). */
export function inviteLinkColumns(actions: InviteActions): ColumnDef<InviteRow>[] {
  // Closed links stay listed but dimmed, as before.
  const dim = (invite: InviteRow): string | undefined => cn(inviteStatus(invite) !== "open" && "opacity-50")
  return [
    {
      id: "code",
      header: "Code",
      accessorFn: (invite) => invite.code,
      cell: ({ row }) => <span className={cn("font-mono text-sm", dim(row.original))}>{row.original.code}</span>,
    },
    {
      id: "role",
      header: "Role",
      accessorFn: (invite) => userRoleLabel(invite.role),
      cell: ({ row }) => (
        <Badge variant="secondary" className={dim(row.original)}>
          {userRoleLabel(row.original.role)}
        </Badge>
      ),
    },
    {
      id: "uses",
      header: "Uses",
      accessorFn: (invite) => invite.useCount,
      cell: ({ row }) => (
        <span className={cn("tabular-nums", dim(row.original))}>
          {row.original.useCount} / {row.original.maxUses ?? "∞"}
        </span>
      ),
    },
    {
      id: "expires",
      header: "Expires",
      accessorFn: (invite) => invite.expiresAt ?? "",
      cell: ({ row }) => (
        <span className={cn("text-sm", dim(row.original))}>
          {isExpired(row.original.expiresAt) ? (
            <span className="text-destructive">Expired</span>
          ) : (
            formatExpiry(row.original.expiresAt)
          )}
        </span>
      ),
    },
    {
      id: "createdBy",
      header: "Created by",
      accessorFn: (invite) => invite.createdByName ?? "Unknown",
      cell: ({ row }) => (
        <span className={cn("text-sm text-muted-foreground", dim(row.original))}>
          {row.original.createdByName ?? "Unknown"}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      size: 100,
      cell: ({ row }) => {
        const invite = row.original
        const open = inviteStatus(invite) === "open"
        return open ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Copy invite link ${invite.code}`}
              onClick={() => actions.onCopy(invite.code)}
            >
              <IconCopy className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive"
              aria-label={`Revoke invite link ${invite.code}`}
              onClick={() => actions.onRevoke(invite.id)}
            >
              <IconTrash className="size-4" />
            </Button>
          </div>
        ) : null
      },
    },
  ]
}

const inviteRowId = (invite: InviteRow): string => invite.id

export function InviteLinksSection(): React.ReactElement {
  const [invites, setInvites] = React.useState<readonly InviteRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createOpen, setCreateOpen] = React.useState(false)
  const startFilter = useListSheetStartFilter(SHEET_ID, "open")
  const [filter, setFilter] = React.useState<InviteFilter>(isInviteFilter(startFilter) ? startFilter : "open")

  const loadInvites = React.useCallback(async (): Promise<void> => {
    try {
      const result = await getOrgInvites()
      if (result.success && result.data) {
        setInvites(result.data)
      }
    } catch (error) {
      console.error("Failed to load invites:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadInvites()
  }, [loadInvites])

  const handleCopyLink = React.useCallback((code: string): void => {
    const url = `${window.location.origin}/join/${code}`
    void navigator.clipboard.writeText(url)
    toast.success("Invite link copied")
  }, [])

  const handleRevoke = React.useCallback(async (inviteId: string): Promise<void> => {
    const result = await revokeInvite(inviteId)
    if (result.success) {
      toast.success("Invite revoked")
      await loadInvites()
    } else {
      toast.error(result.error ?? "Failed to revoke invite")
    }
  }, [loadInvites])

  const columns = React.useMemo(
    () => inviteLinkColumns({ onCopy: handleCopyLink, onRevoke: (id) => void handleRevoke(id) }),
    [handleCopyLink, handleRevoke],
  )
  const visible = React.useMemo(() => invites.filter((invite) => matchesFilter(invite, filter)), [invites, filter])
  const filterLabel = useListSheetFilterLabel("settings.invite-links")
  const table = useRecordTable({
    data: visible,
    columns,
    getRowId: inviteRowId,
    resetKey: filter,
    sheetId: "settings.invite-links",
  })

  if (loading) {
    return (
      <div className="rounded-md border p-8 text-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Invite Links</h3>
          <p className="text-sm text-muted-foreground">
            Shareable links that let anyone join your organization
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <IconPlus className="mr-2 size-4" />
          Create Link
        </Button>
      </div>

      {invites.length === 0 ? (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          No invite links yet
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <StatusFilterBar
            kind="button"
            label="Filter invite links by status"
            selected={filter}
            onSelect={setFilter}
            options={INVITE_FILTERS.map((option) => ({
              ...option,
              label: filterLabel(option.value, option.label),
              count: invites.filter((invite) => matchesFilter(invite, option.value)).length,
            }))}
          />
          <RecordTable
            table={table}
            itemLabel="invite links"
            emptyMessage="No invite links with this status."
            rowIdPrefix="invite-link"
          />
        </div>
      )}

      <CreateInviteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void loadInvites()}
      />
    </div>
  )
}
