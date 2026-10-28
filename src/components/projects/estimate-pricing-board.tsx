"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import { getProjectTaskAssigneeOptions } from "@/app/actions/project-contacts"
import { getProjectContactsSummary } from "@/app/actions/project-contacts"
import {
  createEstimatePricingPackage,
  getEstimatePricingBoard,
  sendEstimatePricingPackage,
  type EstimatePricingBoardView,
} from "@/app/actions/estimate-pricing-board"
import { ProjectDriveFilePicker, type PickedProjectFile } from "@/components/projects/project-drive-file-picker"
import { EmailRecipientPicker } from "@/components/email/email-recipient-picker"
import { getEstimateSelectedTrades, type SelectedTrade } from "@/app/actions/estimate-bids"
import { EstimateLineBidsDialog } from "@/components/projects/estimate-line-bids-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  defaultPackageTitle,
  packageSelectionProblem,
  type PricingBoardLine,
  type PricingBoardRfq,
  type PricingBoardRfqStatus,
} from "@/lib/estimates/pricing-board"
import { buildProjectEmailRecipientOptions, type EmailRecipientOption } from "@/lib/email/recipient-options"

const RFQ_STATUS_LABEL: Readonly<Record<PricingBoardRfqStatus, string>> = {
  draft: "Draft",
  sent: "Sent",
  quoted: "Quote in",
  declined: "Declined",
  closed: "Closed",
}

type Recipient = { readonly key: string; readonly name: string; readonly email: string }

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function lineStatus(line: PricingBoardLine): string {
  switch (line.source.action) {
    case "rfq":
      if (line.rfqCount === 0) return "No RFQ yet"
      return `${line.rfqCount} RFQ${line.rfqCount === 1 ? "" : "s"} · ${line.quoteCount} quote${line.quoteCount === 1 ? "" : "s"} in`
    case "takeoff":
      return line.todo ? `Takeoff to-do · ${line.todo.assigneeName ?? "staff"} · ${line.todo.status.replace("_", " ")}` : "No takeoff to-do"
    case "owner_pricing":
      if (line.rfqCount === 0) return "Owner hasn't been asked yet"
      return line.quoteCount > 0 ? "Owner's number is in" : "Asked the owner"
  }
}

/** Who can be asked: owners for owner-scope lines, otherwise subs and suppliers. */
function vendorOptions(options: readonly ProjectTaskAssigneeOption[], forOwner: boolean): readonly Recipient[] {
  const seen = new Set<string>()
  return options.flatMap((option) => {
    const allowed = forOwner ? option.contactType === "owner" : option.contactType === "subcontractor" || option.contactType === "supplier"
    if (!allowed) return []
    const email = option.email?.trim().toLowerCase()
    if (!email || seen.has(email)) return []
    seen.add(email)
    const company = option.companyName?.trim()
    return [{ key: email, name: company || option.name, email }]
  })
}

/**
 * Estimate → Pricing requests: every line that needs a number from someone,
 * with the RFQs on this job that ask for it. Tick cost codes priced by the
 * same kind of vendor and send them out together as one package.
 */
