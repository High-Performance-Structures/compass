"use client"

import { useState, useEffect } from "react"
import {
  IconFolder,
  IconFolderSymlink,
  IconLoader2,
} from "@tabler/icons-react"

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
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type FolderEntry = { id: string; name: string }

export function FileMoveDialog({
  open,
  onOpenChange,
  file,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: FileItem | null
}) {
  const {
    moveFile: moveFileFn,
    fetchFolders,
    getFolders,
    state,
    dispatch,
  } = useFiles()

  const [selectedFolderId, setSelectedFolderId] = useState<
    string | null
  >(null)
  const [loading, setLoading] = useState(false)
  const [movePending, setMovePending] = useState(false)
  const [driveFolders, setDriveFolders] = useState<
    FolderEntry[]
  >([])

  // fetch folders when dialog opens
  useEffect(() => {
    if (!open) return

    if (state.isConnected === true) {
      setLoading(true)
      fetchFolders().then(folders => {
        if (folders) {
          setDriveFolders(
            folders.filter(f => f.id !== file?.id)
          )
        }
        setLoading(false)
      })
    }
  }, [open, state.isConnected, fetchFolders, file?.id])

  const mockFolders = getFolders().filter(
    f => f.id !== file?.id
  )

  const handleMove = async () => {
    if (!file) return

    setMovePending(true)
    try {
      if (state.isConnected === true) {
        if (!selectedFolderId) {
          toast.error("Select a destination folder")
          return
        }
        const oldParentId = file.parentId ?? "root"
        const ok = await moveFileFn(
          file.id,
          selectedFolderId,
          oldParentId
        )
        if (ok) {
          const dest = driveFolders.find(
            f => f.id === selectedFolderId
          )
          toast.success(
            `Moved "${file.name}" to ${dest?.name ?? "folder"}`
          )
        } else {
          toast.error("Failed to move file")
        }
      } else {
        // mock mode
        const targetFolder = mockFolders.find(
          f => f.id === selectedFolderId
        )
        const targetPath = targetFolder
          ? [...targetFolder.path, targetFolder.name]
          : []

        dispatch({
          type: "REMOVE_FILE",
          payload: file.id,
        })
        toast.success(
          `Moved "${file.name}" to ${targetFolder?.name ?? "My Files"}`
        )
      }
      onOpenChange(false)
    } finally {
      setMovePending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconFolderSymlink size={18} />
            Move to
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
            {state.isConnected === true ? (
              <>
                {driveFolders.map(folder => (
                  <button
                    key={folder.id}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                      selectedFolderId === folder.id &&
                        "bg-accent"
                    )}
                    onClick={() =>
                      setSelectedFolderId(folder.id)
                    }
                  >
                    <IconFolder
                      size={16}
                      className="text-amber-500"
                    />
                    {folder.name}
                  </button>
                ))}
                {driveFolders.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No folders found
                  </p>
                )}
              </>
            ) : (
              <>
                <button
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                    selectedFolderId === null && "bg-accent"
                  )}
                  onClick={() => setSelectedFolderId(null)}
                >
                  <IconFolder
                    size={16}
                    className="text-amber-500"
                  />
                  My Files (root)
                </button>
                {mockFolders.map(folder => (
                  <button
                    key={folder.id}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent",
                      selectedFolderId === folder.id &&
                        "bg-accent"
                    )}
                    style={{
                      paddingLeft: `${(folder.path.length + 1) * 12 + 12}px`,
                    }}
                    onClick={() =>
                      setSelectedFolderId(folder.id)
                    }
                  >
                    <IconFolder
                      size={16}
                      className="text-amber-500"
                    />
                    {folder.name}
                  </button>
                ))}
              </>
            )}
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={movePending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleMove}
            disabled={movePending}
          >
            {movePending && (
              <IconLoader2
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
