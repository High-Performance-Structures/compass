"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconMailForward,
  IconPaperclip,
  IconPlus,
  IconUpload,
} from "@tabler/icons-react"

import { getUploadSessionUrl } from "@/app/actions/google-drive"
import {
  createProjectRfi,
  type ProjectRfiAttachmentInput,
} from "@/app/actions/project-rfis"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableComboboxField } from "@/components/searchable-combobox"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  RFI_CONTACT_GROUPS,
  type RfiContactOption,
} from "@/lib/rfis/contact-options"

type ProjectRfiCreateFormProps = {
  readonly projectId: string
  readonly projectDriveFolderId: string | null
  readonly companyOrTradeOptions: readonly string[]
  readonly peopleOptions: readonly RfiContactOption[]
}

const DOCUMENT_INPUT_CLASS =
  "rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:ring-0 focus-visible:border-foreground"
const DOCUMENT_SELECT_CLASS =
  "h-9 w-full rounded-none border-x-0 border-t-0 bg-background px-0 text-sm shadow-none outline-none focus:border-foreground"

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

function cleanText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function selectedOrTyped(
  formData: FormData,
  selectName: string,
  customName: string
): string | null {
  return (
    cleanText(formText(formData, customName)) ??
    cleanText(formText(formData, selectName))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function recordString(
  record: Record<string, unknown>,
  key: string
): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function uploadRfiAttachment(
  file: File,
  projectDriveFolderId: string | null
): Promise<ProjectRfiAttachmentInput> {
  const mimeType = file.type || "application/octet-stream"
  const uploadSession = await getUploadSessionUrl(
    file.name,
    mimeType,
    projectDriveFolderId ?? undefined
  )

  if (!uploadSession.success) {
    throw new Error(uploadSession.error)
  }

  const response = await fetch(uploadSession.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
  })

  if (!response.ok) {
    throw new Error(`Upload failed for ${file.name}`)
  }

  const responseText = await response.text()
  const parsed = parseJson(responseText)
  const record = isRecord(parsed) ? parsed : {}

  return {
    fileName: file.name,
    mimeType,
    fileSize: file.size,
    storageProvider: "google_drive",
    storageId: recordString(record, "id"),
    storageUrl: recordString(record, "webViewLink"),
  }
}

export function ProjectRfiCreateForm({
  projectId,
  projectDriveFolderId,
  companyOrTradeOptions,
  peopleOptions,
}: ProjectRfiCreateFormProps): React.ReactElement {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [selectedFiles, setSelectedFiles] = React.useState<readonly File[]>([])
  const [message, setMessage] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    const form = formRef.current
    if (!form) return

    setSubmitting(true)
    setMessage(null)

    try {
      const formData = new FormData(form)
      const attachments: ProjectRfiAttachmentInput[] = []

      for (const file of selectedFiles) {
        attachments.push(await uploadRfiAttachment(file, projectDriveFolderId))
      }

      const result = await createProjectRfi(projectId, {
        subject: formText(formData, "subject"),
        question: formText(formData, "question"),
        priority: formText(formData, "priority"),
        audience: formText(formData, "audience"),
        requesterName: selectedOrTyped(
          formData,
          "requesterNameSelect",
          "requesterNameCustom"
        ),
        assignedToName: selectedOrTyped(
          formData,
          "assignedToNameSelect",
          "assignedToNameCustom"
        ),
        companyName: selectedOrTyped(
          formData,
          "companyNameSelect",
          "companyNameCustom"
        ),
        dueDate: cleanText(formText(formData, "dueDate")),
        attachments,
      })

      if (!result.success) {
        throw new Error(result.error)
      }

      form.reset()
      setSelectedFiles([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      setMessage("RFI created.")
      setOpen(false)
      router.push(
        `/dashboard/projects/${projectId}/rfis?created=${encodeURIComponent(
          result.id
        )}`
      )
      router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create RFI.")
    } finally {
      setSubmitting(false)
    }
  }

  function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ): void {
    const files = event.currentTarget.files
    setSelectedFiles(files ? Array.from(files) : [])
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button">
          <IconPlus className="size-4" />
          New RFI
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(94vw,720px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Create RFI</SheetTitle>
          <SheetDescription>
            Capture the question, assignment, due date, visibility, and any
            supporting photos or documents.
          </SheetDescription>
        </SheetHeader>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-3 px-5 pb-6"
        >
        <Input
          name="subject"
          placeholder="Subject"
          required
          className={DOCUMENT_INPUT_CLASS}
        />
        <Textarea
          name="question"
          placeholder="Question, scope gap, or clarification needed"
          required
          className={`min-h-28 ${DOCUMENT_INPUT_CLASS}`}
        />
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Company or trade
            </label>
            <SearchableComboboxField
              name="companyNameSelect"
              ariaLabel="Company or trade"
              placeholder="Choose from project contacts"
              searchPlaceholder="Search companies and trades..."
              className={DOCUMENT_SELECT_CLASS}
              options={companyOrTradeOptions.map((option) => ({
                value: option,
                label: option,
              }))}
            />
            <Input
              name="companyNameCustom"
              placeholder="Or type company/trade"
              className={`mt-2 ${DOCUMENT_INPUT_CLASS}`}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Assigned to
              </label>
              <SearchableComboboxField
                name="assignedToNameSelect"
                ariaLabel="Assigned to"
                placeholder="Choose project contact"
                searchPlaceholder="Search project contacts..."
                className={DOCUMENT_SELECT_CLASS}
                options={peopleOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: RFI_CONTACT_GROUPS.find((group) => group.value === option.group)?.label,
                }))}
              />
              <Input
                name="assignedToNameCustom"
                placeholder="Or type assignee"
                className={`mt-2 ${DOCUMENT_INPUT_CLASS}`}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Requested by
              </label>
              <SearchableComboboxField
                name="requesterNameSelect"
                ariaLabel="Requested by"
                placeholder="Choose project contact"
                searchPlaceholder="Search project contacts..."
                className={DOCUMENT_SELECT_CLASS}
                options={peopleOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: RFI_CONTACT_GROUPS.find((group) => group.value === option.group)?.label,
                }))}
              />
              <Input
                name="requesterNameCustom"
                placeholder="Or type requester"
                className={`mt-2 ${DOCUMENT_INPUT_CLASS}`}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="rfi-due-date"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Response needed by
            </label>
            <Input
              id="rfi-due-date"
              name="dueDate"
              type="date"
              className={DOCUMENT_INPUT_CLASS}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            name="priority"
            defaultValue="normal"
            className={DOCUMENT_SELECT_CLASS}
          >
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
            <option value="low">Low priority</option>
          </select>
          <select
            name="audience"
            defaultValue="internal"
            className={DOCUMENT_SELECT_CLASS}
          >
            <option value="internal">Internal only</option>
            <option value="sub_vendor">Sub/vendor visible</option>
            <option value="owner">Owner visible</option>
            <option value="public">Owner and sub/vendor visible</option>
          </select>
        </div>
        <div className="border-t pt-3">
          <label className="flex items-start gap-2 text-sm font-medium">
            <IconPaperclip className="mt-0.5 size-4 text-muted-foreground" />
            <span>
              Attach photos or documents
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Files upload to the project Drive folder when one is mapped.
              </span>
            </span>
          </label>
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={handleFileChange}
            className={`mt-3 ${DOCUMENT_INPUT_CLASS}`}
          />
          {selectedFiles.length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              {selectedFiles.map((file) => (
                <div key={`${file.name}-${file.size}`} className="flex gap-2">
                  <IconUpload className="size-3.5 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t pt-3">
          <div className="flex items-start gap-2">
            <IconMailForward className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Assignee notification</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Next step: queue this RFI to the assigned contact through their
                Compass, email, or text preference once notification preferences
                are connected.
              </p>
            </div>
          </div>
        </div>
        {message && (
          <p className="border-l-2 border-l-primary px-3 py-2 text-xs text-muted-foreground">
            {message}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create RFI"}
          </Button>
        </div>
      </form>
      </SheetContent>
    </Sheet>
  )
}
