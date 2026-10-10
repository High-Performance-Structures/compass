"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconMail } from "@tabler/icons-react"
import { toast } from "sonner"
import { getNuTechEmailDraft, sendNuTechEmail, type NuTechEmailDraft } from "@/app/actions/nutech-emails"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { nuTechTemplatesFor } from "@/lib/nutech/email-templates"
import type { NuTechStepId } from "@/lib/nutech/order-steps"

const AUDIENCE_LABEL = {
  customer: "Customer",
  manufacturer: "Manufacturer",
  warehouse: "Warehouse",
  carrier: "Carrier",
} as const

/**
 * The emails for a Nu-Tech job: this step's suggested templates as buttons,
 * every other template in a picker. Each opens filled in for review, then
 * sends from the company's Nu-Tech mailbox.
 */
export function NuTechEmailMenu({
  projectId,
  step,
  fulfillment,
}: {
  readonly projectId: string
  readonly step: NuTechStepId | null
  readonly fulfillment: "delivery" | "pickup" | null
}): React.ReactElement {
  const router = useRouter()
  const { suggested, other } = nuTechTemplatesFor(step, fulfillment)
  const [draft, setDraft] = React.useState<NuTechEmailDraft | null>(null)
  const [loadingId, setLoadingId] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const [error, setError] = React.useState<string | null>(null)
  const formRef = React.useRef<HTMLFormElement | null>(null)

  const open = (templateId: string): void => {
    setLoadingId(templateId)
    setError(null)
    void getNuTechEmailDraft(projectId, templateId).then((result) => {
      setLoadingId(null)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setDraft(result.data)
    })
  }

  const send = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await sendNuTechEmail(form)
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
                <DialogDescription>
                  To the {AUDIENCE_LABEL[draft.audience].toLowerCase()}, from{" "}
                  {draft.senderAddress || "the Nu-Tech mailbox (not set yet: Settings → Workflows → Nu-Tech emails)"}.
                  {draft.audience === "customer" ? " Sending logs it as a client contact." : ""}
                </DialogDescription>
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
                <div className="space-y-1.5">
                  <Label htmlFor="nutech-email-to">To</Label>
                  <Input id="nutech-email-to" name="to" defaultValue={draft.to.join(", ")} placeholder="name@example.com" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nutech-email-cc">Cc</Label>
                  <Input id="nutech-email-cc" name="cc" defaultValue={draft.cc.join(", ")} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nutech-email-subject">Subject</Label>
                <Input id="nutech-email-subject" name="subject" defaultValue={draft.subject} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nutech-email-body">Message</Label>
                <Textarea id="nutech-email-body" name="body" defaultValue={draft.body} rows={14} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nutech-email-attachments">Attachments</Label>
                <Input id="nutech-email-attachments" name="attachments" type="file" multiple />
                <p className="text-xs text-muted-foreground">
                  Estimate PDF, order form, trailer photo, price sheets. Up to 15 MB in total.
                </p>
              </div>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
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
