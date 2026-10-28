"use client"

import * as React from "react"

import { findDriveDuplicate, listDrivePickerFolder, startDrivePickerUpload } from "@/app/actions/drive-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { driveItemUrl, uploadedFileId, type DrivePickerDestination, type DrivePickerItem } from "@/lib/google/drive-picker"

import { DriveBrowseList, type DriveBrowseCrumb } from "./drive-browse-list"

function destinationName(destination: DrivePickerDestination): string {
  return destination.kind === "my" ? "My Drive" : destination.name
}

/**
 * Upload from the computer into Drive, then link the new file. Checks Drive
 * first for a file with the same name and size so nothing is stored twice.
 */
export function DriveUploadPanel({
  defaultDestination,
  onUploaded,
}: {
  readonly defaultDestination: DrivePickerDestination
  readonly onUploaded: (item: DrivePickerItem) => void
}): React.ReactElement {
  const [file, setFile] = React.useState<File | null>(null)
  const [destination, setDestination] = React.useState<DrivePickerDestination>(defaultDestination)
  const [changing, setChanging] = React.useState(false)
  const [openFolder, setOpenFolder] = React.useState<DriveBrowseCrumb | null>(null)
  const [duplicate, setDuplicate] = React.useState<DrivePickerItem | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function choose(next: File | null): Promise<void> {
    setFile(next)
    setDuplicate(null)
    setError(null)
    setStatus(null)
    if (!next) return
    setBusy(true)
    setStatus("Checking Drive for this file…")
    const found = await findDriveDuplicate(next.name, next.size)
    setBusy(false)
    setStatus(null)
    if (found.success) setDuplicate(found.data)
  }

  async function upload(): Promise<void> {
    if (!file) return
    setBusy(true)
    setError(null)
    setStatus(`Uploading ${file.name}…`)
    const session = await startDrivePickerUpload(file.name, file.type, destination)
    if (!session.success) {
      setBusy(false)
      setStatus(null)
      setError(session.error)
      return
    }
    const response = await fetch(session.data.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    }).catch(() => null)
    const id = response?.ok ? uploadedFileId(await response.text()) : null
    setBusy(false)
    setStatus(null)
    if (!id) {
      setError(`Upload failed for ${file.name}. Try again.`)
      return
    }
    onUploaded({ id, name: file.name, kind: "file", mimeType: file.type, modifiedAt: new Date().toISOString(), url: driveItemUrl(id, "file") })
  }

  if (changing) {
    return (
      <div className="grid gap-2">
        <p className="text-sm">Open the folder to save into, then choose <span className="font-medium">Save here</span>.</p>
        <DriveBrowseList
          rootCrumbs={[{ id: "__my", name: "My Drive" }]}
          load={(crumb) => listDrivePickerFolder(crumb.id && crumb.id !== "__my" ? { kind: "folder", id: crumb.id } : { kind: "my" })}
          canChoose={() => false}
          chosen={new Map()}
          onToggle={() => undefined}
          onFolderChange={setOpenFolder}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (openFolder?.id && openFolder.id !== "__my") setDestination({ kind: "folder", id: openFolder.id, name: openFolder.name })
              else setDestination({ kind: "my" })
              setChanging(false)
            }}
          >
            Save here
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setChanging(false)}>Cancel</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="drive-upload-file">File from this computer</Label>
        <Input id="drive-upload-file" type="file" disabled={busy} onChange={(event) => void choose(event.target.files?.[0] ?? null)} />
      </div>
      <p className="text-sm text-muted-foreground">
        Saves to <span className="font-medium text-foreground">{destinationName(destination)}</span> in Google Drive, and Compass links to it.{" "}
        <button type="button" className="underline" disabled={busy} onClick={() => setChanging(true)}>Change folder</button>
      </p>
      {duplicate && (
        <div className="grid gap-2 border-l-2 border-primary pl-3 text-sm">
          <p>
            <span className="font-medium">{duplicate.name}</span> is already in Drive with the same size. Use that one so there&apos;s no second copy?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => onUploaded(duplicate)}>Use the one in Drive</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void upload()}>Upload a copy anyway</Button>
          </div>
        </div>
      )}
      {status && <p className="text-sm text-muted-foreground">{status}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!duplicate && (
        <div>
          <Button type="button" size="sm" disabled={!file || busy} onClick={() => void upload()}>
            {busy ? "Working…" : "Upload and use"}
          </Button>
        </div>
      )}
    </div>
  )
}
