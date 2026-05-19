"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  IconChevronLeft,
  IconChevronRight,
  IconFile,
  IconStar,
  IconStarFilled,
} from "@tabler/icons-react"

import type { FileItem as FileItemType } from "@/lib/files-data"
import {
  PROJECT_FILE_SOURCES,
  getProjectFolderMatch,
  type ProjectFileSourceKey,
} from "@/lib/project-files"
import { formatRelativeDate } from "@/lib/file-utils"
import { cn } from "@/lib/utils"
import { useFiles, type ViewMode } from "@/hooks/use-files"
import { FileContextMenu } from "./file-context-menu"
import { FileIcon } from "./file-icon"
import { FileRow } from "./file-row"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PROJECTS_PER_PAGE = 20

type ProjectFileGroupsProps = {
  files: FileItemType[]
  selectedIds: Set<string>
  viewMode: ViewMode
  onItemClick: (id: string, e: React.MouseEvent) => void
  onRename: (file: FileItemType) => void
  onMove: (file: FileItemType) => void
}

type ProjectGroup = {
  source: (typeof PROJECT_FILE_SOURCES)[number]
  files: FileItemType[]
}

function getProjectSourceKey(
  file: FileItemType
): ProjectFileSourceKey | null {
  const sourceKey = file.projectFile?.sourceKey
  if (sourceKey) return sourceKey as ProjectFileSourceKey
  return getProjectFolderMatch(file.name)?.source.key ?? null
}

function getProjectDisplayParts(file: FileItemType): {
  projectNumber: string
  title: string
} {
  const match = getProjectFolderMatch(file.name)
  const projectNumber =
    file.projectFile?.projectNumber ?? match?.projectNumber ?? ""
  const title = projectNumber
    ? file.name
        .replace(projectNumber, "")
        .replace(/^[\s-]+/, "")
        .trim()
    : file.name

  return {
    projectNumber,
    title: title || file.name,
  }
}

function ProjectFolderCard({
  file,
  selected,
  onClick,
}: {
  file: FileItemType
  selected: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const router = useRouter()
  const { starFile, state, dispatch } = useFiles()
  const { projectNumber, title } = getProjectDisplayParts(file)

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
      className={cn(
        "group flex min-h-[118px] cursor-pointer flex-col justify-between rounded-lg border bg-card p-3 text-left transition-all",
        "hover:border-border/80 hover:shadow-sm",
        selected && "border-primary ring-2 ring-primary/20"
      )}
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-50 dark:bg-amber-950/30">
          <FileIcon type="folder" size={18} />
        </div>
        <div className="min-w-0 flex-1">
          {projectNumber && (
            <p className="mb-1 truncate font-mono text-[11px] font-semibold text-muted-foreground">
              {projectNumber}
            </p>
          )}
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {title}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">
          {formatRelativeDate(file.modifiedAt)}
        </p>
        <button
          className={cn(
            "shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
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
  )
}

export function ProjectFileGroups({
  files,
  selectedIds,
  viewMode,
  onItemClick,
  onRename,
  onMove,
}: ProjectFileGroupsProps) {
  const { state } = useFiles()
  const groupedSources = useMemo<ProjectGroup[]>(
    () =>
      PROJECT_FILE_SOURCES.map(source => ({
        source,
        files: files.filter(
          file => getProjectSourceKey(file) === source.key
        ),
      })),
    [files]
  )

  const visibleGroups = useMemo(
    () =>
      groupedSources.filter(group => group.files.length > 0),
    [groupedSources]
  )
  const [activeSourceKey, setActiveSourceKey] =
    useState<ProjectFileSourceKey | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (visibleGroups.length === 0) {
      setActiveSourceKey(null)
      return
    }

    if (
      !activeSourceKey ||
      !visibleGroups.some(
        group => group.source.key === activeSourceKey
      )
    ) {
      setActiveSourceKey(visibleGroups[0].source.key)
      setPage(1)
    }
  }, [activeSourceKey, visibleGroups])

  useEffect(() => {
    setPage(1)
  }, [activeSourceKey, state.searchQuery])

  const activeGroup =
    groupedSources.find(
      group => group.source.key === activeSourceKey
    ) ?? visibleGroups[0]

  const pageCount = activeGroup
    ? Math.max(1, Math.ceil(activeGroup.files.length / PROJECTS_PER_PAGE))
    : 1

  useEffect(() => {
    setPage(current => Math.min(current, pageCount))
  }, [pageCount])

  if (visibleGroups.length === 0 || !activeGroup) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {groupedSources.map(({ source }) => (
            <Button
              key={source.key}
              type="button"
              variant="outline"
              size="sm"
              disabled
              className="justify-between gap-3"
            >
              <span>{source.label}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                0
              </span>
            </Button>
          ))}
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <IconFile
            size={48}
            strokeWidth={1}
            className="mb-3 opacity-40"
          />
          <p className="text-sm font-medium">
            No project folders match this search
          </p>
        </div>
      </div>
    )
  }

  const pageStart = (page - 1) * PROJECTS_PER_PAGE
  const pageFiles = activeGroup.files.slice(
    pageStart,
    pageStart + PROJECTS_PER_PAGE
  )
  const showingStart = activeGroup.files.length === 0 ? 0 : pageStart + 1
  const showingEnd = Math.min(
    pageStart + PROJECTS_PER_PAGE,
    activeGroup.files.length
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {groupedSources.map(({ source, files: sourceFiles }) => {
          const isActive = source.key === activeGroup.source.key
          return (
            <Button
              key={source.key}
              type="button"
              variant={isActive ? "default" : "outline"}
              size="sm"
              disabled={sourceFiles.length === 0}
              className="justify-between gap-3"
              onClick={() => {
                setActiveSourceKey(source.key)
                setPage(1)
              }}
            >
              <span>{source.label}</span>
              <span
                className={cn(
                  "rounded bg-background/20 px-1.5 py-0.5 text-[11px]",
                  !isActive && "bg-muted text-muted-foreground"
                )}
              >
                {sourceFiles.length}
              </span>
            </Button>
          )
        })}
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">
              {activeGroup.source.label}
            </h2>
            <p className="text-xs text-muted-foreground">
              Showing {showingStart}-{showingEnd} of{" "}
              {activeGroup.files.length} projects
            </p>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(current => current - 1)}
              >
                <IconChevronLeft size={14} />
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {pageCount}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page === pageCount}
                onClick={() => setPage(current => current + 1)}
              >
                Next
                <IconChevronRight size={14} />
              </Button>
            </div>
          )}
        </div>

        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {pageFiles.map(file => (
              <FileContextMenu
                key={file.id}
                file={file}
                onRename={onRename}
                onMove={onMove}
              >
                <ProjectFolderCard
                  file={file}
                  selected={selectedIds.has(file.id)}
                  onClick={e => onItemClick(file.id, e)}
                />
              </FileContextMenu>
            ))}
          </div>
        ) : (
          <div className="-mx-2 overflow-x-auto sm:mx-0">
            <div className="inline-block min-w-full align-middle">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">
                      Name
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Modified
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Owner
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Size
                    </TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageFiles.map(file => (
                    <FileContextMenu
                      key={file.id}
                      file={file}
                      onRename={onRename}
                      onMove={onMove}
                    >
                      <FileRow
                        file={file}
                        selected={selectedIds.has(file.id)}
                        onClick={e => onItemClick(file.id, e)}
                      />
                    </FileContextMenu>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
