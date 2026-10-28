"use client"

import * as React from "react"

import { recordTradeDocLinkUpload, startTradeDocLinkUpload, submitTradeDocInfoSheet } from "@/app/actions/vendor-trade-doc-link"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { InfoSheetField } from "@/lib/trade-docs/settings"
import { TRADE_DOC_LINK_MAX_BYTES, TRADE_DOC_LINK_PATH, uploadedDriveFileId, type TradeDocLinkItemState } from "@/lib/trade-docs/vendor-link"
import type { TradeDocLinkItem, TradeDocLinkView } from "@/lib/trade-docs/vendor-link-server"
import { cn } from "@/lib/utils"

const STATE_LABELS: Readonly<Record<TradeDocLinkItemState, string>> = {
  needed: "Needed",
  renew: "Expiring soon",
  received: "Received, thank you",
  on_file: "On file",
}

const STATE_CLASS: Readonly<Record<TradeDocLinkItemState, string>> = {
  needed: "text-destructive",
  renew: "text-warning",
  received: "text-success",
  on_file: "text-success",
}

function longDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

/** One requested document: upload it, or the accepted alternative, with its expiry date. */
function ItemUpload({
  token,
  item,
  name,
  disabled,
  onReceived,
}: {
  readonly token: string
  readonly item: TradeDocLinkItem
  readonly name: string
  readonly disabled: boolean
  readonly onReceived: () => void
}): React.ReactElement {
  const [waiver, setWaiver] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)
  const [expiresOn, setExpiresOn] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const inputId = `vendor-doc-${item.typeId}`

  function upload(): void {
    setError(null)
    if (!file) {
      setError("Choose the file first.")
      return
    }
    if (file.size > TRADE_DOC_LINK_MAX_BYTES) {
      setError("Files can be up to 25 MB. Reply to the email with larger files.")
      return
    }
    const kind = waiver ? "waiver" : "document"
    startTransition(async () => {
      const session = await startTradeDocLinkUpload(token, { docType: item.typeId, kind, fileName: file.name, mimeType: file.type, size: file.size })
      if (!session.success) {
        setError(session.error)
        return
      }
      const response = await fetch(session.data.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }).catch(() => null)
      const driveFileId = response?.ok ? uploadedDriveFileId(await response.text()) : null
      if (!driveFileId) {
        setError("The upload didn't finish. Check your connection and try again.")
        return
      }
      const result = await recordTradeDocLinkUpload(token, { docType: item.typeId, kind, driveFileId, expiresOn: expiresOn || null, name: name || null })
      if (!result.success) {
        setError(result.error)
        return
      }
      setFile(null)
      onReceived()
    })
  }

  return (
    <div className="grid gap-3 pt-2">
      {item.waiverLabel && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={waiver} onCheckedChange={(checked) => setWaiver(checked === true)} className="mt-0.5" />
          <span>Instead, I&apos;m sending: {item.waiverLabel}</span>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor={inputId} className="text-xs text-muted-foreground">File (PDF or photo)</Label>
          <Input
            id={inputId}
            type="file"
            accept="application/pdf,image/*,.doc,.docx"
            disabled={disabled || pending}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        {item.expires && !waiver && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${inputId}-expires`} className="text-xs text-muted-foreground">Expires</Label>
            <Input id={`${inputId}-expires`} type="date" value={expiresOn} disabled={disabled || pending} onChange={(event) => setExpiresOn(event.target.value)} />
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={disabled || pending || !file} onClick={upload}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
        {item.hasForm && !waiver && (
          <a className="text-sm underline underline-offset-2" href={`${TRADE_DOC_LINK_PATH}/${token}/form/${encodeURIComponent(item.typeId)}`}>
            Download the blank form
          </a>
        )}
        {item.hasWaiverForm && waiver && (
          <a className="text-sm underline underline-offset-2" href={`${TRADE_DOC_LINK_PATH}/${token}/form/${encodeURIComponent(item.typeId)}?alternative=1`}>
            Download the blank forms
          </a>
        )}
      </div>
    </div>
  )
}

function InfoSheetInput({
  field,
  value,
  onChange,
  disabled,
}: {
  readonly field: InfoSheetField
  readonly value: string
  readonly onChange: (value: string) => void
  readonly disabled: boolean
}): React.ReactElement {
  const id = `info-${field.id}`
  const label = (
    <Label htmlFor={id}>
      {field.label}
      {field.required ? null : <span className="font-normal text-muted-foreground"> (optional)</span>}
    </Label>
  )
  if (field.kind === "long_text") {
    return (
      <div className="grid gap-1.5 sm:col-span-2">
        {label}
        <Textarea id={id} rows={3} maxLength={1000} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </div>
    )
  }
  if (field.kind === "choice" || field.kind === "yes_no") {
    const options = field.kind === "yes_no" ? ["Yes", "No"] : field.options
    return (
      <div className="grid gap-1.5">
        {label}
        <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  return (
    <div className="grid gap-1.5">
      {label}
      <Input
        id={id}
        type={field.kind === "email" ? "email" : field.kind === "phone" ? "tel" : "text"}
        inputMode={field.kind === "phone" ? "tel" : field.kind === "email" ? "email" : undefined}
        maxLength={200}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/**
 * The vendor's (or their insurance agent's) side of a docs link: what's
 * needed, an upload for each, blank forms, the online info sheet, and who
 * certificates must name.
 */
export function VendorDocsLinkForm({ token, view }: { readonly token: string; readonly view: TradeDocLinkView }): React.ReactElement {
  const [items, setItems] = React.useState(view.items)
  const [uploadsLeft, setUploadsLeft] = React.useState(view.uploadsLeft)
  const [open, setOpen] = React.useState<string | null>(null)
  const [name, setName] = React.useState("")
  const [answers, setAnswers] = React.useState<Readonly<Record<string, string>>>({})
  const [signerTitle, setSignerTitle] = React.useState("")
  const [sendToAgent, setSendToAgent] = React.useState(true)
  const [sheetError, setSheetError] = React.useState<string | null>(null)
  const [sheetDone, setSheetDone] = React.useState<{ readonly agentEmailed: string | null; readonly agentError: string | null } | null>(null)
  const [pending, startTransition] = React.useTransition()

  const agentField = view.infoSheet?.fields.find((field) => field.purpose === "agent_email")
  const agentEmail = agentField ? answers[agentField.id]?.trim() ?? "" : ""
  const needed = items.filter((item) => item.state === "needed" || item.state === "renew").length
  const isAgent = view.audience === "agent"

  function received(typeId: string): void {
    setItems((current) => current.map((item) => (item.typeId === typeId ? { ...item, state: "received" } : item)))
    setUploadsLeft((current) => Math.max(0, current - 1))
    setOpen(null)
  }

  function submitSheet(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setSheetError(null)
    if (!name.trim()) {
      setSheetError("Type your name to sign.")
      return
    }
    startTransition(async () => {
      const result = await submitTradeDocInfoSheet(token, { answers, signerName: name, signerTitle, sendToAgent })
      if (!result.success) {
        setSheetError(result.error)
        return
      }
      setSheetDone(result.data)
      const sheetType = items.find((item) => item.online)
      if (sheetType) received(sheetType.typeId)
    })
  }

  return (
    <div className="grid gap-6 rounded-lg border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a company logo that may be an uploaded data URL */}
        <img src={view.logoSrc} alt="" className="size-10 shrink-0 object-contain" />
        <div className="grid gap-1">
          <p className="text-sm text-muted-foreground">{view.companyName}</p>
          <h1 className="text-2xl font-semibold text-balance">{isAgent ? "Certificates of insurance" : "Documents we need"}</h1>
          <p className="text-sm">For {view.vendorName}</p>
        </div>
      </div>

      {view.note && <p className="whitespace-pre-line text-sm">{view.note}</p>}
      <p className="text-sm text-muted-foreground">
        {needed === 0
          ? "Everything on this list is in. Thank you!"
          : `${needed} item${needed === 1 ? "" : "s"} still needed. No account is needed; files go straight to ${view.companyName}.`}
      </p>

      <div className="grid gap-1.5">
        <Label htmlFor="vendor-docs-name">Your name</Label>
        <Input id="vendor-docs-name" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="sm:max-w-sm" />
      </div>

      <div className="divide-y border-y">
        {items.map((item) => {
          const canUpload = !item.online && item.state !== "received" && uploadsLeft > 0
          return (
            <div key={item.typeId} className="grid gap-1 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 text-sm font-medium">{item.label}</p>
                <span className={cn("text-sm", STATE_CLASS[item.state])}>{STATE_LABELS[item.state]}</span>
                {canUpload && open !== item.typeId && (
                  <Button type="button" size="sm" variant={item.state === "on_file" ? "outline" : "default"} onClick={() => setOpen(item.typeId)}>
                    {item.state === "on_file" ? "Send a newer one" : "Upload"}
                  </Button>
                )}
              </div>
              {item.online && item.state !== "received" && (
                <p className="text-xs text-muted-foreground">Fill this in below.</p>
              )}
              {open === item.typeId && (
                <ItemUpload token={token} item={item} name={name} disabled={pending} onReceived={() => received(item.typeId)} />
              )}
            </div>
          )
        })}
      </div>
      {uploadsLeft === 0 && <p className="text-sm text-muted-foreground">This link has taken all the files it can. Reply to the email with anything else.</p>}

      {view.infoSheet && !sheetDone && (
        <form onSubmit={submitSheet} className="grid gap-4">
          <h2 className="text-lg font-semibold">Info sheet</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {view.infoSheet.fields.map((field) => (
              <InfoSheetInput
                key={field.id}
                field={field}
                value={answers[field.id] ?? ""}
                disabled={pending}
                onChange={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
              />
            ))}
          </div>
          {agentField && agentEmail && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={sendToAgent} onCheckedChange={(checked) => setSendToAgent(checked === true)} className="mt-0.5" />
              <span>Email our certificate holder details to my agent at {agentEmail}, with a link to upload the certificates</span>
            </label>
          )}
          <p className="text-sm">{view.infoSheet.certification}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="vendor-docs-signer">Signed (type your name)</Label>
              <Input id="vendor-docs-signer" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="vendor-docs-title">Title</Label>
              <Input id="vendor-docs-title" autoComplete="organization-title" maxLength={120} value={signerTitle} onChange={(event) => setSignerTitle(event.target.value)} />
            </div>
          </div>
          {sheetError && <p className="text-sm text-destructive" role="alert">{sheetError}</p>}
          <div>
            <Button type="submit" disabled={pending || uploadsLeft === 0}>{pending ? "Sending…" : "Sign and send"}</Button>
          </div>
        </form>
      )}
      {sheetDone && (
        <div className="grid gap-1 border-l-2 border-primary pl-3 text-sm">
          <p className="font-medium">Thanks, your info sheet was sent.</p>
          {sheetDone.agentEmailed && <p>We emailed your agent at {sheetDone.agentEmailed} with our certificate holder details.</p>}
          {sheetDone.agentError && <p className="text-destructive">{sheetDone.agentError}</p>}
        </div>
      )}

      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">Certificate holder</h2>
        <p className="text-xs text-muted-foreground">Insurance certificates must name:</p>
        <p className="whitespace-pre-line text-sm">{view.certificateHolder.join("\n")}</p>
      </div>

      <p className="text-xs text-muted-foreground">
        This private link from {view.senderName} works until {longDate(view.expiresAt)}. You can also reply to the email with files attached.
      </p>
      <p className="text-xs text-muted-foreground">
        {view.companyName}
        {view.companyContactLines.length > 0 ? ` · ${view.companyContactLines.join(" · ")}` : ""}
      </p>
    </div>
  )
}
