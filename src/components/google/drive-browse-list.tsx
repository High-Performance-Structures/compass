"use client"

import * as React from "react"
import { IconChevronRight, IconFile, IconFolder } from "@tabler/icons-react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import type { DrivePickerItem } from "@/lib/google/drive-picker"

export type DriveBrowseCrumb = { readonly id: string | null; readonly name: string }

export type DriveBrowseLoadResult =
  | { readonly success: true; readonly data: readonly DrivePickerItem[] }
  | { readonly success: false; readonly error: string }

function modified(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * One browsable Drive tree: breadcrumbs, a filter (or a Drive-wide search when
 * `search` is given), folders that open on click, and tick boxes for what can
 * be chosen.
 */
export function DriveBrowseList({
  rootCrumbs,
  load,
  search,
  canChoose,
  chosen,
  onToggle,
  onFolderChange,
  alreadyChosenIds = [],
}: {
  /** The starting path; the last crumb is the folder shown first. */
  readonly rootCrumbs: readonly DriveBrowseCrumb[]
  readonly load: (crumb: DriveBrowseCrumb) => Promise<DriveBrowseLoadResult>
  readonly search?: (query: string) => Promise<DriveBrowseLoadResult>
  readonly canChoose: (item: DrivePickerItem) => boolean
  readonly chosen: ReadonlyMap<string, DrivePickerItem>
  readonly onToggle: (item: DrivePickerItem, on: boolean) => void
  /** The folder now open, so the dialog can offer "Use this folder". */
  readonly onFolderChange?: (crumb: DriveBrowseCrumb) => void
  readonly alreadyChosenIds?: readonly string[]
}): React.ReactElement {
  const [trail, setTrail] = React.useState<readonly DriveBrowseCrumb[]>(rootCrumbs)
  const [items, setItems] = React.useState<readonly DrivePickerItem[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [searchResults, setSearchResults] = React.useState<readonly DrivePickerItem[] | null>(null)
  const current = trail[trail.length - 1] ?? rootCrumbs[0] ?? { id: null, name: "Drive" }
  const rootKey = rootCrumbs.map((crumb) => crumb.id ?? "").join("/")

  React.useEffect(() => {
    setTrail(rootCrumbs)
    // Only a new starting point (e.g. another project) resets the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootKey])

  React.useEffect(() => {
    onFolderChange?.(current)
    let cancelled = false
    setLoading(true)
    setError(null)
    void load(current).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.success) setItems(result.data)
      else {
        setItems([])
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, current.name])

  // Drive-wide search waits for a pause in typing.
  React.useEffect(() => {
    if (!search) return
    const needle = query.trim()
    if (needle.length < 2) {
      setSearchResults(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      void search(needle).then((result) => {
        if (cancelled) return
        setLoading(false)
        setSearchResults(result.success ? result.data : [])
        setError(result.success ? null : result.error)
      })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, search])

  function openFolder(item: DrivePickerItem): void {
    setQuery("")
    setSearchResults(null)
    setTrail([...trail, { id: item.id, name: item.name }])
  }

  const needle = query.trim().toLowerCase()
  const shown = searchResults ?? (needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items)
  const already = new Set(alreadyChosenIds)

  return (
    <div className="grid gap-2">
      <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
        {trail.map((crumb, index) => (
          <React.Fragment key={`${crumb.id ?? "root"}-${index}`}>
            {index > 0 && <IconChevronRight className="size-3.5 text-muted-foreground" />}
            {index === trail.length - 1 && !searchResults ? (
              <span className="font-medium">{crumb.name}</span>
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => {
                  setQuery("")
                  setSearchResults(null)
                  setTrail(trail.slice(0, index + 1))
                }}
              >
                {crumb.name}
              </button>
            )}
          </React.Fragment>
        ))}
      </nav>
      <Input
        aria-label={search ? "Search Drive" : "Search this folder"}
        placeholder={search ? "Search all of Drive by name" : "Search this folder"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="min-h-48 overflow-y-auto border-y" style={{ maxHeight: "42vh" }}>
        {loading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="p-3 text-sm text-destructive">{error}</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{needle ? "Nothing matches." : "This folder is empty."}</p>
        ) : (
          <ul className="divide-y">
            {shown.map((item) => {
              const isAlready = already.has(item.id)
              const choosable = canChoose(item)
              return (
                <li key={item.id} className="flex items-center gap-3 px-2 py-2 text-sm">
                  {choosable ? (
                    <Checkbox
                      aria-label={`Choose ${item.name}`}
                      checked={chosen.has(item.id) || isAlready}
                      disabled={isAlready}
                      onCheckedChange={(checked) => onToggle(item, checked === true)}
                    />
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                  )}
                  {item.kind === "folder" ? (
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline" onClick={() => openFolder(item)}>
                      <IconFolder className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{item.name}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                      disabled={!choosable || isAlready}
                      onClick={() => onToggle(item, !chosen.has(item.id))}
                    >
                      <IconFile className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{item.name}</span>
                    </button>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">{isAlready ? "Added" : modified(item.modifiedAt)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
