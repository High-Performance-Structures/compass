"use client"

import {
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconFolderSymlink,
  IconShare,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconTrashOff,
} from "@tabler/icons-react"

import type { FileItem } from "@/lib/files-data"
import { useFiles } from "@/hooks/use-files"
import { isGoogleNativeFile } from "@/lib/google/mapper"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { toast } from "sonner"

export function FileContextMenu({
  file,
  children,
  onRename,
  onMove,
}: {
  file: FileItem
  children: React.ReactNode
  onRename: (file: FileItem) => void
  onMove: (file: FileItem) => void
}) {
  const {
    starFile,
    trashFile,
    restoreFile,
    state,
    dispatch,
  } = useFiles()

  const handleStar = async () => {
    if (state.isConnected === true) {
      await starFile(file.id)
    } else {
      dispatch({ type: "OPTIMISTIC_STAR", payload: file.id })
    }
  }

  const handleTrash = async () => {
    if (state.isConnected === true) {
      const ok = await trashFile(file.id)
      if (ok) {
        toast.success(`"${file.name}" moved to trash`)
      } else {
        toast.error("Failed to delete file")
      }
    } else {
      dispatch({
        type: "OPTIMISTIC_TRASH",
        payload: file.id,
      })
      toast.success(`"${file.name}" moved to trash`)
    }
  }

  const handleRestore = async () => {
    if (state.isConnected === true) {
      const ok = await restoreFile(file.id)
      if (ok) {
        toast.success(`"${file.name}" restored`)
      } else {
        toast.error("Failed to restore file")
      }
    } else {
      dispatch({
        type: "OPTIMISTIC_RESTORE",
        payload: file.id,
      })
      toast.success(`"${file.name}" restored`)
    }
  }

  const handleDownload = () => {
    if (state.isConnected === true) {
      window.open(
        `/api/google/download/${file.id}`,
        "_blank"
      )
    } else {
      toast.success("Download started")
    }
  }

  const handleOpenInDrive = () => {
    if (file.webViewLink) {
      window.open(file.webViewLink, "_blank")
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {file.type === "folder" && (
          <ContextMenuItem
            onClick={() =>
              toast.info("Opening folder...")
            }
          >
            <IconFolderSymlink
              size={16}
              className="mr-2"
            />
            Open
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() =>
            toast.info("Share dialog coming soon")
          }
        >
          <IconShare size={16} className="mr-2" />
          Share
        </ContextMenuItem>
        {!file.trashed && (
          <>
            {file.webViewLink &&
              file.mimeType &&
              isGoogleNativeFile(file.mimeType) && (
                <ContextMenuItem
                  onClick={handleOpenInDrive}
                >
                  <IconExternalLink
                    size={16}
                    className="mr-2"
                  />
                  Open in Google Drive
                </ContextMenuItem>
              )}
            {file.type !== "folder" && (
              <ContextMenuItem onClick={handleDownload}>
                <IconDownload
                  size={16}
                  className="mr-2"
                />
                Download
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onRename(file)}>
              <IconEdit size={16} className="mr-2" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onMove(file)}>
              <IconFolderSymlink
                size={16}
                className="mr-2"
              />
              Move to
            </ContextMenuItem>
            <ContextMenuItem onClick={handleStar}>
              {file.starred ? (
                <>
                  <IconStarFilled
                    size={16}
                    className="mr-2 text-amber-400"
                  />
                  Unstar
                </>
              ) : (
                <>
                  <IconStar size={16} className="mr-2" />
                  Star
                </>
              )}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive"
              onClick={handleTrash}
            >
              <IconTrash size={16} className="mr-2" />
              Delete
            </ContextMenuItem>
          </>
        )}
        {file.trashed && (
          <ContextMenuItem onClick={handleRestore}>
            <IconTrashOff size={16} className="mr-2" />
            Restore
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
