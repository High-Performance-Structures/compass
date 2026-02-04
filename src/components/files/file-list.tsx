"use client"

import type { FileItem as FileItemType } from "@/lib/files-data"
import { FileRow } from "./file-row"
import { FileContextMenu } from "./file-context-menu"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { IconFile } from "@tabler/icons-react"

export function FileList({
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

  return (
    <div className="overflow-x-auto -mx-2 sm:mx-0">
      <div className="inline-block min-w-full align-middle">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Name</TableHead>
              <TableHead className="hidden sm:table-cell">Modified</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead className="hidden lg:table-cell">Size</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <FileContextMenu key={file.id} file={file} onRename={onRename} onMove={onMove}>
                <FileRow
                  file={file}
                  selected={selectedIds.has(file.id)}
                  onClick={(e) => onItemClick(file.id, e)}
                />
              </FileContextMenu>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
