"use client"

/*
 * Reviewing one access request. A client or vendor request must be linked
 * to that person in the directory (Contacts) before it can be approved; the
 * approval then opens every job that directory person is on. An employee
 * request is approved with a staff role. Declining emails a short, polite
 * note and shares nothing.
 */
import * as React from "react"
import Link from "next/link"
import { toast } from "sonner"

import {
  approveCompanyAccessRequest,
  declineCompanyAccessRequest,
  getAccessRequestDirectoryOptions,
  type AccessRequestDecisionResult,
} from "@/app/actions/access-requests"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AccessRequestDirectoryOption, CompanyAccessRequest } from "@/lib/domain/access-requests/queries"
import {
  ACCESS_REQUEST_KIND_LABELS,
  ACCESS_REQUEST_STAFF_ROLES,
  ACCESS_REQUEST_VENDOR_ROLES,
  type AccessRequestVendorRole,
  type ApproveAccessRequestInput,
} from "@/lib/domain/access-requests/rules"
import { userRoleLabel } from "@/lib/user-roles"
import { cn } from "@/lib/utils"

function isVendorRole(value: string): value is AccessRequestVendorRole {
  return ACCESS_REQUEST_VENDOR_ROLES.some((role) => role === value)
}

function Detail({ label, value }: { readonly label: string; readonly value: string | null }): React.ReactElement | null {
  if (!value) return null
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  )
}

