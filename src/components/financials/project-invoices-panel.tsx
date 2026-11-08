"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconFileInvoice, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { createProjectInvoice } from "@/app/actions/project-invoices"
import type { ProjectInvoicesPanel as PanelData } from "@/app/actions/project-invoice-views"
import { ProjectInvoicesTable } from "@/components/financials/project-invoices-table"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/*
 * The job's simple invoices on Project Financials: material sales and
 * one-off work billed from Compass (progress billing stays with pay
 * requests). "New invoice" starts a blank invoice; "Invoice from estimate"
 * (departments without a contract budget, Settings) starts from an estimate
 * with what's left on every line, or with no lines to pick in the editor.
 */

type CreateMode = { readonly kind: "blank" } | { readonly kind: "estimate" }

export function ProjectInvoicesPanel({ projectId, panel }: { readonly projectId: string; readonly panel: PanelData }): React.ReactElement {
  const router = useRouter()
  const [mode, setMode] = React.useState<CreateMode | null>(null)
  const [customerId, setCustomerId] = React.useState(panel.defaultCustomerId ?? "")
  const [estimateId, setEstimateId] = React.useState(panel.estimates[0]?.id ?? "")
  const [estimateLines, setEstimateLines] = React.useState<"remaining" | "none">("remaining")
  const [pending, startTransition] = React.useTransition()
  const customerOptions = React.useMemo(
    () => panel.customers.map((customer) => ({ value: customer.id, label: customer.name, description: customer.email ?? undefined })),
    [panel.customers]
  )

  function create(): void {
    if (!mode) return
    startTransition(async () => {
      const result = await createProjectInvoice(projectId, {
        customerId,
        estimateId: mode.kind === "estimate" ? estimateId : null,
        estimateLines,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setMode(null)
      router.push(`/dashboard/projects/${projectId}/financials/invoices/${result.data.invoiceId}`)
    })
  }

  return (
    <section aria-labelledby="project-invoices-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="project-invoices-heading" className="flex items-center gap-2 text-base font-semibold">
            <IconFileInvoice className="size-4 text-primary" aria-hidden />
            Invoices
          </h2>
          <p className="text-sm text-muted-foreground">Material sales and one-off work, emailed from Compass and sent to Sage.</p>
        </div>
        {panel.canCreate && (
          <div className="flex flex-wrap gap-2">
            {panel.invoicesFromEstimate && (
              <Button type="button" size="sm" variant="outline" disabled={panel.estimates.length === 0} title={panel.estimates.length === 0 ? "Send or accept an estimate first." : undefined} onClick={() => setMode({ kind: "estimate" })}>
                <IconFileInvoice className="size-4" aria-hidden />
                Invoice from estimate
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => setMode({ kind: "blank" })}>
              <IconPlus className="size-4" aria-hidden />
              New invoice
            </Button>
          </div>
        )}
      </div>
      <ProjectInvoicesTable projectId={projectId} invoices={panel.invoices} />

      <Dialog open={mode !== null} onOpenChange={(open) => (!open ? setMode(null) : undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{mode?.kind === "estimate" ? "Invoice from estimate" : "New invoice"}</DialogTitle>
            <DialogDescription>
              {mode?.kind === "estimate"
                ? "Bill the estimate in part or in full. You can change quantities and add lines before you finalize."
                : "For one-off work or a sale. Add lines (typed or from the price list) in the next step."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-invoice-bill-to">Bill to</Label>
              <SearchableCombobox
                id="new-invoice-bill-to"
                ariaLabel="Bill to"
                options={customerOptions}
                value={customerId}
                onValueChange={setCustomerId}
                placeholder="Choose the customer"
                searchPlaceholder="Search customers..."
              />
            </div>
            {mode?.kind === "estimate" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="new-invoice-estimate">Estimate</Label>
                  <Select value={estimateId} onValueChange={setEstimateId}>
                    <SelectTrigger id="new-invoice-estimate" className="w-full">
                      <SelectValue placeholder="Choose an estimate" />
                    </SelectTrigger>
                    <SelectContent>
                      {panel.estimates.map((estimate) => (
                        <SelectItem key={estimate.id} value={estimate.id}>
                          {estimate.estimateNumber} v{estimate.versionNumber} · {estimate.title}
                          {estimate.status === "accepted" ? " (accepted)" : " (sent)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <RadioGroup value={estimateLines} onValueChange={(value) => setEstimateLines(value === "none" ? "none" : "remaining")} className="space-y-1">
                  <Label className="flex items-start gap-2 font-normal">
                    <RadioGroupItem value="remaining" className="mt-0.5" />
                    <span>Everything not invoiced yet (change quantities next)</span>
                  </Label>
                  <Label className="flex items-start gap-2 font-normal">
                    <RadioGroupItem value="none" className="mt-0.5" />
                    <span>Start empty and pick estimate lines</span>
                  </Label>
                </RadioGroup>
              </>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending || !customerId || (mode?.kind === "estimate" && !estimateId)} onClick={create}>
              {pending ? "Starting…" : "Start invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
