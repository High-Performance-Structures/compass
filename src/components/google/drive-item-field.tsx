"use client"

import * as React from "react"
import { IconExternalLink, IconFile, IconFolder } from "@tabler/icons-react"

import { getDrivePickerItem } from "@/app/actions/drive-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { driveIdFromInput, driveItemUrl, type DrivePickerDestination, type DrivePickerItem } from "@/lib/google/drive-picker"

import { DriveBrowseDialog, type DriveBrowseChoice } from "./drive-browse-dialog"

/**
 * A field that holds one Drive file or folder. People browse to it (Drive,
 * a Compass project, or upload from the computer) instead of hunting for a
 * link; pasting a link stays available as a fallback. Works controlled
 * (`value`/`onChange`) or inside a plain form (`name`/`defaultValue`).
 */
export function DriveItemField({
  id,
  name,
  value,
  defaultValue,
  onChange,
  valueAs = "url",
  choose = "file",
  projectId = null,
  uploadDestination,
  browseTitle,
  disabled = false,
  required = false,
  ariaLabel,
  allowOtherLinks = false,
}: {
  readonly id?: string
  /** Form field name; the value is submitted from a hidden input. */
  readonly name?: string
  readonly value?: string | null
  readonly defaultValue?: string | null
  readonly onChange?: (value: string, item: DrivePickerItem | null) => void
  /** Store the Drive link, or only the Drive id. */
  readonly valueAs?: "url" | "id"
  readonly choose?: DriveBrowseChoice
  readonly projectId?: string | null
  readonly uploadDestination?: DrivePickerDestination
  readonly browseTitle?: string
  readonly disabled?: boolean
  readonly required?: boolean
  readonly ariaLabel?: string
  /** Accept a pasted link that isn't a Drive file (e.g. a signing service receipt). */
  readonly allowOtherLinks?: boolean
}): React.ReactElement {
  const [inner, setInner] = React.useState(defaultValue ?? "")
  const current = value === undefined ? inner : value ?? ""
  const [item, setItem] = React.useState<DrivePickerItem | null>(null)
  const [browsing, setBrowsing] = React.useState(false)
  const [pasting, setPasting] = React.useState(false)
  const driveId = driveIdFromInput(current)

  // Show the chosen file's name, looking it up for values saved earlier.
  React.useEffect(() => {
    if (!driveId) {
      setItem(null)
      return
    }
    if (item?.id === driveId) return
    let cancelled = false
    void getDrivePickerItem(driveId).then((result) => {
      if (!cancelled) setItem(result.success ? result.data : null)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveId])

  function set(next: string, picked: DrivePickerItem | null): void {
    if (value === undefined) setInner(next)
    setItem(picked)
    onChange?.(next, picked)
  }

  function pick(picked: DrivePickerItem): void {
    setPasting(false)
    set(valueAs === "id" ? picked.id : picked.url || driveItemUrl(picked.id, picked.kind), picked)
  }

  const label = ariaLabel ?? (choose === "folder" ? "Drive folder" : "Drive file")
  const shownName = item?.name ?? (driveId ? "Drive item" : current)
  const href = item?.url || (driveId ? driveItemUrl(driveId, choose === "folder" ? "folder" : "file") : /^https:\/\//.test(current) ? current : null)
  const Icon = (item?.kind ?? (choose === "folder" ? "folder" : "file")) === "folder" ? IconFolder : IconFile

  return (
    <div className="grid gap-1.5">
      {name && <input type="hidden" name={name} value={current} />}
      {pasting ? (
        <Input
          id={id}
          aria-label={label}
          autoFocus
          placeholder={allowOtherLinks ? "Paste a link" : "Paste a Drive link"}
          value={current}
          disabled={disabled}
          required={required}
          onChange={(event) => {
            const text = event.target.value
            const pastedId = driveIdFromInput(text)
            set(valueAs === "id" ? pastedId ?? text : text, null)
          }}
        />
      ) : current ? (
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 hover:underline">
              <span className="truncate">{shownName}</span>
              <IconExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            <span className="truncate">{shownName}</span>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{choose === "folder" ? "No folder chosen" : "No file chosen"}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button id={pasting ? undefined : id} type="button" size="sm" variant="outline" disabled={disabled} aria-label={`Browse for ${label}`} onClick={() => setBrowsing(true)}>
          Browse…
        </Button>
        {current && !disabled && (
          <Button type="button" size="sm" variant="ghost" onClick={() => set("", null)}>
            Remove
          </Button>
        )}
        {!disabled && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setPasting(!pasting)}>
            {pasting ? "Done" : "Paste a link instead"}
          </button>
        )}
      </div>
      <DriveBrowseDialog
        open={browsing}
        onOpenChange={setBrowsing}
        choose={choose}
        title={browseTitle ?? (choose === "folder" ? "Choose a folder" : "Choose a file")}
        projectId={projectId}
        uploadDestination={uploadDestination}
        onPick={(picked) => {
          const first = picked[0]
          if (first) pick(first)
        }}
      />
    </div>
  )
}
