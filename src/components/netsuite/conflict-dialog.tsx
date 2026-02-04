"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  getConflicts,
  resolveConflict,
} from "@/app/actions/netsuite-sync"
import { toast } from "sonner"

interface Conflict {
  id: string
  localTable: string
  localRecordId: string
  netsuiteInternalId: string | null
  conflictData: string | null
}

export function ConflictDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [conflicts, setConflicts] = React.useState<Conflict[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!open) return

    getConflicts().then(result => {
      if (result.success) {
        setConflicts(result.conflicts as Conflict[])
      }
      setLoading(false)
    })
  }, [open])

  const handleResolve = async (
    metaId: string,
    resolution: "use_local" | "use_remote"
  ) => {
    const result = await resolveConflict(metaId, resolution)
    if (result.success) {
      setConflicts(prev => prev.filter(c => c.id !== metaId))
      toast.success("Conflict resolved")
    } else {
      toast.error(result.error ?? "Failed to resolve conflict")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sync Conflicts</DialogTitle>
          <DialogDescription>
            Records that were modified in both Compass and NetSuite.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-4">
            <div className="bg-muted h-12 animate-pulse rounded" />
            <div className="bg-muted h-12 animate-pulse rounded" />
          </div>
        ) : conflicts.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No conflicts to resolve.
          </p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {conflicts.map(conflict => (
              <div
                key={conflict.id}
                className="border-border space-y-2 rounded border p-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">
                      {conflict.localTable}
                    </span>
                    <Badge variant="destructive" className="ml-2">
                      Conflict
                    </Badge>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    NS#{conflict.netsuiteInternalId}
                  </span>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleResolve(conflict.id, "use_local")
                    }
                  >
                    Keep Local
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleResolve(conflict.id, "use_remote")
                    }
                  >
                    Use NetSuite
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
