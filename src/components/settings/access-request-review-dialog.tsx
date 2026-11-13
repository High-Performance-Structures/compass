"use client"

/*
 * Reviewing one access request. A client or vendor request is linked to
 * someone picked from the whole directory (Contacts), or approved as a new
 * client or vendor when nobody matches; the approval then opens every job
 * that directory person is on. An employee
 * request is approved with a staff role. Declining emails a short, polite
 * note and shares nothing.
 */
import * as React from "react"
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
import { Label } from "@/components/ui/label"
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/searchable-combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AccessRequestDirectoryOption, CompanyAccessRequest } from "@/lib/domain/access-requests/queries"
import {
  ACCESS_REQUEST_KIND_LABELS,
  ACCESS_REQUEST_STAFF_ROLES,
  ACCESS_REQUEST_VENDOR_ROLES,
  NEW_DIRECTORY_RECORD_OPTION,
  type AccessRequestVendorRole,
  type ApproveAccessRequestInput,
} from "@/lib/domain/access-requests/rules"
import { userRoleLabel } from "@/lib/user-roles"

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

/**
 * Pick who this request is from the whole directory: every client person and
 * client record (or vendor person and vendor company), searchable, with exact
 * email matches first. Leaving it on "Add as new" approves the request as a
 * new client or vendor made from what the person entered.
 */
function DirectoryLink({
  request,
  value,
  onChange,
}: {
  readonly request: CompanyAccessRequest
  readonly value: string
  readonly onChange: (option: AccessRequestDirectoryOption | null) => void
}): React.ReactElement {
  const [options, setOptions] = React.useState<readonly AccessRequestDirectoryOption[] | null>(null)
  const [search, setSearch] = React.useState("")
  const [selected, setSelected] = React.useState<AccessRequestDirectoryOption | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const isClient = request.kind === "client"

  // The first page is alphabetical and capped, so typing searches the whole
  // directory on the server instead of only filtering what loaded first.
  React.useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void getAccessRequestDirectoryOptions(request.id, search.trim()).then((result) => {
        if (cancelled) return
        if (result.success) {
          setOptions(result.data)
          setError(null)
        } else {
          setError(result.error)
        }
      })
    }, search.trim() ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [request.id, search])

  // Keep the picked person listed after the search changes.
  const listed = selected && !(options ?? []).some((option) => option.id === selected.id) ? [selected, ...(options ?? [])] : options ?? []
  const newLabel = isClient ? `Add as a new client (${request.requesterName})` : `Add as a new vendor (${request.companyName ?? request.requesterName})`
  const comboOptions: readonly SearchableComboboxOption[] = [
    { value: NEW_DIRECTORY_RECORD_OPTION, label: newLabel, description: "Nobody in Contacts matches; make a new directory record from this request" },
    ...listed.map((option) => ({
      value: option.id,
      label: option.name,
      description: [option.label, option.email, option.linkedElsewhere ? "already linked to another login" : null].filter(Boolean).join(" · "),
      keywords: [option.label, option.email].filter(Boolean).join(" "),
    })),
  ]
  return (
    <div className="space-y-2">
      <Label htmlFor="access-request-directory">{isClient ? "Who is this client?" : "Who is this vendor?"}</Label>
      <SearchableCombobox
        id="access-request-directory"
        ariaLabel={isClient ? "Client in Contacts" : "Vendor in Contacts"}
        options={comboOptions}
        value={value}
        onValueChange={(next) => {
          const option = next === NEW_DIRECTORY_RECORD_OPTION ? null : listed.find((candidate) => candidate.id === next) ?? null
          setSelected(option)
          onChange(option)
        }}
        onSearchChange={setSearch}
        placeholder={options === null ? "Loading Contacts…" : "Choose from Contacts"}
        searchPlaceholder={isClient ? "Search clients by name, company or email" : "Search vendors by name, company or email"}
        emptyMessage="No one in Contacts matches."
        disabled={options === null && search === ""}
      />
      <p className="text-xs text-muted-foreground">
        Pick the person or their company. Exact email matches for {request.requesterEmail} are listed first. Picking a company adds them as a person there.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

function decisionToast(result: AccessRequestDecisionResult, approved: boolean): void {
  if (!result.success) {
    toast.error(result.error)
    return
  }
  const { projects, skippedProjects, failedProjects, warning } = result.data
  if (approved) {
    toast.success(projects > 0 ? `Approved. ${projects} job${projects === 1 ? "" : "s"} shared.` : "Approved.")
    if (skippedProjects.length > 0) {
      toast.info(`Not shared (staff-only job, or no longer on the job): ${skippedProjects.join(", ")}.`)
    }
    if (failedProjects.length > 0) {
      toast.error(`Couldn't open ${failedProjects.join(", ")}. Nothing was shared there; use Grant project access on that job to try again.`)
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
    // Nothing picked is never a dead end: it approves them as a new client or vendor.
    const picked = linked?.id ?? NEW_DIRECTORY_RECORD_OPTION
    if (current.kind === "client") return { kind: "client", requestId: current.id, customerContactId: picked }
    if (current.kind === "vendor") return { kind: "vendor", requestId: current.id, vendorContactId: picked, role: vendorRole }
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
                  : "Choose who they are in Contacts, or approve them as new. Approving opens every job they are on."}
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
                <DirectoryLink request={current} value={linked?.id ?? NEW_DIRECTORY_RECORD_OPTION} onChange={setLinked} />
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
                {pending
                  ? "Saving…"
                  : current.kind === "employee"
                    ? "Approve"
                    : linked
                      ? `Approve and link to ${linked.name}`
                      : `Approve as a new ${current.kind === "client" ? "client" : "vendor"}`}
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
