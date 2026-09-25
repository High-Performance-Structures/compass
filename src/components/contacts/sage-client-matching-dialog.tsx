"use client"

import * as React from "react"
import { toast } from "sonner"

import { listSageClientDirectory, requestSageClientDirectoryRefresh, type SageClientDirectoryPage } from "@/app/actions/sage-client-directory"
import type { Customer } from "@/db/schema"
import { canVerifyClientPair, compassClientRows, searchClientMatchRows } from "@/lib/sage/client-match-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type Props = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly customers: readonly Customer[]
  readonly onVerify: (customer: Customer, sageNumber: string) => void
  readonly onOpenCustomer: (customer: Customer) => void
  readonly onOpenReview: () => void
}

export function SageClientMatchingDialog({ open, onOpenChange, customers, onVerify, onOpenCustomer, onOpenReview }: Props): React.ReactElement {
  const [compassSearch, setCompassSearch] = React.useState("")
  const [sageSearch, setSageSearch] = React.useState("")
  const [compassId, setCompassId] = React.useState<string | null>(null)
  const [sageId, setSageId] = React.useState<string | null>(null)
  const [directory, setDirectory] = React.useState<SageClientDirectoryPage | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)
  const compassRows = React.useMemo(() => compassClientRows(customers), [customers])
  const compassMatches = React.useMemo(() => searchClientMatchRows(compassRows, compassSearch), [compassRows, compassSearch])
  const compass = compassRows.find((row) => row.id === compassId) ?? null
  const sage = directory?.rows.find((row) => row.sageRecordId === sageId) ?? null
  const numberOwner = sage?.claimedBy ? customers.find((row) => row.id === sage.claimedBy?.id) ?? null : null
  const numberHasMultipleOwners = Boolean(sage && sage.claimCount > 1)
  const numberClaimedElsewhere = Boolean(sage?.claimedBy && sage.claimedBy.id !== compassId)
  const compassAlreadyLinkedElsewhere = Boolean(compass?.sageClientId && compass.sageClientId !== sage?.sageRecordId)
  const compassNumberDiffers = Boolean(compass?.sageClientNumber && compass.sageClientNumber !== sage?.sageClientNumber)
  const canVerifyPair = canVerifyClientPair(compass, sage)

  React.useEffect(() => {
    if (!open) return
    let active = true
    const timeout = window.setTimeout(() => {
      setLoading(true)
      void listSageClientDirectory(sageSearch).then((next) => {
        if (active) setDirectory(next)
      }).catch(() => {
        if (active) toast.error("Could not load the Sage client directory")
      }).finally(() => { if (active) setLoading(false) })
    }, sageSearch ? 250 : 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [open, sageSearch, reloadKey])
  React.useEffect(() => {
    if (!open || directory?.refreshStatus !== "queued" && directory?.refreshStatus !== "running") return
    const timer = window.setTimeout(() => setReloadKey((key) => key + 1), 5000)
    return () => window.clearTimeout(timer)
  }, [open, directory?.refreshStatus, reloadKey])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const result = await requestSageClientDirectoryRefresh()
      if (!result.success) toast.error(result.error)
      else {
        toast.success(result.status === "queued" ? "Fresh Sage client list requested" : "A Sage refresh is already in progress")
        setReloadKey((key) => key + 1)
      }
    } finally { setRefreshing(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-y-auto sm:max-w-6xl md:h-[86vh] md:overflow-hidden">
        <DialogHeader>
          <DialogTitle>Match clients with Sage</DialogTitle>
          <DialogDescription>Search Compass and the read-only Sage client list side by side. Selecting records never links or merges them. A proposed match still needs a fresh Sage read-back and approval.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
          <section className="flex min-h-0 min-w-0 flex-col gap-2" aria-label="Compass clients and leads">
            <h3 className="font-semibold">Compass clients & leads <span className="text-sm font-normal text-muted-foreground">{compassRows.length}</span></h3>
            <Input aria-label="Search Compass clients" placeholder="Search Compass name or email..." value={compassSearch} onChange={(event) => setCompassSearch(event.target.value)} />
            <p className="text-xs text-muted-foreground">{compassMatches.total} matches{compassMatches.total > compassMatches.matches.length ? ` · first ${compassMatches.matches.length} shown` : ""}</p>
            <div className="min-h-32 max-h-52 flex-1 overflow-y-auto rounded-md border md:max-h-none" role="listbox" aria-label="Compass clients and leads">
              {compassMatches.matches.map((row) => (
                <button key={row.id} type="button" role="option" aria-selected={compassId === row.id}
                  className={`flex w-full items-start justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/70 ${compassId === row.id ? "bg-muted" : ""}`}
                  onClick={() => setCompassId(row.id)}>
                  <span className="min-w-0"><span className="block truncate font-medium">{row.name}</span><span className="block truncate text-xs text-muted-foreground">{row.primaryEmail || row.email || "No email on file"}</span></span>
                  {row.sageClientNumber ? <Badge variant="outline" className="shrink-0">#{row.sageClientNumber}</Badge> : null}
                </button>
              ))}
              {compassMatches.total === 0 ? <p className="p-3 text-sm text-muted-foreground">No matching Compass clients.</p> : null}
            </div>
          </section>
          <section className="flex min-h-0 min-w-0 flex-col gap-2" aria-label="Sage client directory">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Sage clients</h3>
              <Button size="sm" variant="outline" disabled={refreshing || directory?.refreshStatus === "queued" || directory?.refreshStatus === "running"} onClick={() => void refresh()}>Request fresh list</Button>
            </div>
            <Input aria-label="Search Sage clients" placeholder="Search Sage name or number..." value={sageSearch} onChange={(event) => { setSageSearch(event.target.value); setSageId(null) }} />
            <p className="text-xs text-muted-foreground">{directory?.lastCapturedAt ? `Read from Sage ${new Date(directory.lastCapturedAt).toLocaleString()}` : "No live Sage client list yet"}{directory?.refreshStatus === "queued" || directory?.refreshStatus === "running" ? " · Refresh in progress" : ""}{directory?.hasMore ? " · refine search for more" : ""}</p>
            {directory?.errorMessage ? <p className="text-xs text-destructive">Last refresh failed: {directory.errorMessage}</p> : null}
            <div className="min-h-32 max-h-52 flex-1 overflow-y-auto rounded-md border md:max-h-none" role="listbox" aria-label="Sage client directory">
              {loading && !directory ? <p className="p-3 text-sm text-muted-foreground">Loading Sage clients...</p> : null}
              {!loading && directory?.rows.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No Sage clients found. Request a fresh list or change the search.</p> : null}
              {directory?.rows.map((row) => (
                <button key={row.sageRecordId} type="button" role="option" aria-selected={sageId === row.sageRecordId}
                  className={`flex w-full items-start justify-between gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/70 ${sageId === row.sageRecordId ? "bg-muted" : ""}`}
                  onClick={() => setSageId(row.sageRecordId)}>
                  <span className="min-w-0"><span className="block truncate font-medium">{row.name}</span><span className="block truncate text-xs text-muted-foreground">{row.email || "No Sage email"} · {row.claimCount > 1 ? "Multiple Compass claims" : row.claimedBy ? `Compass: ${row.claimedBy.name}` : "No Compass link"}</span></span>
                  <Badge variant="outline" className="shrink-0">#{row.sageClientNumber}</Badge>
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="space-y-2 border-t pt-3 text-sm">
          <div className="grid gap-2 md:grid-cols-2"><p><span className="text-muted-foreground">Compass:</span> {compass?.name ?? "Choose a client"}{compass ? ` · ${compass.primaryEmail || compass.email || "No email"}` : ""}</p><p><span className="text-muted-foreground">Sage:</span> {sage ? `${sage.name} · #${sage.sageClientNumber} · ${sage.email || "No email"}` : "Choose a Sage client"}</p></div>
          {numberClaimedElsewhere ? <p className="text-destructive">Sage #{sage?.sageClientNumber} is already assigned to “{sage?.claimedBy?.name}” in Compass. Review that record before reconciling a duplicate; this view does not transfer projects or people.</p> : null}
          {numberHasMultipleOwners ? <p className="text-destructive">Multiple Compass clients claim Sage #{sage?.sageClientNumber}. Reconcile those directory records before linking; this view will not choose one automatically.</p> : null}
          {compassAlreadyLinkedElsewhere || compassNumberDiffers ? <p className="text-destructive">This Compass client already has a different Sage identity or number. Review its existing link before choosing another.</p> : null}
          <div className="flex flex-wrap gap-2">
            {canVerifyPair && compass && sage ? <Button size="sm" onClick={() => { onOpenChange(false); onVerify(compass, sage.sageClientNumber) }}>Look up selected pair in Sage</Button> : null}
            {numberOwner ? <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onOpenCustomer(numberOwner) }}>Open number owner</Button> : null}
            <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onOpenReview() }}>Open Sage review</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
