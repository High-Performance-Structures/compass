"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition, type FormEvent, type ReactElement } from "react"

import {
  clearProjectFollowUp,
  createCustomProjectJobStatus,
  createProjectInteraction,
  createProjectNote,
  deleteProjectInteraction,
  deleteProjectNote,
  retryProjectProfileSyncOperation,
  setProjectFollowUp,
  updateProjectInformation,
  type ProjectFollowUpOwner,
  type ProjectInformation,
} from "@/app/actions/project-profile"
import { Badge } from "@/components/ui/badge"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { customProjectInteractionType } from "@/lib/project-profile"
import { ProjectGoogleCalendarCard } from "@/components/projects/project-google-calendar-card"

const CUSTOM_INTERACTION_TYPE_OPTION = "__custom__"

function suffixFromProjectNumber(projectNumber: string | null): string {
  if (!projectNumber) return ""
  const parts = projectNumber.split("-")
  return parts[2] ?? ""
}

function dateTimeLocalValue(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function resultMessage(result: { readonly success: boolean; readonly error?: string }): string {
  return result.success ? "Saved." : (result.error ?? "Unable to save.")
}

export function ProjectInformationWorkspace({
  information,
  followUpOwners,
  canManageJobStatuses,
}: {
  readonly information: ProjectInformation
  readonly followUpOwners: readonly ProjectFollowUpOwner[]
  readonly canManageJobStatuses: boolean
}): ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [projectAddress, setProjectAddress] = useState(
    information.project.projectAddress ?? "",
  )
  const [mailingAddress, setMailingAddress] = useState(
    information.project.mailingAddress ?? "",
  )
  const [clientStatus, setClientStatus] = useState(information.project.clientStatus)
  const [jobStatusId, setJobStatusId] = useState(information.project.jobStatusId)
  const [addressSuffix, setAddressSuffix] = useState(
    suffixFromProjectNumber(information.project.projectNumber),
  )
  const [propagateMailingAddress, setPropagateMailingAddress] = useState(false)
  const [note, setNote] = useState("")
  const [interactionType, setInteractionType] = useState("call")
  const [customInteractionTypeLabel, setCustomInteractionTypeLabel] = useState("")
  const [interactionContactId, setInteractionContactId] = useState(
    information.clientContacts[0]?.id ?? "",
  )
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound")
  const [interactionSummary, setInteractionSummary] = useState("")
  const [interactionTime, setInteractionTime] = useState(
    dateTimeLocalValue(new Date().toISOString()),
  )
  const [followUpAt, setFollowUpAt] = useState(
    information.followUp ? dateTimeLocalValue(information.followUp.nextFollowUpAt) : "",
  )
  const [followUpOwnerId, setFollowUpOwnerId] = useState(
    information.followUp?.ownerUserId ?? "",
  )
  const [newJobStatusLabel, setNewJobStatusLabel] = useState("")
  const [newJobStatusSageCode, setNewJobStatusSageCode] = useState("")
  const [newJobStatusCadence, setNewJobStatusCadence] = useState("7")
  const [message, setMessage] = useState<string | null>(null)

  function refreshAfter(result: { readonly success: boolean; readonly error?: string }): void {
    setMessage(resultMessage(result))
    if (result.success) router.refresh()
  }

  function saveProfile(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await updateProjectInformation({
        projectId: information.project.id,
        projectAddress,
        mailingAddress,
        clientStatus,
        jobStatusId,
        addressSuffix: information.project.projectNumber ? addressSuffix : null,
        updateClientDefaultMailingAddress: propagateMailingAddress,
      })
      refreshAfter(result)
    })
  }

  function saveNote(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await createProjectNote({ projectId: information.project.id, body: note })
      if (result.success) setNote("")
      refreshAfter(result)
    })
  }

  function saveInteraction(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const selectedInteractionType = interactionType === CUSTOM_INTERACTION_TYPE_OPTION
      ? customProjectInteractionType(customInteractionTypeLabel)
      : interactionType
    if (!selectedInteractionType) {
      setMessage("Enter a unique custom interaction type using 1–60 standard characters.")
      return
    }
    startTransition(async () => {
      const result = await createProjectInteraction({
        projectId: information.project.id,
        interactionType: selectedInteractionType,
        direction,
        summary: interactionSummary,
        occurredAt: interactionTime,
        contactId: interactionContactId || null,
      })
      if (result.success) {
        setInteractionSummary("")
        setCustomInteractionTypeLabel("")
        setInteractionType(selectedInteractionType)
      }
      refreshAfter(result)
    })
  }

  function saveFollowUp(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await setProjectFollowUp({
        projectId: information.project.id,
        nextFollowUpAt: followUpAt,
        ownerUserId: followUpOwnerId || null,
      })
      refreshAfter(result)
    })
  }

  function removeNote(noteId: string): void {
    startTransition(async () => {
      refreshAfter(await deleteProjectNote({ projectId: information.project.id, noteId }))
    })
  }

  function removeInteraction(interactionId: string): void {
    startTransition(async () => {
      refreshAfter(
        await deleteProjectInteraction({ projectId: information.project.id, interactionId }),
      )
    })
  }

  function clearFollowUp(): void {
    startTransition(async () => {
      const result = await clearProjectFollowUp(information.project.id)
      if (result.success) {
        setFollowUpAt("")
        setFollowUpOwnerId("")
      }
      refreshAfter(result)
    })
  }

  function createJobStatus(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const cadence = Number(newJobStatusCadence)
    startTransition(async () => {
      const result = await createCustomProjectJobStatus({
        label: newJobStatusLabel,
        sageCode: newJobStatusSageCode || null,
        followUpCadenceDays: Number.isInteger(cadence) && cadence > 0 ? cadence : null,
      })
      if (result.success) {
        setNewJobStatusLabel("")
        setNewJobStatusSageCode("")
      }
      refreshAfter(result)
    })
  }

  function retrySyncOperation(operationId: string): void {
    startTransition(async () => {
      refreshAfter(
        await retryProjectProfileSyncOperation({
          projectId: information.project.id,
          operationId,
        }),
      )
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Project Information
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {information.project.projectNumber
              ? `${information.project.projectNumber} · ${information.project.name}`
              : information.project.name}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Maintain the project record, meaningful client touches, and the next follow-up in one place.
          </p>
          {information.projectNumberAliases.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Previous project number{information.projectNumberAliases.length === 1 ? "" : "s"}: {information.projectNumberAliases.join(", ")}
            </p>
          )}
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/projects/${information.project.id}/contacts`}>
            Manage contacts and email addresses
          </Link>
        </Button>
      </div>

      {message && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm" role="status">
          {message}
        </p>
      )}

      <ProjectGoogleCalendarCard projectId={information.project.id} />

      <form className="rounded-lg border bg-card p-4 sm:p-5" onSubmit={saveProfile}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Core project record</h2>
            <p className="text-sm text-muted-foreground">
              Site and mailing addresses are separate. Project-number department and sequence stay fixed.
            </p>
          </div>
          <Badge variant="outline">Office staff editable</Badge>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="project-address">Project / site address</Label>
            <Textarea id="project-address" value={projectAddress} onChange={(event) => setProjectAddress(event.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mailing-address">Mailing address</Label>
            <Textarea id="mailing-address" value={mailingAddress} onChange={(event) => setMailingAddress(event.target.value)} rows={3} />
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={propagateMailingAddress} onChange={(event) => setPropagateMailingAddress(event.target.checked)} className="mt-1" />
              Also update this client’s default mailing address.
            </label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-status">Client status</Label>
            <select id="client-status" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={clientStatus} onChange={(event) => setClientStatus(event.target.value === "lead" ? "lead" : "customer")}>
              <option value="lead">Lead</option>
              <option value="customer">Customer</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-status">Approved job status</Label>
            <select id="job-status" aria-describedby="job-status-help" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={jobStatusId} onChange={(event) => setJobStatusId(event.target.value)}>
              {information.jobStatuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
            </select>
            <p id="job-status-help" className="text-xs text-muted-foreground">
              Choose the approved operational stage for this project. {canManageJobStatuses ? "If a shared stage is genuinely missing, add it in the administrator-only section below." : "Only registry managers can add a shared status."}
            </p>
          </div>
          {information.project.projectNumber && (
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="project-suffix">Address-derived project-number suffix</Label>
              <div className="flex max-w-md items-center gap-2">
                <Input id="project-suffix" value={addressSuffix} onChange={(event) => setAddressSuffix(event.target.value)} aria-describedby="project-number-help" />
                <span className="whitespace-nowrap text-sm text-muted-foreground">→ {information.project.projectNumber.replace(/-[^-]+$/, `-${addressSuffix || "00"}`)}</span>
              </div>
              <p id="project-number-help" className="text-xs text-muted-foreground">
                {developerModeEnabled
                  ? "Changing this queues an in-place Google Drive folder rename and Registry/tracker update. Existing folder ID and link are retained."
                  : "Changing this updates the project number while retaining existing links."}
              </p>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end"><Button type="submit" disabled={pending}>Save project information</Button></div>
      </form>

      {canManageJobStatuses && (
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">Add an organization-specific status</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Add a genuinely missing shared stage only after your organization has
            approved it. The new stage becomes available to every project.
          </p>
          <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={createJobStatus}>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="new-job-status">Custom status label</Label><Input id="new-job-status" value={newJobStatusLabel} onChange={(event) => setNewJobStatusLabel(event.target.value)} placeholder="For example: Warranty" aria-describedby="new-job-status-help" required /><p id="new-job-status-help" className="text-xs text-muted-foreground">Use printable basic Latin characters so the organization-wide label is unique.</p></div>
            {developerModeEnabled && <div className="space-y-2"><Label htmlFor="new-job-status-code">Optional Sage reference code</Label><Input id="new-job-status-code" value={newJobStatusSageCode} onChange={(event) => setNewJobStatusSageCode(event.target.value)} /></div>}
            <div className="space-y-2"><Label htmlFor="new-job-status-cadence">Follow-up cadence (business days)</Label><Input id="new-job-status-cadence" type="number" min="1" value={newJobStatusCadence} onChange={(event) => setNewJobStatusCadence(event.target.value)} required /></div>
            <div className="md:col-span-4"><Button type="submit" disabled={pending}>Add custom status</Button></div>
          </form>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">Client follow-up</h2>
          <p className="mt-1 text-sm text-muted-foreground">Set the next explicit follow-up; the queue also calculates status-based staleness from meaningful touches.</p>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveFollowUp}>
            <div className="space-y-2"><Label htmlFor="follow-up-at">Next follow-up</Label><Input id="follow-up-at" type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="follow-up-owner">Owner</Label><select id="follow-up-owner" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={followUpOwnerId} onChange={(event) => setFollowUpOwnerId(event.target.value)}><option value="">Unassigned</option>{followUpOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}</select></div>
            <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" disabled={pending}>Set follow-up</Button>{information.followUp && <Button type="button" variant="outline" disabled={pending} onClick={clearFollowUp}>Clear follow-up</Button>}</div>
          </form>
          {information.followUp && <p className="mt-4 text-sm">Current: <strong>{new Date(information.followUp.nextFollowUpAt).toLocaleString()}</strong>{information.followUp.ownerName ? ` · ${information.followUp.ownerName}` : " · Unassigned"}</p>}
        </section>

        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">Log client interaction</h2>
          <p className="mt-1 text-sm text-muted-foreground">Calls, emails, texts, meetings, site visits, documents/submittals sent to clients, and custom interaction types count as meaningful contact.</p>
          <form className="mt-4 grid gap-3" onSubmit={saveInteraction}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="interaction-contact">Client contact</Label>
                <select id="interaction-contact" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={interactionContactId} onChange={(event) => setInteractionContactId(event.target.value)} required>
                  <option value="">Choose a client contact</option>
                  {information.clientContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}
                </select>
              </div>
              <div className="space-y-2"><Label htmlFor="interaction-type">Type</Label><select id="interaction-type" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={interactionType} onChange={(event) => setInteractionType(event.target.value)}>{information.interactionTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}<option value={CUSTOM_INTERACTION_TYPE_OPTION}>Add another interaction type…</option></select></div>
              <div className="space-y-2"><Label htmlFor="interaction-direction">Direction</Label><select id="interaction-direction" className="flex h-9 w-full rounded-md border bg-background px-3 text-sm" value={direction} onChange={(event) => setDirection(event.target.value === "inbound" ? "inbound" : "outbound")}><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></div>
              <div className="space-y-2"><Label htmlFor="interaction-time">When</Label><Input id="interaction-time" type="datetime-local" value={interactionTime} onChange={(event) => setInteractionTime(event.target.value)} required /></div>
            </div>
            {interactionType === CUSTOM_INTERACTION_TYPE_OPTION && <div className="space-y-2"><Label htmlFor="custom-interaction-type">Custom interaction type</Label><Input id="custom-interaction-type" value={customInteractionTypeLabel} onChange={(event) => setCustomInteractionTypeLabel(event.target.value)} maxLength={60} placeholder="For example: Design review" aria-describedby="custom-interaction-type-help" required /><p id="custom-interaction-type-help" className="text-xs text-muted-foreground">After the first logged interaction, this choice becomes available on every project in your organization.</p></div>}
            <div className="space-y-2"><Label htmlFor="interaction-summary">Outcome / summary</Label><Textarea id="interaction-summary" value={interactionSummary} onChange={(event) => setInteractionSummary(event.target.value)} rows={3} required /></div>
            <div><Button type="submit" disabled={pending}>Log interaction</Button></div>
          </form>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">Project notes</h2>
          <form className="mt-3 space-y-2" onSubmit={saveNote}><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a project note…" rows={3} required /><Button type="submit" disabled={pending}>Add note</Button></form>
          <div className="mt-4 space-y-3">{information.notes.length === 0 ? <p className="text-sm text-muted-foreground">No project notes yet.</p> : information.notes.map((item) => <article className="rounded-md border p-3" key={item.id}><div className="flex items-start justify-between gap-3"><p className="whitespace-pre-wrap text-sm">{item.body}</p><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => removeNote(item.id)}>Delete</Button></div><p className="mt-2 text-xs text-muted-foreground">{item.authorName ?? "Unknown"} · {new Date(item.createdAt).toLocaleString()}</p></article>)}</div>
        </section>
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">Meaningful interaction history</h2>
          <div className="mt-4 space-y-3">{information.interactions.length === 0 ? <p className="text-sm text-muted-foreground">No meaningful client interaction recorded yet.</p> : information.interactions.map((item) => <article className="rounded-md border p-3" key={item.id}><div className="flex items-start justify-between gap-3"><div><Badge variant="outline">{item.direction} · {item.interactionTypeLabel}</Badge><p className="mt-2 whitespace-pre-wrap text-sm">{item.summary}</p></div><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => removeInteraction(item.id)}>Delete</Button></div><p className="mt-2 text-xs text-muted-foreground">{item.authorName ?? "Unknown"} · {new Date(item.occurredAt).toLocaleString()}{developerModeEnabled ? ` · ${item.source}` : ""}</p></article>)}</div>
        </section>
      </div>

      {developerModeEnabled && information.syncOperations.length > 0 && (
        <section className="rounded-lg border bg-card p-4 sm:p-5">
          <h2 className="font-semibold">External synchronization</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Project edits are retained in Compass. Pending or failed Google synchronization is visible here for safe retry.
          </p>
          <div className="mt-3 space-y-2">
            {information.syncOperations.map((operation) => (
              <div key={operation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>{operation.operation.replaceAll("_", " ")}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={operation.status === "failed" ? "destructive" : operation.status === "completed" ? "default" : "secondary"}>{operation.status}</Badge>
                  {operation.error && <span className="text-destructive">{operation.error}</span>}
                  {operation.status !== "completed" && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => retrySyncOperation(operation.id)}>Retry</Button>}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
