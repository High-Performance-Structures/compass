"use client"

import * as React from "react"
import { IconCopy, IconTrash, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { getOrgInvites, revokeInvite } from "@/app/actions/invites"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt) < new Date()
}

function isExhausted(invite: InviteRow): boolean {
  return invite.maxUses !== null && invite.useCount >= invite.maxUses
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

export function InviteLinksSection() {
  const [invites, setInvites] = React.useState<InviteRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createOpen, setCreateOpen] = React.useState(false)

  const loadInvites = React.useCallback(async () => {
    try {
      const result = await getOrgInvites()
      if (result.success && result.data) {
        setInvites(result.data as InviteRow[])
      }
    } catch (error) {
      console.error("Failed to load invites:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadInvites()
  }, [loadInvites])

  const handleCopyLink = (code: string) => {
    const url = `${window.location.origin}/join/${code}`
    navigator.clipboard.writeText(url)
    toast.success("Invite link copied")
  }

  const handleRevoke = async (inviteId: string) => {
    const result = await revokeInvite(inviteId)
    if (result.success) {
      toast.success("Invite revoked")
      await loadInvites()
    } else {
      toast.error(result.error ?? "Failed to revoke invite")
    }
  }

  const handleCreated = () => {
    loadInvites()
  }

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
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Uses</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => {
                const expired = isExpired(invite.expiresAt)
                const exhausted = isExhausted(invite)
                const dimmed = !invite.isActive || expired || exhausted

                return (
                  <TableRow
                    key={invite.id}
                    className={cn(dimmed && "opacity-50")}
                  >
                    <TableCell className="font-mono text-sm">
                      {invite.code}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {userRoleLabel(invite.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {invite.useCount} / {invite.maxUses ?? "∞"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {expired ? (
                        <span className="text-destructive">Expired</span>
                      ) : (
                        formatExpiry(invite.expiresAt)
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {invite.createdByName ?? "Unknown"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!dimmed && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleCopyLink(invite.code)}
                          >
                            <IconCopy className="size-4" />
                          </Button>
                        )}
                        {invite.isActive && !expired && !exhausted && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive"
                            onClick={() => handleRevoke(invite.id)}
                          >
                            <IconTrash className="size-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateInviteDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  )
}
