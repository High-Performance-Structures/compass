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
  updateProjectMapVisibility,
  type ProjectFollowUpOwner,
  type ProjectInformation,
} from "@/app/actions/project-profile"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useDeveloperMode } from "@/components/developer-mode-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  customProjectInteractionType,
  projectNumberParts,
} from "@/lib/project-profile"
import { type ProjectDepartment } from "@/lib/project-branding"
import { isPortfolioMapVisibility, type PortfolioMapVisibility } from "@/lib/portfolio-map/visibility"
import { ProjectGoogleCalendarCard } from "@/components/projects/project-google-calendar-card"
import { projectNumberAndName } from "@/lib/project-display-name"

const CUSTOM_INTERACTION_TYPE_OPTION = "__custom__"
const UNASSIGNED_OWNER = "__unassigned__"

function suffixFromProjectNumber(projectNumber: string | null): string {
  if (!projectNumber) return ""
  return projectNumberParts(projectNumber)?.addressSuffix ?? ""
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
  const [publicTitle, setPublicTitle] = useState(
    information.project.publicTitle ?? "",
  )
  const [publicLocationCity, setPublicLocationCity] = useState(
    information.project.publicLocationCity ?? "",
  )
  const [department, setDepartment] = useState<ProjectDepartment | "">(
    information.project.department ?? "",
  )
  const [clientStatus, setClientStatus] = useState(information.project.clientStatus)
  const [jobStatusId, setJobStatusId] = useState(information.project.jobStatusId)
  const [mapVisibility, setMapVisibility] = useState<PortfolioMapVisibility>(
    information.project.portfolioMapVisibility,
  )
  const [mapMessage, setMapMessage] = useState<string | null>(null)
  const [mapPending, startMapTransition] = useTransition()
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
  const [profileMessage, setProfileMessage] = useState<string | null>(null)

  function refreshAfter(result: { readonly success: boolean; readonly error?: string }): void {
    setMessage(resultMessage(result))
    if (result.success) router.refresh()
  }

  function saveProfile(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const hasPublicTitle = publicTitle.trim().length > 0
    const hasPublicLocation = publicLocationCity.trim().length > 0
    if (hasPublicTitle !== hasPublicLocation) {
      const error = "Add both a privacy-safe public project title and a town/city, or leave both blank."
      setProfileMessage(error)
      setMessage(error)
      return
    }
    if (!department) {
      const error = "Choose ORC, HPS, Nu-Tech, or Design."
      setProfileMessage(error)
      setMessage(error)
      return
    }
    startTransition(async () => {
      const result = await updateProjectInformation({
        projectId: information.project.id,
        department,
        projectAddress,
        mailingAddress,
        publicTitle,
        publicLocationCity,
        clientStatus,
        jobStatusId,
        addressSuffix:
          information.project.projectNumber &&
          projectNumberParts(information.project.projectNumber)
            ? addressSuffix
            : null,
        updateClientDefaultMailingAddress: propagateMailingAddress,
      })
      setProfileMessage(resultMessage(result))
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
              ? projectNumberAndName(information.project, " · ")
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
              Site and mailing addresses are separate. Department is explicit; the project-number sequence stays fixed.
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
            <Select value={clientStatus} onValueChange={(value) => setClientStatus(value === "lead" ? "lead" : "customer")}>
              <SelectTrigger id="client-status" className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-department">
              Department <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Select
              value={department}
              onValueChange={(value) =>
                setDepartment(
                  value === "O" || value === "H" || value === "N" || value === "D"
                    ? value
                    : "",
                )
              }
              required
            >
              <SelectTrigger
                id="project-department"
                className="h-9 w-full"
                aria-describedby="project-department-help"
              >
                <SelectValue placeholder="Choose department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="O">ORC</SelectItem>
                <SelectItem value="H">HPS</SelectItem>
                <SelectItem value="N">Nu-Tech</SelectItem>
                <SelectItem value="D">Design</SelectItem>
              </SelectContent>
            </Select>
            <p id="project-department-help" className="text-xs text-muted-foreground">
              Controls department-specific workflows, including which connected social accounts receive posts.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="public-title">
              Privacy-safe public title <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id="public-title"
              value={publicTitle}
              maxLength={80}
              onChange={(event) => setPublicTitle(event.target.value)}
              placeholder="For example: Mountain View Renovation"
              aria-describedby="public-title-help"
            />
            <p id="public-title-help" className="text-xs text-muted-foreground">
              Required for social publishing. Keep it short and descriptive; do not use a client name, street, house number, or internal job name.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="public-location-city">
              Public town / city <span className="text-destructive" aria-hidden="true">*</span>
            </Label>
            <Input
              id="public-location-city"
              value={publicLocationCity}
              maxLength={80}
              onChange={(event) => setPublicLocationCity(event.target.value)}
              placeholder="Woodland Park"
              aria-describedby="public-location-help"
            />
            <p id="public-location-help" className="text-xs text-muted-foreground">
              Required for social publishing. Town or city only—no street, ZIP code, coordinates, neighborhood, or subdivision.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-status">Approved job status</Label>
            <SearchableCombobox
              id="job-status"
              className="h-9"
              ariaDescribedBy="job-status-help"
              value={jobStatusId}
              // The picker's empty reset must not clear the project's status.
              onValueChange={(value) => {
                if (value !== "") setJobStatusId(value)
              }}
              options={information.jobStatuses.map((status) => ({ value: status.id, label: status.label }))}
              ariaLabel="Approved job status"
              placeholder="Choose job status"
              searchPlaceholder="Search job statuses..."
              emptyMessage="No matching job statuses."
            />
            <p id="job-status-help" className="text-xs text-muted-foreground">
              Choose the approved operational stage for this project. {canManageJobStatuses ? "If a shared stage is genuinely missing, add it in the administrator-only section below." : "Only registry managers can add a shared status."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="map-visibility">Portfolio map</Label>
            <Select
              value={mapVisibility}
              disabled={mapPending}
              onValueChange={(next) => {
                if (!isPortfolioMapVisibility(next)) return
                const previous = mapVisibility
                setMapVisibility(next)
                setMapMessage(null)
                // Saves on its own, independent of the project information form.
                startMapTransition(async () => {
                  const result = await updateProjectMapVisibility({ projectId: information.project.id, visibility: next })
                  if (!result.success) {
                    setMapVisibility(previous)
                    setMapMessage(result.error)
                    return
                  }
                  setMapMessage("Portfolio map setting saved.")
                })
              }}
            >
              <SelectTrigger
                id="map-visibility"
                className="h-9 w-full"
                aria-describedby="map-visibility-help"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Follow job status (default)</SelectItem>
                <SelectItem value="shown">Always show on the map</SelectItem>
                <SelectItem value="hidden">Hide from the map</SelectItem>
              </SelectContent>
            </Select>
            <p id="map-visibility-help" className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {mapMessage ?? "By default, active HPS and Open Range jobs appear on the dashboard map; Internal and Nu-Tech jobs do not."}
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
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          {profileMessage ? (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {profileMessage}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>Save project information</Button>
        </div>
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
            <div className="space-y-2"><Label htmlFor="follow-up-owner">Owner</Label><SearchableCombobox
              id="follow-up-owner"
              className="h-9"
              // "" means unassigned; the picker needs a non-empty value for it.
              value={followUpOwnerId || UNASSIGNED_OWNER}
              onValueChange={(value) => setFollowUpOwnerId(value === UNASSIGNED_OWNER ? "" : value)}
              options={[
                { value: UNASSIGNED_OWNER, label: "Unassigned" },
                ...followUpOwners.map((owner) => ({ value: owner.id, label: owner.displayName })),
              ]}
              ariaLabel="Follow-up owner"
              placeholder="Unassigned"
              searchPlaceholder="Search staff..."
              emptyMessage="No matching staff."
            /></div>
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
                <SearchableCombobox
                  id="interaction-contact"
                  className="h-9"
                  value={interactionContactId}
                  onValueChange={setInteractionContactId}
                  options={information.clientContacts.map((contact) => ({ value: contact.id, label: contact.displayName }))}
                  ariaLabel="Client contact"
                  placeholder="Choose a client contact"
                  searchPlaceholder="Search client contacts..."
                  emptyMessage="No matching client contacts."
                  required
                />
              </div>
              <div className="space-y-2"><Label htmlFor="interaction-type">Type</Label><SearchableCombobox
                id="interaction-type"
                className="h-9"
                value={interactionType}
                onValueChange={(value) => {
                  if (value !== "") setInteractionType(value)
                }}
                options={[
                  ...information.interactionTypes.map((type) => ({ value: type.id, label: type.label })),
                  { value: CUSTOM_INTERACTION_TYPE_OPTION, label: "Add another interaction type…", keywords: "custom new other" },
                ]}
                ariaLabel="Interaction type"
                placeholder="Choose type"
                searchPlaceholder="Search interaction types..."
                emptyMessage="No matching interaction types."
              /></div>
              <div className="space-y-2"><Label htmlFor="interaction-direction">Direction</Label><Select value={direction} onValueChange={(value) => setDirection(value === "inbound" ? "inbound" : "outbound")}><SelectTrigger id="interaction-direction" className="h-9 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="outbound">Outbound</SelectItem><SelectItem value="inbound">Inbound</SelectItem></SelectContent></Select></div>
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
