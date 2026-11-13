"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconAlertTriangle, IconArrowBackUp, IconBan, IconMail, IconRefresh, IconSend } from "@tabler/icons-react"
import { toast } from "sonner"

import { emailProjectInvoice } from "@/app/actions/project-invoice-email"
import { confirmProjectInvoiceNotInSage, reopenProjectInvoice, sendProjectInvoiceToSage, voidProjectInvoice } from "@/app/actions/project-invoices"
import type { ProjectInvoiceEditor } from "@/app/actions/project-invoice-views"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import { formatCents, formatDate, formatDateTime } from "@/lib/format"

/*
 * A final invoice going out: Send to Sage (Sage posts an AR invoice as soon
 * as it saves it), Email (from the invoice mailbox, with the PDF, and with
 * Square's payment link when Create Square invoice is checked), the Square
 * invoice's state, Reopen while nothing went out, and Void.
 */

const SAGE_LABELS: Readonly<Record<string, string>> = {
  queued: "Queued for Sage",
  running: "Sending to Sage",
  succeeded: "In Sage",
  failed: "Sage didn't take it",
  needs_attention: "Needs attention",
  cancelled: "Not sent",
}

const SENDING_REFRESH_MS = 10_000

export function InvoiceSendPanel({ editor }: { readonly editor: ProjectInvoiceEditor }): React.ReactElement {
  const router = useRouter()
  const { invoice, sage, project } = editor
  const [pending, startTransition] = React.useTransition()
  const [confirmSage, setConfirmSage] = React.useState(false)
  const [emailOpen, setEmailOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [voidReason, setVoidReason] = React.useState("")
  const sageStatus = sage.export?.status ?? null
  const sending = sageStatus === "queued" || sageStatus === "running"
  const attention = sageStatus === "needs_attention" || sageStatus === "failed"
  useVisibleInterval(() => router.refresh(), SENDING_REFRESH_MS, { enabled: sending, immediate: false })
  const isVoid = invoice.status === "void"
  const squareWaitingForSage = invoice.squareRequested && !invoice.squarePublicUrl && sageStatus !== "succeeded"

  function sendToSage(): void {
    startTransition(async () => {
      const result = await sendProjectInvoiceToSage(project.id, invoice.id)
      setConfirmSage(false)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.data.status === "needs_attention") toast.warning(result.data.reason ?? "The Sage invoice needs attention.")
      else toast.success("Sent to Sage. This updates when Sage finishes.")
      router.refresh()
    })
  }

  function reopen(): void {
    startTransition(async () => {
      const result = await reopenProjectInvoice(project.id, invoice.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Invoice reopened as a draft.")
      router.refresh()
    })
  }

  function confirmNotInSage(): void {
    if (!window.confirm("You checked Sage and this invoice isn't there? Compass then lets you reopen or void it as if it never reached Sage.")) return
    startTransition(async () => {
      const result = await confirmProjectInvoiceNotInSage(project.id, invoice.id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Noted: the invoice isn't in Sage.")
      router.refresh()
    })
  }

  function voidInvoice(): void {
    startTransition(async () => {
      const result = await voidProjectInvoice(project.id, invoice.id, voidReason)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setVoidOpen(false)
      if (result.data.notes.length > 0) toast.warning(result.data.notes.join(" "))
      else toast.success("Invoice voided.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="invoice-sage-heading" className="space-y-3 border-y py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="invoice-sage-heading" className="text-sm font-semibold">Sage AR invoice</h2>
            <Badge variant={attention ? "destructive" : sageStatus === "succeeded" ? "secondary" : "outline"} className="gap-1">
              {sending ? <IconRefresh className="size-3.5 animate-spin" aria-hidden /> : null}
              {attention ? <IconAlertTriangle className="size-3.5" aria-hidden /> : null}
              {sageStatus ? SAGE_LABELS[sageStatus] ?? sageStatus : "Not sent"}
            </Badge>
            {sage.sageJobNumber ? <span className="text-xs text-muted-foreground">Sage job #{sage.sageJobNumber}</span> : null}
          </div>
          {sage.canSend && !isVoid ? (
            <Button type="button" size="sm" variant={attention ? "default" : "outline"} disabled={pending} onClick={() => setConfirmSage(true)}>
              <IconSend className="size-4" aria-hidden />
              {attention ? "Retry" : "Send to Sage"}
            </Button>
          ) : null}
        </div>
        {attention && sage.export?.errorMessage ? <p className="text-sm text-destructive">{sage.export.errorMessage}</p> : null}
        {attention && sage.export?.possiblyInSage && !sage.export.sageRecordId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sage may have this invoice. Check Sage before reopening it.</span>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={confirmNotInSage}>
              I checked Sage: it isn't there
            </Button>
          </div>
        ) : null}
        {sage.blockers.length > 0 && sageStatus !== "succeeded" && !isVoid ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {sage.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
        <SagePreview editor={editor} />
        <p className="text-xs text-muted-foreground">
          {sage.export?.completedAt && sageStatus === "succeeded"
            ? `Added to Sage ${formatDateTime(sage.export.completedAt)}${sage.export.sageRecordId ? ` (Sage record ${sage.export.sageRecordId})` : ""}.`
            : !sage.writesEnabled
              ? "Sending invoices to Sage isn't turned on for this company yet."
              : "Sage posts an AR invoice to the ledger as soon as it saves it."}
        </p>
      </section>

      <section aria-labelledby="invoice-email-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="invoice-email-heading" className="text-sm font-semibold">Email the customer</h2>
            <p className="text-xs text-muted-foreground">
              {invoice.emailedAt ? `Emailed ${formatDateTime(invoice.emailedAt)}. ` : ""}
              From {editor.email.senderAddress ?? "your own mailbox (set the invoice mailbox in Settings › Workflows › Simple invoices)"}. Replies come back to this invoice in Compass.
            </p>
          </div>
          {!isVoid && (
            <Button type="button" size="sm" disabled={pending || squareWaitingForSage} onClick={() => setEmailOpen(true)} title={squareWaitingForSage ? "Square invoices go out once the invoice is in Sage." : undefined}>
              <IconMail className="size-4" aria-hidden />
              {invoice.squareRequested && !invoice.squarePublicUrl ? "Create Square invoice and email" : invoice.emailedAt ? "Email again" : "Email invoice"}
            </Button>
          )}
        </div>
        {invoice.squareRequested && (
          <div className="text-sm">
            <span className="font-medium">Square: </span>
            {invoice.squarePublicUrl ? (
              <a href={invoice.squarePublicUrl} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
                {invoice.squareState === "canceled" ? "canceled" : "payment page"}
              </a>
            ) : invoice.squareState === "failed" ? (
              <span className="text-destructive">{invoice.squareError ?? "Square didn't create the invoice."}</span>
            ) : squareWaitingForSage ? (
              <span className="text-muted-foreground">waits until the invoice is in Sage (its card fee posts to Sage against it).</span>
            ) : (
              <span className="text-muted-foreground">created when you email the invoice.</span>
            )}
          </div>
        )}
      </section>

      {!isVoid && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {editor.actions.canReopen && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={reopen}>
              <IconArrowBackUp className="size-4" aria-hidden />
              Reopen as draft
            </Button>
          )}
          {editor.actions.canVoid && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setVoidOpen(true)}>
              <IconBan className="size-4" aria-hidden />
              Void invoice
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={confirmSage} onOpenChange={setConfirmSage}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send invoice {invoice.invoiceNumber} to Sage?</AlertDialogTitle>
            <AlertDialogDescription>
              Sage posts an AR invoice to the ledger as soon as it saves it ({formatCents(sage.netDueCents)}, {sage.lines.length} lines). Check the lines and the taxable column first; changing it afterwards means a correction in Sage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={sendToSage}>Send and post in Sage</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void invoice {invoice.invoiceNumber}?</DialogTitle>
            <DialogDescription>
              The invoice stays on record as void and can&apos;t be used again. If it is already in Sage, void it in Sage too. A Square invoice is canceled in Square.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-void-reason">Why</Label>
            <Input id="invoice-void-reason" value={voidReason} maxLength={500} onChange={(event) => setVoidReason(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVoidOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" disabled={pending || !voidReason.trim()} onClick={voidInvoice}>
              Void invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InvoiceEmailDialog editor={editor} open={emailOpen} onOpenChange={setEmailOpen} />
    </div>
  )
}

function SagePreview({ editor }: { readonly editor: ProjectInvoiceEditor }): React.ReactElement {
  const { sage } = editor
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">
        {sage.description || "Invoice"}: {sage.lines.length} lines, {formatCents(sage.netDueCents)}
        {sage.dueDate ? `, due ${formatDate(sage.dueDate)}` : ""}
      </summary>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="border-b py-1 pr-2 font-medium">Sage cost code</th>
              <th className="border-b py-1 pr-2 font-medium">Description</th>
              <th className="border-b py-1 pr-2 font-medium">Taxable</th>
              <th className="border-b py-1 text-right font-medium">To Sage</th>
            </tr>
          </thead>
          <tbody>
            {sage.lines.map((line) => (
              <tr key={line.key}>
                <td className="border-b py-1 pr-2 align-top">
                  {line.sageCostCodeRecord ? `${line.sageCostCodeName ?? line.costCode} (#${line.sageCostCodeRecord})` : <span className="text-destructive">{line.costCode}: no Sage cost code record</span>}
                </td>
                <td className="border-b py-1 pr-2 align-top">{line.description}</td>
                <td className="border-b py-1 pr-2 align-top">{line.taxable ? "Yes" : "No"}</td>
                <td className="border-b py-1 text-right align-top tabular-nums">{formatCents(line.amountCents)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1" colSpan={3}>Lines</td>
              <td className="py-1 text-right tabular-nums">{formatCents(sage.linesTotalCents)}</td>
            </tr>
            {sage.expectedSalesTaxCents !== 0 && (
              <tr>
                <td className="py-1" colSpan={3}>Sales tax Sage adds{sage.taxDistrictName ? ` (${sage.taxDistrictName})` : ""}</td>
                <td className="py-1 text-right tabular-nums">{formatCents(sage.expectedSalesTaxCents)}</td>
              </tr>
            )}
            <tr>
              <td className="py-1 font-medium" colSpan={3}>Invoice total</td>
              <td className="py-1 text-right font-medium tabular-nums">{formatCents(sage.netDueCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  )
}

function InvoiceEmailDialog({ editor, open, onOpenChange }: { readonly editor: ProjectInvoiceEditor; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }): React.ReactElement {
  const router = useRouter()
  const { invoice, project } = editor
  const [to, setTo] = React.useState<readonly string[]>(editor.email.suggestedTo)
  const [cc, setCc] = React.useState<readonly string[]>([])
  const [subject, setSubject] = React.useState(`Invoice ${invoice.invoiceNumber ?? ""} - ${project.projectNumber ? `${project.name} (${project.projectNumber})` : project.name}`.slice(0, 300))
  const [message, setMessage] = React.useState("Hello,\n\nPlease find your invoice attached. Thank you for your business.")
  const [pending, startTransition] = React.useTransition()
  const withSquare = invoice.squareRequested && !invoice.squarePublicUrl

  function send(): void {
    startTransition(async () => {
      const result = await emailProjectInvoice(project.id, invoice.id, { to, cc, subject, message })
      if (!result.success) {
        toast.error(result.error)
        router.refresh()
        return
      }
      onOpenChange(false)
      toast.success(result.data.squareUrl ? "Square invoice created and the invoice emailed with its payment link." : "Invoice emailed.")
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Email invoice {invoice.invoiceNumber}</DialogTitle>
          <DialogDescription>
            {withSquare
              ? "Compass creates the Square invoice first (Square sends nothing), then sends this email with the PDF and the payment link."
              : "The invoice PDF is attached."}{" "}
            Replies come back to this invoice in Compass and to the sending mailbox.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <EmailRecipientPicker id="invoice-email-to" label="To" options={editor.email.recipients} value={to} onChange={setTo} required />
          <EmailRecipientPicker id="invoice-email-cc" label="Cc" options={editor.email.recipients} value={cc} onChange={setCc} excludedEmails={to} />
          <div className="space-y-1.5">
            <Label htmlFor="invoice-email-subject">Subject</Label>
            <Input id="invoice-email-subject" value={subject} maxLength={300} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoice-email-message">Message</Label>
            <Textarea id="invoice-email-message" rows={5} value={message} onChange={(event) => setMessage(event.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">The invoice total, due date{withSquare ? " and the Square payment link are" : " are"} added below your message.</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending || to.length === 0 || !subject.trim()} onClick={send}>
            {pending ? "Sending…" : withSquare ? "Create Square invoice and send" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