export function EstimatePricingBoard({
  projectId,
  estimateId,
  editable,
  active,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly editable: boolean
  readonly active: boolean
}): React.ReactElement | null {
  const [view, setView] = React.useState<EstimatePricingBoardView | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [composing, setComposing] = React.useState(false)
  const [contacts, setContacts] = React.useState<readonly ProjectTaskAssigneeOption[] | null>(null)
  const [version, setVersion] = React.useState(0)
  const router = useRouter()
  const [bidsLineId, setBidsLineId] = React.useState<string | null>(null)
  const [trades, setTrades] = React.useState<readonly SelectedTrade[]>([])

  React.useEffect(() => {
    if (!active) return
    let cancelled = false
    void getEstimateSelectedTrades(projectId, estimateId).then((result) => {
      if (!cancelled && result.success) setTrades(result.data)
    })
    void getEstimatePricingBoard(projectId, estimateId).then((result) => {
      if (cancelled) return
      if (result.success) {
        setView(result.data)
        setError(null)
      } else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, estimateId, active, version])

  React.useEffect(() => {
    if (!composing || contacts !== null) return
    void getProjectTaskAssigneeOptions(projectId).then((options) => setContacts([...options.projectContacts, ...options.directoryContacts]))
  }, [composing, projectId, contacts])

  if (!active) return null
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!view) return <p className="text-sm text-muted-foreground">Loading pricing board…</p>

  const { board } = view
  const chosen = board.lines.filter((line) => selected.has(line.id))
  const problem = packageSelectionProblem(chosen)
  const forOwner = chosen.length > 0 && chosen.every((line) => line.source.action === "owner_pricing")
  const vendors = vendorOptions(contacts ?? [], forOwner)

  function toggle(lineId: string, on: boolean): void {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(lineId)
      else next.delete(lineId)
      return next
    })
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h2 className="font-semibold">Pricing requests</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Lines with a &quot;Priced by&quot; choice. Tick cost codes the same supplier or sub would price together, then
          request quotes; each vendor gets their own RFQ in one package. Tick Owner lines to ask the owner for their
          numbers the same way.
        </p>
      </div>

      {board.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No lines need pricing yet. Choose &quot;Priced by&quot; on a cost code in Estimate costs.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="w-8 py-2 pr-2 font-medium"><span className="sr-only">Choose</span></th>
                <th className="py-2 pr-4 font-medium">Cost code</th>
                <th className="py-2 pr-4 font-medium">Priced by</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Amount</th>
                <th className="py-2 pl-2 font-medium"><span className="sr-only">Bids</span></th>
              </tr>
            </thead>
            <tbody>
              {board.lines.map((line) => (
                <tr key={line.id} className="border-b align-top">
                  <td className="py-2 pr-2">
                    {editable && line.source.action !== "takeoff" && (
                      <Checkbox
                        aria-label={`Choose ${line.costCode} ${line.costCodeName}`}
                        checked={selected.has(line.id)}
                        onCheckedChange={(checked) => toggle(line.id, checked === true)}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <p className="font-medium">{line.costCode} · {line.costCodeName}</p>
                    {line.description.trim() !== line.costCodeName.trim() && (
                      <p className="text-xs text-muted-foreground">{line.description}</p>
                    )}
                  </td>
                  <td className="py-2 pr-4"><Badge variant="outline">{line.source.label}</Badge></td>
                  <td className="py-2 pr-4 text-muted-foreground">{lineStatus(line)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {line.lineTotalCents > 0 ? money(line.lineTotalCents) : <Badge variant="secondary">Needs price</Badge>}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    {line.source.action !== "takeoff" && line.rfqCount > 0 && (
                      <Button type="button" size="sm" variant="outline" onClick={() => setBidsLineId(line.id)}>
                        Bids{line.quoteCount > 0 ? ` (${line.quoteCount})` : ""}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && board.lines.some((line) => line.source.action !== "takeoff") && !composing && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={problem !== null} onClick={() => setComposing(true)}>
            {forOwner ? "Ask the owner" : "Request quotes"}{chosen.length > 0 ? ` for ${chosen.length} cost code${chosen.length === 1 ? "" : "s"}` : ""}
          </Button>
          <span className="text-xs text-muted-foreground">{chosen.length === 0 ? "Tick the cost codes to send out." : problem}</span>
        </div>
      )}

      {composing && problem === null && (
        <PackageComposer
          projectId={projectId}
          estimateId={estimateId}
          lines={chosen}
          vendors={vendors}
          forOwner={forOwner}
          documents={view.documents}
          onCancel={() => setComposing(false)}
          onCreated={(count) => {
            toast.success(`${count} draft RFQ${count === 1 ? "" : "s"} made. Review and send each one from RFQs.`)
            setComposing(false)
            setSelected(new Set())
            setVersion((current) => current + 1)
          }}
        />
      )}

      {bidsLineId && (
        <EstimateLineBidsDialog
          projectId={projectId}
          estimateId={estimateId}
          lineId={bidsLineId}
          open
          onOpenChange={(next) => {
            if (!next) setBidsLineId(null)
          }}
          onAccepted={() => {
            setVersion((current) => current + 1)
            router.refresh()
          }}
        />
      )}

      <SelectedTrades trades={trades} />

      {board.packages.length > 0 && (
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">Packages on this job</h3>
          <div className="divide-y border-y">
            {board.packages.map((pkg) => (
              <div key={pkg.id} className="grid gap-2 py-3">
                <div>
                  <p className="font-medium">{pkg.title}</p>
                  <p className="text-xs text-muted-foreground">{pkg.costCodes.join(" · ")}</p>
                </div>
                {editable && <PackageSender projectId={projectId} drafts={pkg.rfqs.filter((rfq) => rfq.status === "draft")} onSent={() => setVersion((current) => current + 1)} />}
                <div className="flex flex-wrap gap-2">
                  {pkg.rfqs.map((rfq) => (
                    <Link
                      key={rfq.id}
                      href={`/dashboard/projects/${projectId}/rfqs?created=${encodeURIComponent(rfq.id)}`}
                      className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      <span className="font-medium">{rfq.vendor}</span>
                      <span className="text-muted-foreground">{rfq.number ? `${rfq.number} · ` : ""}{RFQ_STATUS_LABEL[rfq.status]}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PackageComposer({
  projectId,
  estimateId,
  lines,
  vendors,
  forOwner,
  documents,
  onCancel,
  onCreated,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly lines: readonly PricingBoardLine[]
  readonly vendors: readonly Recipient[]
  readonly forOwner: boolean
  readonly documents: EstimatePricingBoardView["documents"]
  readonly onCancel: () => void
  readonly onCreated: (count: number) => void
}): React.ReactElement {
  const [title, setTitle] = React.useState(() => defaultPackageTitle(lines))
  const [dueDate, setDueDate] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [query, setQuery] = React.useState("")
  const [picked, setPicked] = React.useState<readonly Recipient[]>([])
  const [otherName, setOtherName] = React.useState("")
  const [otherEmail, setOtherEmail] = React.useState("")
  const [documentIds, setDocumentIds] = React.useState<ReadonlySet<string>>(() => new Set(documents.map((document) => document.id)))
  const [pickedFiles, setPickedFiles] = React.useState<readonly PickedProjectFile[]>([])
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  const needle = query.trim().toLowerCase()
  const matches = vendors
    .filter((vendor) => !picked.some((item) => item.key === vendor.key))
    .filter((vendor) => !needle || `${vendor.name} ${vendor.email}`.toLowerCase().includes(needle))
    .slice(0, 8)

  function addOther(): void {
    const name = otherName.trim()
    const email = otherEmail.trim().toLowerCase()
    if (!name || !email) return
    if (picked.some((item) => item.key === email)) return
    setPicked([...picked, { key: email, name, email }])
    setOtherName("")
    setOtherEmail("")
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await createEstimatePricingPackage(projectId, estimateId, {
        lineIds: lines.map((line) => line.id),
        title,
        dueDate: dueDate || null,
        notes: notes || null,
        recipients: picked.map(({ name, email }) => ({ name, email })),
        documentIds: [...documentIds],
        extraDocuments: pickedFiles.map((file) => ({ label: file.name, url: file.url })),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      onCreated(result.data.rfqIds.length)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4 border-y bg-muted/30 px-3 py-4">
      <div>
        <h3 className="text-sm font-semibold">{forOwner ? "Ask the owner for their numbers" : "Request quotes"}</h3>
        <p className="text-xs text-muted-foreground">{lines.map((line) => line.costCode).join(" · ")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="grid gap-1.5">
          <Label htmlFor="pricingPackageTitle">Package name</Label>
          <Input id="pricingPackageTitle" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pricingPackageDue">Quotes due</Label>
          <Input id="pricingPackageDue" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pricingPackageNotes">Scope notes for vendors</Label>
        <Textarea id="pricingPackageNotes" value={notes} maxLength={5000} onChange={(event) => setNotes(event.target.value)} placeholder="Anything every vendor should know about this package" />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pricingPackageVendorSearch">{forOwner ? "Owner" : "Vendors"}</Label>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {picked.map((vendor) => (
              <Button key={vendor.key} type="button" size="sm" variant="secondary" onClick={() => setPicked(picked.filter((item) => item.key !== vendor.key))} aria-label={`Remove ${vendor.name}`}>
                {vendor.name} · {vendor.email} ✕
              </Button>
            ))}
          </div>
        )}
        <Input id="pricingPackageVendorSearch" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={forOwner ? "Search the job's owners" : "Search subcontractors and suppliers"} />
        {matches.length > 0 && (
          <div className="grid divide-y border">
            {matches.map((vendor) => (
              <button key={vendor.key} type="button" className="px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setPicked([...picked, vendor])}>
                <span className="font-medium">{vendor.name}</span> <span className="text-muted-foreground">· {vendor.email}</span>
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="pricingPackageOtherName">{forOwner ? "Someone else: name" : "Someone else: company"}</Label>
            <Input id="pricingPackageOtherName" value={otherName} onChange={(event) => setOtherName(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pricingPackageOtherEmail">Email</Label>
            <Input id="pricingPackageOtherEmail" type="email" value={otherEmail} onChange={(event) => setOtherEmail(event.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={addOther} disabled={!otherName.trim() || !otherEmail.trim()}>
            Add
          </Button>
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Plans and specs to include</legend>
        {documents.length === 0 && pickedFiles.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This estimate has no linked plans or specs. Browse the project files to add some.
          </p>
        ) : (
          documents.map((document) => (
            <label key={document.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={documentIds.has(document.id)}
                onCheckedChange={(checked) =>
                  setDocumentIds((current) => {
                    const next = new Set(current)
                    if (checked === true) next.add(document.id)
                    else next.delete(document.id)
                    return next
                  })
                }
              />
              {document.label}
            </label>
          ))
        )}
        {pickedFiles.map((file) => (
          <div key={file.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{file.name}</span>
            <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${file.name}`} onClick={() => setPickedFiles(pickedFiles.filter((item) => item.id !== file.id))}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            Browse project files
          </Button>
        </div>
        <ProjectDriveFilePicker
          projectId={projectId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          alreadyPickedUrls={[...documents.map((document) => document.url), ...pickedFiles.map((file) => file.url)]}
          onPick={(files) => setPickedFiles([...pickedFiles, ...files.filter((file) => !pickedFiles.some((item) => item.id === file.id))])}
        />
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || picked.length === 0 || !title.trim()}>
          {pending ? "Making RFQs…" : `Make ${picked.length || ""} draft RFQ${picked.length === 1 ? "" : "s"}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

const DEFAULT_PACKAGE_MESSAGE = [
  "Please review the scope and the linked plans and specifications.",
  "Use the Enter your prices button to price each item, or reply to this email with your quote.",
].join("\n")

/** Emails every draft RFQ in a package at once, one email per vendor. */
function PackageSender({
  projectId,
  drafts,
  onSent,
}: {
  readonly projectId: string
  readonly drafts: readonly PricingBoardRfq[]
  readonly onSent: () => void
}): React.ReactElement | null {
  const [open, setOpen] = React.useState(false)
  const [cc, setCc] = React.useState<readonly string[]>([])
  const [message, setMessage] = React.useState(DEFAULT_PACKAGE_MESSAGE)
  const [options, setOptions] = React.useState<readonly EmailRecipientOption[]>([])
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open || options.length > 0) return
    void getProjectContactsSummary(projectId, "internal").then(
      (summary) => setOptions(buildProjectEmailRecipientOptions(summary.allContacts)),
      () => setOptions([]),
    )
  }, [open, options.length, projectId])

  if (drafts.length === 0) return null
  const missingEmail = drafts.filter((rfq) => !rfq.recipientEmail)

  function send(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await sendEstimatePricingPackage(projectId, { rfqIds: drafts.map((rfq) => rfq.id), cc, message })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const { sent, failed } = result.data
      if (sent.length > 0) toast.success(`Sent to ${sent.join(", ")}.`)
      for (const item of failed) toast.error(`${item.vendor}: ${item.error}`)
      if (failed.length === 0) setOpen(false)
      onSent()
    })
  }

  if (!open) {
    return (
      <div>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          Send to {drafts.length} vendor{drafts.length === 1 ? "" : "s"}
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={send} className="grid gap-3 border-y bg-muted/30 px-3 py-3">
      <p className="text-sm">
        Each vendor gets their own email with the scope, the plans and specs, and a private link to enter their prices.
      </p>
      <p className="text-xs text-muted-foreground">To: {drafts.map((rfq) => `${rfq.vendor}${rfq.recipientEmail ? ` (${rfq.recipientEmail})` : ""}`).join(" · ")}</p>
      {missingEmail.length > 0 && (
        <p className="text-xs text-destructive">
          No email for {missingEmail.map((rfq) => rfq.vendor).join(", ")}. Add one on the RFQ, or they&apos;ll be skipped.
        </p>
      )}
      <EmailRecipientPicker
        id="pricing-package-cc"
        label="Cc (every email)"
        options={options}
        value={cc}
        onChange={setCc}
        placeholder="Choose an optional contact..."
      />
      <div className="grid gap-1.5">
        <Label htmlFor="pricingPackageMessage">Message</Label>
        <Textarea id="pricingPackageMessage" value={message} maxLength={10000} onChange={(event) => setMessage(event.target.value)} className="min-h-24" required />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !message.trim()}>
          {pending ? "Sending…" : `Send ${drafts.length} email${drafts.length === 1 ? "" : "s"}`}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Who has been selected for this estimate: one row per accepted bid. */
function SelectedTrades({ trades }: { readonly trades: readonly SelectedTrade[] }): React.ReactElement | null {
  if (trades.length === 0) return null
  const total = trades.filter((trade) => !trade.ownerScope).reduce((sum, trade) => sum + trade.totalCents, 0)
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Selected trades</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {trades.filter((trade) => !trade.ownerScope).length} selected · {money(total)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Trade</th>
              <th className="py-2 pr-4 font-medium">Cost codes</th>
              <th className="py-2 pr-4 text-right font-medium">Amount</th>
              <th className="py-2 font-medium">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.rfqId} className="border-b align-top">
                <td className="py-2 pr-4">
                  <span className="font-medium">{trade.vendor}</span>
                  {trade.ownerScope && <Badge variant="outline" className="ml-2">Owner scope</Badge>}
                  <p className="text-xs text-muted-foreground">{trade.rfqNumber}</p>
                </td>
                <td className="py-2 pr-4 text-xs">
                  {trade.codes.map((code) => `${code.costCode ?? code.description} ${money(code.amountCents)}`).join(" · ")}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{money(trade.totalCents)}</td>
                <td className="py-2 text-xs text-muted-foreground">
                  {trade.acceptedAt ? new Date(trade.acceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  {trade.acceptedByName ? ` · ${trade.acceptedByName}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Award letters and trade docs for these trades come next.</p>
    </div>
  )
}

