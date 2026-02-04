"use client"

import type { FileItem as FileItemType } from "@/lib/files-data"
import { FolderCard, FileCard } from "./file-item"
import { FileContextMenu } from "./file-context-menu"
import { IconFile } from "@tabler/icons-react"

export function FileGrid({
  files,
  selectedIds,
  onItemClick,
  onRename,
  onMove,
}: {
  files: FileItemType[]
  selectedIds: Set<string>
  onItemClick: (id: string, e: React.MouseEvent) => void
  onRename: (file: FileItemType) => void
  onMove: (file: FileItemType) => void
}) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <IconFile size={48} strokeWidth={1} className="mb-3 opacity-40" />
        <p className="text-sm font-medium">No files here</p>
        <p className="text-xs mt-1">Upload files or create a folder to get started</p>
      </div>
    )
  }

  const folders = files.filter((f) => f.type === "folder")
  const regularFiles = files.filter((f) => f.type !== "folder")

  return (
    <div className="space-y-4 sm:space-y-6">
      {folders.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 sm:mb-3">
            Folders
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {folders.map((file) => (
              <FileContextMenu key={file.id} file={file} onRename={onRename} onMove={onMove}>
                <FolderCard
                  file={file}
                  selected={selectedIds.has(file.id)}
                  onClick={(e) => onItemClick(file.id, e)}
                />
              </FileContextMenu>
            ))}
          </div>
        </section>
      )}
      {regularFiles.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 sm:mb-3">
            Files
          </h3>
          <div className="grid grid-cols-2 min-[500px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
            {regularFiles.map((file) => (
              <FileContextMenu key={file.id} file={file} onRename={onRename} onMove={onMove}>
                <FileCard
                  file={file}
                  selected={selectedIds.has(file.id)}
                  onClick={(e) => onItemClick(file.id, e)}
                />
              </FileContextMenu>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
