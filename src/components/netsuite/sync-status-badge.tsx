"use client"

import { Badge } from "@/components/ui/badge"
import type { SyncStatus } from "@/lib/netsuite/client/types"

const STATUS_CONFIG: Record<
  SyncStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  synced: { label: "Synced", variant: "default" },
  pending_push: { label: "Pending", variant: "secondary" },
  conflict: { label: "Conflict", variant: "destructive" },
  error: { label: "Error", variant: "destructive" },
}

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const config = STATUS_CONFIG[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
