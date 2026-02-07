"use client"

import { useState, useEffect } from "react"
import {
  IconFolder,
  IconLoader2,
  IconFolderShare,
} from "@tabler/icons-react"

import {
  listAvailableSharedDrives,
  selectSharedDrive,
} from "@/app/actions/google-drive"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export function SharedDrivePicker({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [drives, setDrives] = useState<
    ReadonlyArray<{ id: string; name: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<
    string | null
  >(null)

  useEffect(() => {
    if (!open) return

    setLoading(true)
    listAvailableSharedDrives().then(result => {
      if (result.success) {
        setDrives(result.drives)
      } else {
        toast.error(result.error)
      }
      setLoading(false)
    })
  }, [open])

  const handleSelect = async () => {
    setSaving(true)
    const driveName =
      selectedId === null
        ? null
        : drives.find(d => d.id === selectedId)?.name ??
          null

    const result = await selectSharedDrive(
      selectedId,
      driveName
    )
    if (result.success) {
      toast.success(
        selectedId
          ? `Using shared drive "${driveName}"`
          : "Using root drive"
      )
      onOpenChange(false)
    } else {
      toast.error(result.error)
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconFolderShare size={18} />
            Select Shared Drive
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <IconLoader2
              size={24}
              className="animate-spin text-muted-foreground"
            />
          </div>
        ) : (
          <ScrollArea className="h-64 rounded-md border p-2">
            <button
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                selectedId === null && "bg-accent"
              )}
              onClick={() => setSelectedId(null)}
            >
              <IconFolder
                size={16}
                className="text-amber-500"
              />
              My Drive (root)
            </button>
            {drives.map(drive => (
              <button
                key={drive.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                  selectedId === drive.id && "bg-accent"
                )}
                onClick={() => setSelectedId(drive.id)}
              >
                <IconFolderShare
                  size={16}
                  className="text-blue-500"
                />
                {drive.name}
              </button>
            ))}
            {drives.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No shared drives found.
              </p>
            )}
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={loading || saving}
          >
            {saving && (
              <IconLoader2
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
