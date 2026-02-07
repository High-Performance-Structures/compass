"use client"

import { forwardRef } from "react"
import { useRouter } from "next/navigation"
import {
  IconStar,
  IconStarFilled,
  IconUsers,
} from "@tabler/icons-react"

import type { FileItem } from "@/lib/files-data"
import {
  formatFileSize,
  formatRelativeDate,
} from "@/lib/file-utils"
import { FileIcon } from "./file-icon"
import { useFiles } from "@/hooks/use-files"
import { TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export const FileRow = forwardRef<
  HTMLTableRowElement,
  {
    file: FileItem
    selected: boolean
    onClick: (e: React.MouseEvent) => void
  }
>(function FileRow(
  { file, selected, onClick, ...props },
  ref
) {
  const router = useRouter()
  const { starFile, state, dispatch } = useFiles()

  const handleDoubleClick = () => {
    if (file.type === "folder") {
      if (state.isConnected === true) {
        router.push(`/dashboard/files/folder/${file.id}`)
      } else {
        const folderPath = [...file.path, file.name].join(
          "/"
        )
        router.push(`/dashboard/files/${folderPath}`)
      }
    }
  }

  const handleStar = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (state.isConnected === true) {
      await starFile(file.id)
    } else {
      dispatch({
        type: "OPTIMISTIC_STAR",
        payload: file.id,
      })
    }
  }

  return (
    <TableRow
      ref={ref}
      className={cn(
        "cursor-pointer group",
        selected && "bg-primary/5"
      )}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      {...props}
    >
      <TableCell className="w-[40%]">
        <div className="flex items-center gap-2.5 min-w-0">
          <FileIcon type={file.type} size={18} />
          <span className="truncate text-sm font-medium">
            {file.name}
          </span>
          {file.shared && (
            <IconUsers
              size={13}
              className="text-muted-foreground shrink-0"
            />
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatRelativeDate(file.modifiedAt)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {file.owner.name}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {file.type === "folder"
          ? "—"
          : formatFileSize(file.size)}
      </TableCell>
      <TableCell className="w-8">
        <button
          className={cn(
            "opacity-0 group-hover:opacity-100 transition-opacity",
            file.starred && "opacity-100"
          )}
          onClick={handleStar}
        >
          {file.starred ? (
            <IconStarFilled
              size={14}
              className="text-amber-400"
            />
          ) : (
            <IconStar
              size={14}
              className="text-muted-foreground hover:text-amber-400"
            />
          )}
        </button>
      </TableCell>
    </TableRow>
  )
})
