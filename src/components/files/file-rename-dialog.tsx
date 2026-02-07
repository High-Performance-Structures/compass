"use client"

import { useState, useEffect } from "react"
import { IconEdit, IconLoader2 } from "@tabler/icons-react"

import type { FileItem } from "@/lib/files-data"
import { useFiles } from "@/hooks/use-files"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

export function FileRenameDialog({
  open,
  onOpenChange,
  file,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: FileItem | null
}) {
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const {
    renameFile: renameFileFn,
    state,
    dispatch,
  } = useFiles()

  useEffect(() => {
    if (file) setName(file.name)
  }, [file])

  const handleRename = async () => {
    if (!file) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === file.name) return

    setLoading(true)
    try {
      if (state.isConnected === true) {
        const ok = await renameFileFn(file.id, trimmed)
        if (ok) {
          toast.success(`Renamed to "${trimmed}"`)
        } else {
          toast.error("Failed to rename")
        }
      } else {
        dispatch({
          type: "OPTIMISTIC_RENAME",
          payload: { id: file.id, name: trimmed },
        })
        toast.success(`Renamed to "${trimmed}"`)
      }
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconEdit size={18} />
            Rename
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e =>
              e.key === "Enter" && handleRename()
            }
            autoFocus
            disabled={loading}
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRename}
            disabled={
              !name.trim() ||
              name.trim() === file?.name ||
              loading
            }
          >
            {loading && (
              <IconLoader2
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
