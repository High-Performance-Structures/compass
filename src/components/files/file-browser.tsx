"use client"

import { useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"

import type { FileItem } from "@/lib/files-data"
import { useFiles, type FileView } from "@/hooks/use-files"
import { useFileSelection } from "@/hooks/use-file-selection"
import { FileBreadcrumb } from "./file-breadcrumb"
import { FileToolbar, type NewFileType } from "./file-toolbar"
import { FileGrid } from "./file-grid"
import { FileList } from "./file-list"
import { FileUploadDialog } from "./file-upload-dialog"
import { FileNewFolderDialog } from "./file-new-folder-dialog"
import { FileRenameDialog } from "./file-rename-dialog"
import { FileMoveDialog } from "./file-move-dialog"
import { FileDropZone } from "./file-drop-zone"
import { ScrollArea } from "@/components/ui/scroll-area"

export function FileBrowser({ path }: { path: string[] }) {
  const searchParams = useSearchParams()
  const viewParam = searchParams.get("view") as FileView | null
  const currentView = viewParam ?? "my-files"

  const { state, dispatch, getFilesForView } = useFiles()
  const files = getFilesForView(currentView, path)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [renameFile, setRenameFile] = useState<FileItem | null>(null)
  const [moveFile, setMoveFile] = useState<FileItem | null>(null)

  const { handleClick } = useFileSelection(files, state.selectedIds, {
    select: (ids) => dispatch({ type: "SET_SELECTED", payload: ids }),
  })

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        dispatch({ type: "CLEAR_SELECTION" })
      }
    },
    [dispatch]
  )

  const parentId = (() => {
    if (path.length === 0) return null
    const folder = state.files.find(
      (f) =>
        f.type === "folder" &&
        f.name === path[path.length - 1] &&
        JSON.stringify(f.path) === JSON.stringify(path.slice(0, -1))
    )
    return folder?.id ?? null
  })()

  const handleNew = useCallback(
    (type: NewFileType) => {
      if (type === "folder") {
        setNewFolderOpen(true)
        return
      }

      const names: Record<string, string> = {
        document: "Untitled Document",
        spreadsheet: "Untitled Spreadsheet",
        presentation: "Untitled Presentation",
      }
      const fileType = type === "presentation" ? "document" : type

      dispatch({
        type: "CREATE_FILE",
        payload: {
          name: names[type],
          fileType: fileType as FileItem["type"],
          parentId,
          path,
        },
      })
      toast.success(`${names[type]} created`)
    },
    [dispatch, parentId, path]
  )

  const viewTitle: Record<FileView, string> = {
    "my-files": "",
    shared: "Shared with me",
    recent: "Recent",
    starred: "Starred",
    trash: "Trash",
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      {currentView !== "my-files" && (
        <h1 className="text-lg font-semibold">{viewTitle[currentView]}</h1>
      )}
      {currentView === "my-files" && <FileBreadcrumb path={path} />}
      <FileToolbar
        onNew={handleNew}
        onUpload={() => setUploadOpen(true)}
      />
      <FileDropZone onDrop={() => setUploadOpen(true)}>
        <ScrollArea className="flex-1" onClick={handleBackgroundClick}>
          {state.viewMode === "grid" ? (
            <FileGrid
              files={files}
              selectedIds={state.selectedIds}
              onItemClick={handleClick}
              onRename={setRenameFile}
              onMove={setMoveFile}
            />
          ) : (
            <FileList
              files={files}
              selectedIds={state.selectedIds}
              onItemClick={handleClick}
              onRename={setRenameFile}
              onMove={setMoveFile}
            />
          )}
        </ScrollArea>
      </FileDropZone>

      <FileUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <FileNewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        currentPath={path}
        parentId={parentId}
      />
      <FileRenameDialog
        open={!!renameFile}
        onOpenChange={(open) => !open && setRenameFile(null)}
        file={renameFile}
      />
      <FileMoveDialog
        open={!!moveFile}
        onOpenChange={(open) => !open && setMoveFile(null)}
        file={moveFile}
      />

    </div>
  )
}
