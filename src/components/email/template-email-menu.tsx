"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconMail } from "@tabler/icons-react"
import { toast } from "sonner"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { TemplateEmailDraft } from "@/lib/email/template-email"

export type { TemplateEmailDraft }

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

export type TemplateEmailOption = { readonly id: string; readonly label: string }

/**
 * Template emails for a job: this step's suggested templates as buttons,
 * every other template in a picker. Each opens filled in for review, then
 * sends through the given action. Shared by every department's workflow.
 */
export function TemplateEmailMenu({
  projectId,
  suggested,
  other,
  loadDraft,
  send: sendEmail,
  attachmentHint,
}: {
  readonly projectId: string
  readonly suggested: readonly TemplateEmailOption[]
  readonly other: readonly TemplateEmailOption[]
  readonly loadDraft: (projectId: string, templateId: string) => Promise<Result<TemplateEmailDraft>>
  readonly send: (form: FormData) => Promise<Result<{ readonly loggedContact: boolean }>>
  readonly attachmentHint: string
}): React.ReactElement {
  const router = useRouter()
  const [draft, setDraft] = React.useState<TemplateEmailDraft | null>(null)
  const [to, setTo] = React.useState<readonly string[]>([])
  const [cc, setCc] = React.useState<readonly string[]>([])
  const [loadingId, setLoadingId] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const formRef = React.useRef<HTMLFormElement | null>(null)

  const open = (templateId: string): void => {
    setLoadingId(templateId)
    setError(null)
    void loadDraft(projectId, templateId).then((result) => {
      setLoadingId(null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setTo(result.data.to)
      setCc(result.data.cc)
      setDraft(result.data)
    })
  }

  const send = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await sendEmail(form)
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.success(result.data.loggedContact ? "Email sent and logged as a client contact." : "Email sent.")
      setDraft(null)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-xs tracking-[0.12em] text-muted-foreground">EMAILS</span>
      <div className="flex flex-wrap items-center gap-2">
        {suggested.map((template) => (
          <Button
            key={template.id}
            type="button"
            size="sm"
            variant="outline"
            disabled={loadingId !== null}
            onClick={() => open(template.id)}
          >
            <IconMail aria-hidden="true" />
            {loadingId === template.id ? "Preparing…" : template.label}
          </Button>
        ))}
        <SearchableCombobox
          className="h-8 w-56 text-xs"
          value=""
          onValueChange={(value) => {
            if (value) open(value)
          }}
          options={other.map((template) => ({ value: template.id, label: template.label }))}
          ariaLabel="Other emails"
          placeholder={suggested.length > 0 ? "Other emails…" : "Choose an email…"}
          searchPlaceholder="Search emails..."
          emptyMessage="No matching emails."
        />
      </div>

      <Dialog open={draft !== null} onOpenChange={(next) => (next ? null : setDraft(null))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {draft ? (
            <form ref={formRef} onSubmit={send} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{draft.label}</DialogTitle>
                <DialogDescription>{draft.description}</DialogDescription>
              </DialogHeader>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="templateId" value={draft.templateId} />
              {draft.missing.length > 0 ? (
                <p className="border-l-2 border-warning bg-warning/10 px-3 py-2 text-sm">
                  Left blank because the job doesn&apos;t have them yet: {draft.missing.join(", ")}. Fill them in below or on
                  the job before sending.
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <EmailRecipientPicker
                  id="template-email-to"
                  label="To"
                  options={draft.recipientOptions}
                  value={to}
                  excludedEmails={cc}
                  onChange={setTo}
                  required
                />
                <EmailRecipientPicker
                  id="template-email-cc"
                  label="Cc"
                  options={draft.recipientOptions}
                  value={cc}
                  excludedEmails={to}
                  onChange={setCc}
                  placeholder="Choose an optional contact..."
                />
              </div>
              <input type="hidden" name="to" value={to.join(", ")} />
              <input type="hidden" name="cc" value={cc.join(", ")} />
              <div className="space-y-1.5">
                <Label htmlFor="template-email-subject">Subject</Label>
                <Input id="template-email-subject" name="subject" defaultValue={draft.subject} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="template-email-body">Message</Label>
                <Textarea id="template-email-body" name="body" defaultValue={draft.body} rows={14} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="template-email-attachments">Attachments</Label>
                <Input id="template-email-attachments" name="attachments" type="file" multiple />
                <p className="text-xs text-muted-foreground">
                  {attachmentHint} Up to 15 MB in total.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">Replies come back to this job in Compass and to the sending mailbox.</p>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || to.length === 0}>
                  {pending ? "Sending…" : "Send"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
