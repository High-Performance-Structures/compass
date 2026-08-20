"use client"

import * as React from "react"
import { IconFilePlus, IconPaperclip } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  uploadChangeOrderDocuments,
  validateChangeOrderDocumentCount,
} from "@/components/projects/project-change-order-document-upload"
import {
  createProjectChangeOrder,
  type ProjectChangeOrderFormOptions,
} from "@/app/actions/project-change-orders"
import {
  changeOrderMoney,
  draftChangeOrderTotalCents,
  newDraftChangeOrderCostLine,
  ProjectChangeOrderCostLinesEditor,
  ProjectChangeOrderOptionPicker,
  toChangeOrderCostLineInput,
  type DraftChangeOrderCostLine,
} from "@/components/projects/project-change-order-cost-lines-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

const DOCUMENT_INPUT_CLASS =
  "rounded-none border-x-0 border-t-0 px-0 shadow-none focus-visible:border-foreground focus-visible:ring-0"
const DOCUMENT_SELECT_CLASS =
  "h-9 w-full rounded-none border-x-0 border-t-0 bg-background px-0 text-sm shadow-none outline-none focus:border-foreground"

function optionalText(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function requiredText(formData: FormData, name: string): string {
  return optionalText(formData, name) ?? ""
}

function scheduleImpactDays(formData: FormData): number | null {
  const value = optionalText(formData, "scheduleImpactDays")
  if (!value) return null
  return Number(value)
}

function Field({
  label,
  children,
}: {
  readonly label: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export function ProjectChangeOrderCreateForm({
  projectId,
  detailBaseHref,
  internal,
  formOptions,
}: {
  readonly projectId: string
  readonly detailBaseHref: string
  readonly internal: boolean
  readonly formOptions: ProjectChangeOrderFormOptions
}): React.ReactElement {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [open, setOpen] = React.useState(false)
  const [saving, startSaving] = React.useTransition()
  const [selectedFiles, setSelectedFiles] = React.useState<readonly File[]>([])
  const [requesterCompany, setRequesterCompany] = React.useState("")
  const [lines, setLines] = React.useState<readonly DraftChangeOrderCostLine[]>([
    newDraftChangeOrderCostLine(),
  ])
  const totalCents = draftChangeOrderTotalCents(lines)

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = formRef.current
    if (!form) return
    const formData = new FormData(form)
    startSaving(async () => {
      try {
        validateChangeOrderDocumentCount(0, selectedFiles)
        const documents = await uploadChangeOrderDocuments(selectedFiles, projectId)
        const result = await createProjectChangeOrder(projectId, {
          title: requiredText(formData, "title"),
          scope: requiredText(formData, "scope"),
          reason: optionalText(formData, "reason"),
          scheduleImpactDays: scheduleImpactDays(formData),
          lines: lines.map(toChangeOrderCostLineInput),
          audience:
            optionalText(formData, "audience") === "owner"
              ? "owner"
              : optionalText(formData, "audience") === "sub_vendor"
                ? "sub_vendor"
                : "internal",
          requesterCompany: requesterCompany.trim() || null,
          sourceRecordId: null,
          sourceHref: null,
          initialStatus:
            optionalText(formData, "initialStatus") === "submitted"
              ? "submitted"
              : "draft",
          documents,
        })
        if (!result.success) throw new Error(result.error)

        setOpen(false)
        setRequesterCompany("")
        setLines([newDraftChangeOrderCostLine()])
        setSelectedFiles([])
        if (fileInputRef.current) fileInputRef.current.value = ""
        form.reset()
        toast.success("Change order request created.")
        router.push(`${detailBaseHref}/${encodeURIComponent(result.id)}`)
        router.refresh()
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not create change order."
        )
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <IconFilePlus className="size-4" />
          Request change
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,1180px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Request a change order</SheetTitle>
          <SheetDescription>
            Describe the scope, code each cost line, and record any schedule
            impact. This does not approve work or send anything externally.
          </SheetDescription>
        </SheetHeader>
        <form
          ref={formRef}
          onSubmit={submit}
          className="space-y-5 px-5 pb-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
            <span className="font-medium">Draft change request</span>
            <span className="text-muted-foreground">
              {changeOrderMoney(totalCents)} total · schedule impact entered below
            </span>
          </div>

          <div className="space-y-4">
            <Field label="Change order title">
              <Input
                id="change-order-title"
                name="title"
                required
                placeholder="Owner-requested kitchen revision"
                className={DOCUMENT_INPUT_CLASS}
              />
            </Field>
            <Field label="Requested scope">
              <Textarea
                id="change-order-scope"
                name="scope"
                rows={5}
                required
                placeholder="Describe what should change and the desired result."
                className={`min-h-28 ${DOCUMENT_INPUT_CLASS}`}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reason">
                <Textarea
                  id="change-order-reason"
                  name="reason"
                  rows={3}
                  className={DOCUMENT_INPUT_CLASS}
                />
              </Field>
              <div className="grid content-start gap-4">
                <Field label="Requesting company">
                  <ProjectChangeOrderOptionPicker
                    value={requesterCompany}
                    options={formOptions.companies}
                    placeholder="Company"
                    ariaLabel="Choose requesting company"
                    disabled={false}
                    onValueChange={setRequesterCompany}
                  />
                </Field>
                <Field label="Schedule impact (days)">
                  <Input
                    id="change-order-schedule-impact"
                    name="scheduleImpactDays"
                    type="number"
                    min="0"
                    max="3650"
                    step="1"
                    inputMode="numeric"
                    placeholder="0"
                    className={DOCUMENT_INPUT_CLASS}
                  />
                </Field>
              </div>
            </div>
          </div>

          <ProjectChangeOrderCostLinesEditor
            lines={lines}
            phaseOptions={formOptions.phases}
            costCodeOptions={formOptions.costCodes}
            onLinesChange={setLines}
          />

          {internal && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Audience">
                <select
                  id="change-order-audience"
                  name="audience"
                  className={DOCUMENT_SELECT_CLASS}
                  defaultValue="internal"
                >
                  <option value="internal">Internal only</option>
                  <option value="owner">Owner visible when approved</option>
                  <option value="sub_vendor">Sub/vendor request</option>
                </select>
              </Field>
              <Field label="Save as">
                <select
                  id="change-order-initial-status"
                  name="initialStatus"
                  className={DOCUMENT_SELECT_CLASS}
                  defaultValue="draft"
                >
                  <option value="draft">Draft</option>
                  <option value="submitted">Submitted for triage</option>
                </select>
              </Field>
            </div>
          )}

          <div className="border-t pt-4">
            <label className="flex items-start gap-2 text-sm font-medium">
              <IconPaperclip className="mt-0.5 size-4 text-muted-foreground" />
              <span>
                Supporting documents
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Upload photos, proposals, drawings, or other change-order files
                  to the project Drive folder.
                </span>
              </span>
            </label>
            <Input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              className="mt-3"
              onChange={(event) => {
                const files = event.currentTarget.files
                setSelectedFiles(files ? Array.from(files) : [])
              }}
            />
            {selectedFiles.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} selected
              </p>
            )}
          </div>

          <SheetFooter className="border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? "Creating…"
                : internal
                  ? "Create request"
                  : "Submit request"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
