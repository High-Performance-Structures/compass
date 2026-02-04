"use client"

import { forwardRef } from "react"
import { IconStar, IconStarFilled, IconUsers, IconDots } from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import type { FileItem as FileItemType } from "@/lib/files-data"
import { formatRelativeDate } from "@/lib/file-utils"
import { FileIcon } from "./file-icon"
import { useFiles } from "@/hooks/use-files"
import { cn } from "@/lib/utils"

const fileTypeColors: Record<string, string> = {
  document: "bg-blue-50 dark:bg-blue-950/30",
  spreadsheet: "bg-green-50 dark:bg-green-950/30",
  image: "bg-purple-50 dark:bg-purple-950/30",
  video: "bg-red-50 dark:bg-red-950/30",
  pdf: "bg-red-50 dark:bg-red-950/30",
  code: "bg-emerald-50 dark:bg-emerald-950/30",
  archive: "bg-orange-50 dark:bg-orange-950/30",
  audio: "bg-pink-50 dark:bg-pink-950/30",
  unknown: "bg-muted",
}

export const FolderCard = forwardRef<
  HTMLDivElement,
  {
    file: FileItemType
    selected: boolean
    onClick: (e: React.MouseEvent) => void
  }
>(function FolderCard({ file, selected, onClick, ...props }, ref) {
  const router = useRouter()
  const { dispatch } = useFiles()

  const handleDoubleClick = () => {
    const folderPath = [...file.path, file.name].join("/")
    router.push(`/dashboard/files/${folderPath}`)
  }

  return (
    <div
      ref={ref}
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-card px-3 py-3 cursor-pointer min-h-[60px]",
        "hover:shadow-sm hover:border-border/80 transition-all",
        selected && "border-primary ring-2 ring-primary/20"
      )}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      {...props}
    >
      <FileIcon type="folder" size={22} className="shrink-0" />
      <span className="text-sm font-medium line-clamp-2 flex-1 break-words">{file.name}</span>
      {file.shared && (
        <IconUsers size={14} className="text-muted-foreground shrink-0" />
      )}
      <button
        className={cn(
          "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
          file.starred && "opacity-100"
        )}
        onClick={(e) => {
          e.stopPropagation()
          dispatch({ type: "STAR_FILE", payload: file.id })
        }}
      >
        {file.starred ? (
          <IconStarFilled size={14} className="text-amber-400" />
        ) : (
          <IconStar size={14} className="text-muted-foreground hover:text-amber-400" />
        )}
      </button>
    </div>
  )
})

export const FileCard = forwardRef<
  HTMLDivElement,
  {
    file: FileItemType
    selected: boolean
    onClick: (e: React.MouseEvent) => void
  }
>(function FileCard({ file, selected, onClick, ...props }, ref) {
  const { dispatch } = useFiles()

  return (
    <div
      ref={ref}
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card overflow-hidden cursor-pointer",
        "hover:shadow-sm hover:border-border/80 transition-all",
        selected && "border-primary ring-2 ring-primary/20"
      )}
      onClick={onClick}
      {...props}
    >
      <div
        className={cn(
          "flex items-center justify-center h-20 sm:h-24",
          fileTypeColors[file.type] ?? fileTypeColors.unknown
        )}
      >
        <FileIcon type={file.type} size={32} className="opacity-70 sm:size-10" />
      </div>
      <div className="flex flex-col gap-1 px-2.5 py-2.5 border-t">
        <p className="text-sm font-medium line-clamp-2 break-words leading-snug">{file.name}</p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground truncate">
            {formatRelativeDate(file.modifiedAt)}
            {file.shared && " · Shared"}
          </p>
          <button
            className={cn(
              "opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0",
              file.starred && "opacity-100"
            )}
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: "STAR_FILE", payload: file.id })
            }}
          >
            {file.starred ? (
              <IconStarFilled size={14} className="text-amber-400" />
            ) : (
              <IconStar size={14} className="text-muted-foreground hover:text-amber-400" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
})
