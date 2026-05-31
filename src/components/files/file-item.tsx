"use client"

import { forwardRef } from "react"
import {
  IconStar,
  IconStarFilled,
  IconUsers,
} from "@tabler/icons-react"
import { useRouter } from "next/navigation"

import type { FileItem as FileItemType } from "@/lib/files-data"
import { formatRelativeDate } from "@/lib/file-utils"
import { FileIcon } from "./file-icon"
import { useFiles } from "@/hooks/use-files"
import { cn } from "@/lib/utils"

const fileTypeColors: Record<string, string> = {
  document: "border border-[#2f5963] bg-card text-[#2f5963]",
  spreadsheet: "border border-[#3f7d4d] bg-card text-[#3f7d4d]",
  image: "border border-[#6f471f] bg-card text-[#6f471f]",
  video: "border border-[#8a3a2e] bg-card text-[#8a3a2e]",
  pdf: "border border-[#8a3a2e] bg-card text-[#8a3a2e]",
  code: "border border-[#3f7d4d] bg-card text-[#3f7d4d]",
  archive: "border border-[#9d832c] bg-card text-[#715d1c]",
  audio: "border border-[#585149] bg-card text-[#585149]",
  unknown: "border bg-card text-muted-foreground",
}

export const FolderCard = forwardRef<
  HTMLDivElement,
  {
    file: FileItemType
    selected: boolean
    onClick: (e: React.MouseEvent) => void
  }
>(function FolderCard(
  { file, selected, onClick, ...props },
  ref
) {
  const router = useRouter()
  const { starFile, state, dispatch } = useFiles()
  const projectCaption =
    file.projectFile?.projectNumber ??
    file.projectFile?.sourceLabel ??
    file.projectFile?.categoryLabel

  const handleDoubleClick = () => {
    if (state.isConnected === true) {
      router.push(`/dashboard/files/folder/${file.id}`)
    } else {
      const folderPath = [...file.path, file.name].join("/")
      router.push(`/dashboard/files/${folderPath}`)
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
      <FileIcon
        type="folder"
        size={22}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium line-clamp-2 break-words">
          {file.name}
        </span>
        {projectCaption && (
          <span className="block truncate text-xs text-muted-foreground">
            {projectCaption}
          </span>
        )}
      </span>
      {file.shared && (
        <IconUsers
          size={14}
          className="text-muted-foreground shrink-0"
        />
      )}
      <button
        className={cn(
          "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
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
>(function FileCard(
  { file, selected, onClick, ...props },
  ref
) {
  const { starFile, state, dispatch } = useFiles()

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
          fileTypeColors[file.type] ??
            fileTypeColors.unknown
        )}
      >
        <FileIcon
          type={file.type}
          size={32}
          className="opacity-70 sm:size-10"
        />
      </div>
      <div className="flex flex-col gap-1 px-2.5 py-2.5 border-t">
        <p className="text-sm font-medium line-clamp-2 break-words leading-snug">
          {file.name}
        </p>
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
        </div>
      </div>
    </div>
  )
})
