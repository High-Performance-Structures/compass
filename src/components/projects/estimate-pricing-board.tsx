"use client"

import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import type { ProjectTaskAssigneeOption } from "@/app/actions/project-contacts"
import { getProjectTaskAssigneeOptions } from "@/app/actions/project-contacts"
import {
  createEstimatePricingPackage,
  getEstimatePricingBoard,
  type EstimatePricingBoardView,
} from "@/app/actions/estimate-pricing-board"
import { ProjectDriveFilePicker, type PickedProjectFile } from "@/components/projects/project-drive-file-picker"
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
  type PricingBoardRfqStatus,
} from "@/lib/estimates/pricing-board"

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
      return "Owner provides this number"
  }
}

function vendorOptions(options: readonly ProjectTaskAssigneeOption[]): readonly Recipient[] {
  const seen = new Set<string>()
  return options.flatMap((option) => {
    if (option.contactType !== "subcontractor" && option.contactType !== "supplier") return []
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
  const [vendors, setVendors] = React.useState<readonly Recipient[]>([])
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    if (!active) return
    let cancelled = false
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
    if (!composing || vendors.length > 0) return
    void getProjectTaskAssigneeOptions(projectId).then((options) =>
      setVendors(vendorOptions([...options.projectContacts, ...options.directoryContacts])),
    )
  }, [composing, projectId, vendors.length])

  if (!active) return null
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!view) return <p className="text-sm text-muted-foreground">Loading pricing board…</p>

  const { board } = view
  const chosen = board.lines.filter((line) => selected.has(line.id))
  const problem = packageSelectionProblem(chosen)

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
          request quotes. Each vendor gets their own RFQ in one package.
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
              </tr>
            </thead>
            <tbody>
              {board.lines.map((line) => (
                <tr key={line.id} className="border-b align-top">
                  <td className="py-2 pr-2">
                    {editable && line.source.action === "rfq" && (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && board.lines.some((line) => line.source.action === "rfq") && !composing && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={problem !== null} onClick={() => setComposing(true)}>
            Request quotes{chosen.length > 0 ? ` for ${chosen.length} cost code${chosen.length === 1 ? "" : "s"}` : ""}
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
  documents,
  onCancel,
  onCreated,
}: {
  readonly projectId: string
  readonly estimateId: string
  readonly lines: readonly PricingBoardLine[]
  readonly vendors: readonly Recipient[]
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
        <h3 className="text-sm font-semibold">Request quotes</h3>
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
        <Label htmlFor="pricingPackageVendorSearch">Vendors</Label>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {picked.map((vendor) => (
              <Button key={vendor.key} type="button" size="sm" variant="secondary" onClick={() => setPicked(picked.filter((item) => item.key !== vendor.key))} aria-label={`Remove ${vendor.name}`}>
                {vendor.name} · {vendor.email} ✕
              </Button>
            ))}
          </div>
        )}
        <Input id="pricingPackageVendorSearch" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subcontractors and suppliers" />
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
            <Label htmlFor="pricingPackageOtherName">Someone else: company</Label>
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
