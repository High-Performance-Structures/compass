"use client"

/*
 * Request access: a signed-in person asks a company that allows requests
 * to let them into Compass, and sees where their requests stand. Shown on
 * /dashboard/request-access (reached from the company menu) and in place of
 * the dashboard for someone who doesn't belong to any company yet.
 */
import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  requestCompanyAccess,
  withdrawCompanyAccessRequest,
  type RequestAccessPageData,
} from "@/app/actions/access-requests"
import { switchOrganization } from "@/app/actions/organizations"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { MyAccessRequest } from "@/lib/domain/access-requests/queries"
import { ACCESS_REQUEST_KIND_LABELS } from "@/lib/domain/access-requests/rules"
import { formatDate } from "@/lib/format"
import { ACCESS_REQUEST_KINDS, type AccessRequestKind, type AccessRequestStatus } from "@/lib/domain/access-requests/statuses"

const STATUS_LABELS: Record<AccessRequestStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  declined: "Not approved",
  withdrawn: "Withdrawn",
}

function isKind(value: string): value is AccessRequestKind {
  return ACCESS_REQUEST_KINDS.some((kind) => kind === value)
}

function YourRequests({ requests }: { readonly requests: readonly MyAccessRequest[] }): React.ReactElement | null {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState<string | null>(null)
  if (requests.length === 0) return null

  async function open(request: MyAccessRequest): Promise<void> {
    setBusyId(request.id)
    const result = await switchOrganization(request.organizationId)
    if (!result.success) {
      setBusyId(null)
      toast.error(result.error ?? "Unable to open that company.")
      return
    }
    router.push("/dashboard")
    router.refresh()
  }

  async function withdraw(request: MyAccessRequest): Promise<void> {
    setBusyId(request.id)
    const result = await withdrawCompanyAccessRequest(request.id)
    setBusyId(null)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    toast.success("Request withdrawn.")
    router.refresh()
  }

  return (
    <section aria-labelledby="your-access-requests" className="space-y-3">
      <h2 id="your-access-requests" className="text-base font-semibold">Your requests</h2>
      <ul className="divide-y rounded-lg border">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium">{request.organizationName}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="rounded-[4px]">{STATUS_LABELS[request.status]}</Badge>
                <span>{ACCESS_REQUEST_KIND_LABELS[request.kind]}</span>
                <span className="tabular-nums">Sent {formatDate(request.createdAt)}</span>
              </div>
            </div>
            {request.status === "pending" ? (
              <Button type="button" size="sm" variant="outline" disabled={busyId !== null} onClick={() => void withdraw(request)}>
                Withdraw
              </Button>
            ) : null}
            {request.canOpen ? (
              <Button type="button" size="sm" disabled={busyId !== null} onClick={() => void open(request)}>
                Open {request.organizationName}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

function RequestForm({ data }: { readonly data: RequestAccessPageData }): React.ReactElement {
  const router = useRouter()
  const [organizationId, setOrganizationId] = React.useState(data.companies.length === 1 ? data.companies[0]?.id ?? "" : "")
  const [kind, setKind] = React.useState<AccessRequestKind | "">("")
  const [companyName, setCompanyName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [jobReference, setJobReference] = React.useState("")
  const [note, setNote] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [sentTo, setSentTo] = React.useState<string | null>(null)

  if (data.companies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No other companies are taking access requests in Compass right now. Ask the company you work with to invite you.
      </p>
    )
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!kind) {
      toast.error("Choose who you are.")
      return
    }
    setPending(true)
    const result = await requestCompanyAccess({ organizationId, kind, companyName, phone, jobReference, note })
    setPending(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setSentTo(result.data.organizationName)
    setOrganizationId("")
    setKind("")
    setCompanyName("")
    setJobReference("")
    setNote("")
    router.refresh()
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-xl space-y-4" aria-labelledby="request-access-form">
      <h2 id="request-access-form" className="text-base font-semibold">Ask for access</h2>
      {sentTo ? (
        <p role="status" className="rounded-lg border px-4 py-3 text-sm">
          Request sent to {sentTo}; you&apos;ll get an email when it&apos;s approved.
        </p>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="request-access-company">Company</Label>
        <SearchableCombobox
          id="request-access-company"
          ariaLabel="Company"
          placeholder="Choose a company"
          searchPlaceholder="Search companies"
          emptyMessage="No company by that name is taking requests."
          options={data.companies.map((company) => ({ value: company.id, label: company.name }))}
          value={organizationId}
          onValueChange={setOrganizationId}
          disabled={pending}
          required
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">I am a</legend>
        <RadioGroup value={kind} onValueChange={(value) => { if (isKind(value)) setKind(value) }} className="gap-2" disabled={pending}>
          {ACCESS_REQUEST_KINDS.map((option) => (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem id={`request-access-kind-${option}`} value={option} />
              <Label htmlFor={`request-access-kind-${option}`} className="font-normal">{ACCESS_REQUEST_KIND_LABELS[option]}</Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      {kind === "vendor" ? (
        <div className="space-y-1">
          <Label htmlFor="request-access-company-name">Your company name</Label>
          <Input id="request-access-company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} maxLength={160} required disabled={pending} />
        </div>
      ) : null}
      <div className="space-y-1">
        <Label htmlFor="request-access-phone">Phone</Label>
        <Input id="request-access-phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} required disabled={pending} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="request-access-job">Job name or address{kind === "employee" ? " (optional)" : ""}</Label>
        <Input
          id="request-access-job"
          value={jobReference}
          onChange={(event) => setJobReference(event.target.value)}
          maxLength={200}
          required={kind !== "employee"}
          disabled={pending}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="request-access-note">Note (optional)</Label>
        <Textarea id="request-access-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} disabled={pending} />
      </div>
      <p className="text-xs text-muted-foreground">We&apos;ll use your sign-in email, {data.email}. Someone at the company reviews every request.</p>
      <Button type="submit" disabled={pending || !organizationId || !kind}>
        {pending ? "Sending…" : "Request access"}
      </Button>
    </form>
  )
}

export function RequestAccessPanel({ data }: { readonly data: RequestAccessPageData }): React.ReactElement {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-normal">Request access</h1>
        <p className="text-sm text-muted-foreground">
          {data.hasCompany
            ? "Ask another company to give you access in Compass."
            : "You're signed in, but no company has given you access yet. Ask the company you work with, and they'll review your request."}
        </p>
      </header>
      <YourRequests requests={data.requests} />
      <RequestForm data={data} />
    </main>
  )
}