/** Search the directory and pick the one person this request is. */
function DirectoryLink({
  request,
  selectedId,
  onSelect,
}: {
  readonly request: CompanyAccessRequest
  readonly selectedId: string | null
  readonly onSelect: (option: AccessRequestDirectoryOption) => void
}): React.ReactElement {
  const [search, setSearch] = React.useState("")
  const [options, setOptions] = React.useState<readonly AccessRequestDirectoryOption[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const isClient = request.kind === "client"

  React.useEffect(() => {
    let cancelled = false
    // Debounced so typing doesn't search on every key.
    const timer = setTimeout(() => {
      void getAccessRequestDirectoryOptions(request.id, search).then((result) => {
        if (cancelled) return
        if (result.success) {
          setOptions(result.data)
          setError(null)
        } else {
          setError(result.error)
        }
      })
    }, search ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request.id, search])

  const directoryHref = `/dashboard/contacts?tab=${isClient ? "customers" : "vendors"}`
  return (
    <div className="space-y-2">
      <Label htmlFor="access-request-directory-search">{isClient ? "Client contact" : "Vendor contact"}</Label>
      <Input
        id="access-request-directory-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={isClient ? "Search clients by name, email or phone" : "Search vendor people by name, email or phone"}
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">
        {search.trim().length >= 2 ? "Matching people in your directory." : `People whose email matches ${request.requesterEmail}.`}
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {options === null && !error ? <p className="text-sm text-muted-foreground">Searching…</p> : null}
      {options !== null && options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No one found. Search another name, or{" "}
          <Link href={directoryHref} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            add them in Contacts
          </Link>{" "}
          and search again.
        </p>
      ) : null}
      {options !== null && options.length > 0 ? (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border" role="listbox" aria-label="Directory people">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={selectedId === option.id}
                disabled={option.linkedElsewhere}
                onClick={() => onSelect(option)}
                className={cn(
                  "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
                  selectedId === option.id && "bg-muted",
                )}
              >
                <span className="font-medium">{option.name}</span>
                <span className="text-xs text-muted-foreground">
                  {option.label}
                  {option.email ? ` · ${option.email}` : ""}
                  {option.linkedElsewhere ? " · already linked to another login" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function decisionToast(result: AccessRequestDecisionResult, approved: boolean): void {
  if (!result.success) {
    toast.error(result.error)
    return
  }
  const { projects, skippedProjects, warning } = result.data
  if (approved) {
    toast.success(projects > 0 ? `Approved. ${projects} job${projects === 1 ? "" : "s"} shared.` : "Approved.")
    if (skippedProjects.length > 0) {
      toast.info(`Not shared (staff-only jobs): ${skippedProjects.join(", ")}. Invite them from the job if they should see it.`)
    }
  } else {
    toast.success("Declined. Nothing was shared.")
  }
  if (warning) toast.warning(warning)
}

export function AccessRequestReviewDialog({
  request,
  onOpenChange,
  onDecided,
}: {
  readonly request: CompanyAccessRequest | null
  readonly onOpenChange: (open: boolean) => void
  readonly onDecided: () => void
}): React.ReactElement {
  const [linked, setLinked] = React.useState<AccessRequestDirectoryOption | null>(null)
  const [vendorRole, setVendorRole] = React.useState<AccessRequestVendorRole>("subcontractor")
  const [staffRole, setStaffRole] = React.useState<string>("")
  const [pending, setPending] = React.useState(false)
  const [confirmDecline, setConfirmDecline] = React.useState(false)

  React.useEffect(() => {
    setLinked(null)
    setVendorRole("subcontractor")
    setStaffRole("")
    setConfirmDecline(false)
  }, [request?.id])

  function approvalInput(current: CompanyAccessRequest): ApproveAccessRequestInput | null {
    if (current.kind === "client") return linked ? { kind: "client", requestId: current.id, customerContactId: linked.id } : null
    if (current.kind === "vendor") return linked ? { kind: "vendor", requestId: current.id, vendorContactId: linked.id, role: vendorRole } : null
    return staffRole ? { kind: "employee", requestId: current.id, role: staffRole } : null
  }

  async function approve(current: CompanyAccessRequest): Promise<void> {
    const input = approvalInput(current)
    if (!input) return
    setPending(true)
    const result = await approveCompanyAccessRequest(input)
    setPending(false)
    decisionToast(result, true)
    if (result.success) onDecided()
  }

  async function decline(current: CompanyAccessRequest): Promise<void> {
    setPending(true)
    const result = await declineCompanyAccessRequest(current.id)
    setPending(false)
    setConfirmDecline(false)
    decisionToast(result, false)
    if (result.success) onDecided()
  }

  const current = request
  const ready = current ? approvalInput(current) !== null : false

  return (
    <Dialog open={current !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {current ? (
          <>
            <DialogHeader>
              <DialogTitle>Access request from {current.requesterName}</DialogTitle>
              <DialogDescription>
                {current.kind === "employee"
                  ? "Choose their staff role to approve. Only approve people who work for your company."
                  : "Link this request to the person in your directory. Approving opens every job that contact is on."}
              </DialogDescription>
            </DialogHeader>
            <dl className="space-y-1">
              <Detail label="I am a" value={ACCESS_REQUEST_KIND_LABELS[current.kind]} />
              <Detail label="Email" value={current.requesterEmail} />
              <Detail label="Phone" value={current.phone} />
              <Detail label="Company" value={current.companyName} />
              <Detail label="Job or address" value={current.jobReference} />
              <Detail label="Note" value={current.note} />
            </dl>
            {current.kind === "employee" ? (
              <div className="space-y-1">
                <Label htmlFor="access-request-staff-role">Staff role</Label>
                <Select value={staffRole} onValueChange={setStaffRole} disabled={pending}>
                  <SelectTrigger id="access-request-staff-role"><SelectValue placeholder="Choose a role" /></SelectTrigger>
                  <SelectContent>
                    {ACCESS_REQUEST_STAFF_ROLES.map((role) => <SelectItem key={role} value={role}>{userRoleLabel(role)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Admin access is never given from a request; change it in People later if needed.</p>
              </div>
            ) : (
              <>
                <DirectoryLink request={current} selectedId={linked?.id ?? null} onSelect={setLinked} />
                {current.kind === "vendor" ? (
                  <div className="space-y-1">
                    <Label htmlFor="access-request-vendor-role">Compass role</Label>
                    <Select value={vendorRole} onValueChange={(value) => { if (isVendorRole(value)) setVendorRole(value) }} disabled={pending}>
                      <SelectTrigger id="access-request-vendor-role"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACCESS_REQUEST_VENDOR_ROLES.map((role) => <SelectItem key={role} value={role}>{userRoleLabel(role)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </>
            )}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmDecline(true)}>
                Decline
              </Button>
              <Button type="button" disabled={pending || !ready} onClick={() => void approve(current)}>
                {pending ? "Saving…" : linked ? `Approve and link to ${linked.name}` : "Approve"}
              </Button>
            </DialogFooter>
            <AlertDialog open={confirmDecline} onOpenChange={setConfirmDecline}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Decline {current.requesterName}&apos;s request?</AlertDialogTitle>
                  <AlertDialogDescription>
                    They get a short, polite email from you saying the request wasn&apos;t approved. Nothing is shared with them.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={pending}
                    onClick={(event) => {
                      event.preventDefault()
                      void decline(current)
                    }}
                  >
                    Decline and email
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
