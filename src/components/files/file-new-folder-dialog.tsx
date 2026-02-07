"use client"

import { useState } from "react"
import { IconFolderPlus, IconLoader2 } from "@tabler/icons-react"

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

export function FileNewFolderDialog({
  open,
  onOpenChange,
  currentPath,
  parentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentPath: string[]
  parentId: string | null
}) {
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(false)
  const { createFolder, state, dispatch } = useFiles()

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return

    setLoading(true)
    try {
      if (state.isConnected === true) {
        const ok = await createFolder(
          trimmed,
          parentId ?? undefined
        )
        if (ok) {
          toast.success(`Folder "${trimmed}" created`)
        } else {
          toast.error("Failed to create folder")
        }
      } else {
        // mock mode: local dispatch
        dispatch({
          type: "OPTIMISTIC_ADD_FOLDER",
          payload: {
            id: `folder-${Date.now()}`,
            name: trimmed,
            type: "folder",
            size: 0,
            path: currentPath,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            owner: { name: "You" },
            starred: false,
            shared: false,
            trashed: false,
            parentId,
          },
        })
        toast.success(`Folder "${trimmed}" created`)
      }

      setName("")
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
            <IconFolderPlus size={18} />
            New folder
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <Input
            placeholder="Folder name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e =>
              e.key === "Enter" && handleCreate()
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
            onClick={handleCreate}
            disabled={!name.trim() || loading}
          >
            {loading && (
              <IconLoader2
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
