"use client"

import {
  IconExternalLink,
  IconFileText,
  IconFolderOpen,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"

import { ProjectDriveFilePicker } from "@/components/projects/project-drive-file-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cleanText } from "@/lib/shared/guards"

import { DOCUMENT_INPUT_CLASS } from "./rfq-draft"
import type { RfqRowsState } from "./use-rfq-create-draft"

/** "Plans & specs package": links and Drive files the vendor may price from. */
export function RfqDocumentLinks({
  projectId,
  rows,
}: {
  readonly projectId: string
  readonly rows: RfqRowsState
}): React.ReactElement {
  const {
    documentLinks,
    filePickerOpen,
    setFilePickerOpen,
    addDocumentLink,
    addPickedFiles,
    removeDocumentLink,
    updateDocumentLink,
  } = rows
  return (
          <div className="border-y">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
              <div>
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <IconFileText className="size-4" />
                  Plans & specs package
                </h3>
                <p className="text-xs text-muted-foreground">
                  Add approved Drive links, plan sheets, specs, addenda, or
                  project photos that this vendor may use for pricing.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addDocumentLink}
                >
                  <IconPlus className="size-4" />
                  Add link
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFilePickerOpen(true)}
                >
                  <IconFolderOpen className="size-4" />
                  Add files
                </Button>
                <ProjectDriveFilePicker
                  projectId={projectId}
                  open={filePickerOpen}
                  onOpenChange={setFilePickerOpen}
                  alreadyPickedUrls={documentLinks.map((link) => link.url.trim())}
                  onPick={addPickedFiles}
                />
              </div>
            </div>
            <div className="space-y-3 py-3">
              {documentLinks.map((link, index) => (
                <div
                  key={link.id}
                  className="grid gap-2 border-b pb-3 last:border-b-0 last:pb-0 md:grid-cols-[minmax(9rem,.8fr)_minmax(16rem,1.4fr)_minmax(10rem,1fr)_2.5rem]"
                >
                  <Input
                    value={link.label}
                    onChange={(event) =>
                      updateDocumentLink(link.id, "label", event.target.value)
                    }
                    placeholder="Plan set, specs, addendum..."
                    className={DOCUMENT_INPUT_CLASS}
                    aria-label={`RFQ document ${index + 1} label`}
                  />
                  <div className="relative">
                    <Input
                      value={link.url}
                      onChange={(event) =>
                        updateDocumentLink(link.id, "url", event.target.value)
                      }
                      placeholder="Link (or use Add files)"
                      className={`${DOCUMENT_INPUT_CLASS} pr-8`}
                      aria-label={`RFQ document ${index + 1} URL`}
                    />
                    {cleanText(link.url) !== null && (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                        aria-label={`Open RFQ document ${index + 1}`}
                      >
                        <IconExternalLink className="size-4" />
                      </a>
                    )}
                  </div>
                  <Input
                    value={link.notes}
                    onChange={(event) =>
                      updateDocumentLink(link.id, "notes", event.target.value)
                    }
                    placeholder="Sheet range, revision, access note"
                    className={DOCUMENT_INPUT_CLASS}
                    aria-label={`RFQ document ${index + 1} notes`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    disabled={documentLinks.length === 1}
                    onClick={() => removeDocumentLink(link.id)}
                    aria-label={`Remove RFQ document ${index + 1}`}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
  )
}
