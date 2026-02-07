"use client"

import { useState, useCallback, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import {
  IconCloudOff,
  IconAlertTriangle,
  IconRefresh,
  IconLoader2,
} from "@tabler/icons-react"

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
import { Button } from "@/components/ui/button"

export function FileBrowser({
  path,
  folderId,
}: {
  path?: string[]
  folderId?: string
}) {
  const searchParams = useSearchParams()
  const viewParam = searchParams.get("view") as FileView | null
  const currentView = viewParam ?? "my-files"

  const {
    state,
    dispatch,
    getFilesForView,
    fetchFiles,
    loadMore,
    createFolder,
    starFile,
  } = useFiles()

  const effectivePath = path ?? []
  const files = getFilesForView(currentView, effectivePath)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [renameFile, setRenameFile] = useState<FileItem | null>(
    null
  )
  const [moveFile, setMoveFile] = useState<FileItem | null>(null)

  const { handleClick } = useFileSelection(
    files,
    state.selectedIds,
    {
      select: ids =>
        dispatch({ type: "SET_SELECTED", payload: ids }),
    }
  )

  // fetch files when connected and folder/view changes
  useEffect(() => {
    if (state.isConnected !== true) return
    fetchFiles(folderId, currentView)
  }, [state.isConnected, folderId, currentView, fetchFiles])

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        dispatch({ type: "CLEAR_SELECTION" })
      }
    },
    [dispatch]
  )

  // for mock data mode, resolve parentId from path
  const parentId = (() => {
    if (folderId) return folderId
    if (effectivePath.length === 0) return null
    const folder = state.files.find(
      f =>
        f.type === "folder" &&
        f.name === effectivePath[effectivePath.length - 1] &&
        JSON.stringify(f.path) ===
          JSON.stringify(effectivePath.slice(0, -1))
    )
    return folder?.id ?? null
  })()

  const handleNew = useCallback(
    async (type: NewFileType) => {
      if (type === "folder") {
        setNewFolderOpen(true)
        return
      }
      // for google-native doc creation, these would
      // be created as google docs/sheets/slides
      toast.info(
        "Creating Google Workspace files coming soon"
      )
    },
    []
  )

  const handleDrop = useCallback((droppedFiles: File[]) => {
    setUploadFiles(droppedFiles)
    setUploadOpen(true)
  }, [])

  const viewTitle: Record<FileView, string> = {
    "my-files": "",
    shared: "Shared with me",
    recent: "Recent",
    starred: "Starred",
    trash: "Trash",
  }

  // loading state (only for initial load)
  if (state.isConnected === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <IconLoader2
            size={32}
            className="animate-spin"
          />
          <p className="text-sm">
            Checking connection...
          </p>
        </div>
      </div>
    )
  }

  // error state
  if (state.error && state.files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <IconAlertTriangle
            size={32}
            className="text-destructive"
          />
          <p className="text-sm text-muted-foreground">
            {state.error}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              fetchFiles(folderId, currentView)
            }
          >
            <IconRefresh size={16} className="mr-2" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      {/* not connected banner (demo mode) */}
      {state.isConnected === false && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50 px-4 py-3">
          <IconCloudOff
            size={18}
            className="text-muted-foreground"
          />
          <p className="text-sm text-muted-foreground">
            Showing demo files. Connect Google Drive in
            Settings to see your real files.
          </p>
        </div>
      )}

      {currentView !== "my-files" && (
        <h1 className="text-lg font-semibold">
          {viewTitle[currentView]}
        </h1>
      )}
      {currentView === "my-files" && (
        <FileBreadcrumb
          path={effectivePath}
          folderId={folderId}
        />
      )}
      <FileToolbar
        onNew={handleNew}
        onUpload={() => {
          setUploadFiles([])
          setUploadOpen(true)
        }}
      />
      <FileDropZone onDrop={handleDrop}>
        <ScrollArea
          className="flex-1"
          onClick={handleBackgroundClick}
        >
          {state.isLoading && state.files.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <IconLoader2
                size={24}
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : state.viewMode === "grid" ? (
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

          {state.nextPageToken && (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={state.isLoading}
              >
                {state.isLoading ? (
                  <IconLoader2
                    size={16}
                    className="mr-2 animate-spin"
                  />
                ) : null}
                Load more
              </Button>
            </div>
          )}
        </ScrollArea>
      </FileDropZone>

      <FileUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        files={uploadFiles}
        parentId={parentId ?? folderId}
      />
      <FileNewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        currentPath={effectivePath}
        parentId={parentId ?? folderId ?? null}
      />
      <FileRenameDialog
        open={!!renameFile}
        onOpenChange={open => !open && setRenameFile(null)}
        file={renameFile}
      />
      <FileMoveDialog
        open={!!moveFile}
        onOpenChange={open => !open && setMoveFile(null)}
        file={moveFile}
      />
    </div>
  )
}
