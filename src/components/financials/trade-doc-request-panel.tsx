"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getTradeDocRequestPanel,
  sendTradeDocRequest,
  turnOffTradeDocLink,
  type TradeDocRequestPanel as PanelData,
} from "@/app/actions/vendor-trade-doc-requests"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/format"

/** "Oct 30, 2026"; blank when missing, the raw text when unreadable. */
function linkDate(value: string | null): string {
  return value ? formatDate(value, "medium", value) : ""
}

/**
 * Request docs from a vendor: a tracked email with a secure no-login link,
 * plus the links already sent and the replies that came back.
 */
export function TradeDocRequestPanel({
  vendorId,
  canEdit,
  onSent,
}: {
  readonly vendorId: string
  readonly canEdit: boolean
  readonly onSent: () => void
}): React.ReactElement {
  const [data, setData] = React.useState<PanelData | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [composing, setComposing] = React.useState(false)
  const [to, setTo] = React.useState<readonly string[]>([])
  const [cc, setCc] = React.useState<readonly string[]>([])
  const [subject, setSubject] = React.useState("")
  const [note, setNote] = React.useState("")
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(new Set())
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getTradeDocRequestPanel(vendorId)
    if (!result.success) {
      setError(result.error)
      return
    }
    setError(null)
    setData(result.data)
  }, [vendorId])

  React.useEffect(() => {
    void load()
  }, [load])

  function startCompose(): void {
    if (!data) return
    setTo(data.defaultTo)
    setCc([])
    setSubject(data.subject)
    setNote(data.note)
    setChosen(new Set(data.types.filter((type) => type.owed).map((type) => type.id)))
    setComposing(true)
  }

  function toggle(id: string, on: boolean): void {
    setChosen((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function send(): void {
    startTransition(async () => {
      const result = await sendTradeDocRequest(vendorId, { to, cc, subject, note, docTypes: [...chosen] })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Request sent. The link works until ${linkDate(result.data.expiresAt)}.`)
      setComposing(false)
      await load()
      onSent()
    })
  }

  function turnOff(linkId: string): void {
    startTransition(async () => {
      const result = await turnOffTradeDocLink(linkId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Link turned off.")
      await load()
    })
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data) return <p className="text-sm text-muted-foreground">Loading requests…</p>

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Requests and replies</h3>
        {canEdit && !composing && (
          <Button type="button" size="sm" onClick={startCompose}>Request docs</Button>
        )}
      </div>

      {composing && (
        <div className="grid gap-3 rounded-lg border p-3">
          <EmailRecipientPicker id="trade-doc-request-to" label="To" options={data.recipients} value={to} onChange={setTo} excludedEmails={cc} required />
          <EmailRecipientPicker id="trade-doc-request-cc" label="Cc" options={data.recipients} value={cc} onChange={setCc} excludedEmails={to} />
          <div className="grid gap-1.5">
            <Label htmlFor="trade-doc-request-subject">Subject</Label>
            <Input id="trade-doc-request-subject" maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">Ask for</legend>
            {data.types.map((type) => (
              <label key={type.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={chosen.has(type.id)} onCheckedChange={(checked) => toggle(type.id, checked === true)} />
                {type.label}
                {type.owed && <span className="text-xs text-muted-foreground">owed</span>}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="trade-doc-request-note">Note</Label>
            <Textarea id="trade-doc-request-note" rows={3} maxLength={3000} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            The email lists the documents, who certificates must name, and a secure link that works for {data.linkDays} days without
            an account. The vendor can upload, fill in the info sheet, and have the certificate details sent to their agent. Replies come
            back to this vendor&apos;s trade docs in Compass and to you.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending || to.length === 0 || chosen.size === 0} onClick={send}>
              {pending ? "Sending…" : "Send request"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setComposing(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {data.links.length === 0 && data.replies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests sent yet.</p>
      ) : (
        <ul className="grid gap-1.5 text-sm">
          {data.links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {link.audience === "agent" ? "Agent link" : "Link"} to {link.recipientEmail} · sent {linkDate(link.createdAt)} by {link.createdByName}
                {link.lastSubmittedAt ? ` · files received ${linkDate(link.lastSubmittedAt)}` : link.lastOpenedAt ? ` · opened ${linkDate(link.lastOpenedAt)}` : " · not opened yet"}
                {link.live ? ` · works until ${linkDate(link.expiresAt)}` : " · off"}
              </span>
              {canEdit && link.live && (
                <button type="button" className="text-xs text-destructive underline" disabled={pending} onClick={() => turnOff(link.id)}>
                  Turn off
                </button>
              )}
            </li>
          ))}
          {data.replies.map((reply) => (
            <li key={reply.id} className="grid gap-0.5 border-l-2 border-primary pl-2">
              <span className="text-xs text-muted-foreground">Reply · {linkDate(reply.receivedAt)}</span>
              <span>{reply.summary}</span>
              {reply.files.length > 0 && (
                <span className="text-xs text-muted-foreground">Saved: {reply.files.join(", ")}. Record each one with Upload on its line, choosing the saved file.</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
