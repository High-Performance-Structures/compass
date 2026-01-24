"use client"

import { useState } from "react"
import {
  IconLayoutGrid,
  IconList,
  IconPlus,
  IconUpload,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
  IconFolder,
  IconFileText,
  IconTable,
  IconPresentation,
} from "@tabler/icons-react"

import { useFiles, type SortField, type ViewMode } from "@/hooks/use-files"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type NewFileType = "folder" | "document" | "spreadsheet" | "presentation"

export function FileToolbar({
  onNew,
  onUpload,
}: {
  onNew: (type: NewFileType) => void
  onUpload: () => void
}) {
  const { state, dispatch } = useFiles()
  const [searchFocused, setSearchFocused] = useState(false)

  const sortLabels: Record<SortField, string> = {
    name: "Name",
    modified: "Modified",
    size: "Size",
    type: "Type",
  }

  const handleSort = (field: SortField) => {
    const direction =
      state.sortBy === field && state.sortDirection === "asc" ? "desc" : "asc"
    dispatch({ type: "SET_SORT", payload: { field, direction } })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <IconPlus size={16} />
              <span className="hidden sm:inline">New</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onNew("folder")}>
              <IconFolder size={16} />
              Folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onNew("document")}>
              <IconFileText size={16} />
              Document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onNew("spreadsheet")}>
              <IconTable size={16} />
              Spreadsheet
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onNew("presentation")}>
              <IconPresentation size={16} />
              Presentation
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onUpload}>
              <IconUpload size={16} />
              File upload
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1" />

      <div
        className={`relative transition-all duration-200 ${
          searchFocused ? "w-48 sm:w-64" : "w-32 sm:w-44"
        }`}
      >
        <IconSearch
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Search files..."
          value={state.searchQuery}
          onChange={(e) =>
            dispatch({ type: "SET_SEARCH", payload: e.target.value })
          }
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className="h-8 pl-8 text-sm"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost">
            {state.sortDirection === "asc" ? (
              <IconSortAscending size={16} />
            ) : (
              <IconSortDescending size={16} />
            )}
            <span className="hidden sm:inline">{sortLabels[state.sortBy]}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(Object.keys(sortLabels) as SortField[]).map((field) => (
            <DropdownMenuItem key={field} onClick={() => handleSort(field)}>
              {sortLabels[field]}
              {state.sortBy === field && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {state.sortDirection === "asc" ? "↑" : "↓"}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToggleGroup
        type="single"
        value={state.viewMode}
        onValueChange={(v) => {
          if (v) dispatch({ type: "SET_VIEW_MODE", payload: v as ViewMode })
        }}
        size="sm"
      >
        <ToggleGroupItem value="grid" aria-label="Grid view">
          <IconLayoutGrid size={16} />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="List view">
          <IconList size={16} />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}
