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
import { Textarea } from "@/components/ui/textarea"

type ProjectRfiCreateFormProps = {
  readonly projectId: string
  readonly projectDriveFolderId: string | null
  readonly companyOrTradeOptions: readonly string[]
  readonly peopleOptions: readonly string[]
}

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
    <section className="rounded-lg border bg-background p-4">
      <div className="flex items-center gap-2">
        <IconPlus className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Create RFI</h2>
      </div>
      <form ref={formRef} onSubmit={handleSubmit} className="mt-4 space-y-3">
        <Input name="subject" placeholder="Subject" required />
        <Textarea
          name="question"
          placeholder="Question, scope gap, or clarification needed"
          required
          className="min-h-28"
        />
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Company or trade
            </label>
            <select
              name="companyNameSelect"
              defaultValue=""
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Choose from project contacts</option>
              {companyOrTradeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Input
              name="companyNameCustom"
              placeholder="Or type company/trade"
              className="mt-2"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Assigned to
              </label>
              <select
                name="assignedToNameSelect"
                defaultValue=""
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Choose project contact</option>
                {peopleOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <Input
                name="assignedToNameCustom"
                placeholder="Or type assignee"
                className="mt-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Requested by
              </label>
              <select
                name="requesterNameSelect"
                defaultValue=""
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Choose project contact</option>
                {peopleOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <Input
                name="requesterNameCustom"
                placeholder="Or type requester"
                className="mt-2"
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
            <Input id="rfi-due-date" name="dueDate" type="date" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            name="priority"
            defaultValue="normal"
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
            <option value="low">Low priority</option>
          </select>
          <select
            name="audience"
            defaultValue="internal"
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="internal">Internal only</option>
            <option value="sub_vendor">Sub/vendor visible</option>
            <option value="owner">Owner visible</option>
            <option value="public">Owner and sub/vendor visible</option>
          </select>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
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
            className="mt-3"
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
        <div className="rounded-md border bg-muted/20 p-3">
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
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Creating..." : "Create RFI"}
        </Button>
      </form>
    </section>
  )
}
