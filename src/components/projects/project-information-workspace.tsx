"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition, type FormEvent, type ReactElement } from "react"

import {
  clearProjectFollowUp,
  createCustomProjectJobStatus,
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
  projectNumberParts,
} from "@/lib/project-profile"
import { type ProjectDepartment } from "@/lib/project-branding"
import { isPortfolioMapVisibility, type PortfolioMapVisibility } from "@/lib/portfolio-map/visibility"
import { ProjectGoogleCalendarCard } from "@/components/projects/project-google-calendar-card"
import { ImportedConversationsSetting } from "@/components/projects/imported-conversations-setting"
import { projectNumberAndName } from "@/lib/project-display-name"
import { PageHeader } from "@/components/page-header"
import { useDepartmentProfiles } from "@/components/branding/department-profiles-provider"
import { DEPARTMENT_CODES } from "@/lib/department-profiles"
import { FollowUpSection } from "@/components/projects/project-follow-up-aging"
import { ClientInteractionForm } from "@/components/projects/client-interaction-form"

/** A new custom status starts followed up on this cadence until changed in Settings. */
const NEW_STATUS_DEFAULT_CADENCE_DAYS = 7
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
  const departmentProfiles = useDepartmentProfiles()
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
  // Remount the form after each save so it starts empty again.
  const [interactionFormKey, setInteractionFormKey] = useState(0)
  const [followUpAt, setFollowUpAt] = useState(
    information.followUp ? dateTimeLocalValue(information.followUp.nextFollowUpAt) : "",
  )
  const [followUpOwnerId, setFollowUpOwnerId] = useState(
    information.followUp?.ownerUserId ?? "",
  )
  const [newJobStatusLabel, setNewJobStatusLabel] = useState("")
  const [newJobStatusSageCode, setNewJobStatusSageCode] = useState("")
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
      const error = "Choose a department."
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
    startTransition(async () => {
      // Follow-up timing is set in Settings → Workflows; this is only the starting default.
      const result = await createCustomProjectJobStatus({
        label: newJobStatusLabel,
        sageCode: newJobStatusSageCode || null,
        followUpCadenceDays: NEW_STATUS_DEFAULT_CADENCE_DAYS,
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
      <PageHeader
        className="mb-0"
        eyebrow={
          information.project.projectNumber
            ? projectNumberAndName(information.project, " · ")
            : information.project.name
        }
        title="Project Information"
        meta={
          information.projectNumberAliases.length > 0
            ? `Previous project number${information.projectNumberAliases.length === 1 ? "" : "s"}: ${information.projectNumberAliases.join(", ")}`
            : undefined
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/dashboard/projects/${information.project.id}/contacts`}>
              Manage contacts and email addresses
            </Link>
          </Button>
        }
      />

      {message && (
        <p className="border-l-2 border-l-primary pl-3 text-sm" role="status">
          {message}
        </p>
      )}

      <section id="log-client-interaction" aria-labelledby="log-client-interaction-title" className="scroll-mt-4 rounded-lg border-l-4 border-l-primary bg-muted/30 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="log-client-interaction-title" className="text-lg font-semibold">Log client interaction</h2>
          <a href="#interaction-history" className="text-sm text-primary underline-offset-4 hover:underline">
            {information.interactions.length} logged · view history
          </a>
        </div>
        <ClientInteractionForm
          key={interactionFormKey}
          projectId={information.project.id}
          idPrefix="info-interaction"
          options={{
            contacts: information.clientContacts,
            interactionTypes: information.interactionTypes,
            rules: information.interactionRules,
          }}
          onLogged={() => {
            setInteractionFormKey((value) => value + 1)
            setMessage("Client interaction logged. The follow-up clock has been reset.")
            router.refresh()
          }}
        />
      </section>

      <ProjectGoogleCalendarCard projectId={information.project.id} />

      <form className="border-t pt-5" onSubmit={saveProfile}>
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
                {DEPARTMENT_CODES.map((code) => (
                  <SelectItem key={code} value={code}>{departmentProfiles[code].shortName}</SelectItem>
                ))}
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
              {mapMessage ?? "By default, the dashboard map follows each department's setting in Settings → Workflows → Portfolio map."}
            </p>
          </div>
          <ImportedConversationsSetting
            projectId={information.project.id}
            staffOnly={information.project.importedConversationsStaffOnly}
          />
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
        <section className="border-t pt-5">
          <h2 className="font-semibold">Add an organization-specific status</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Add a genuinely missing shared stage only after your organization has
            approved it. The new stage becomes available to every project.
          </p>
          <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={createJobStatus}>
            <div className="space-y-2 md:col-span-2"><Label htmlFor="new-job-status">Custom status label</Label><Input id="new-job-status" value={newJobStatusLabel} onChange={(event) => setNewJobStatusLabel(event.target.value)} placeholder="For example: Warranty" aria-describedby="new-job-status-help" required /><p id="new-job-status-help" className="text-xs text-muted-foreground">Use printable basic Latin characters so the organization-wide label is unique.</p></div>
            {developerModeEnabled && <div className="space-y-2"><Label htmlFor="new-job-status-code">Optional Sage reference code</Label><Input id="new-job-status-code" value={newJobStatusSageCode} onChange={(event) => setNewJobStatusSageCode(event.target.value)} /></div>}
            <p className="text-sm text-muted-foreground md:col-span-2 md:self-end">
              Follow-up timing for every status, including new ones, is set in{" "}
              <Link href="/dashboard/settings?section=workflows&workflow=project-aging" className="text-primary underline-offset-4 hover:underline">Settings → Workflows → Project aging</Link>.
            </p>
            <div className="md:col-span-4"><Button type="submit" disabled={pending}>Add custom status</Button></div>
          </form>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <section id="client-follow-up" className="scroll-mt-4 border-t pt-5">
          <h2 className="font-semibold">Client follow-up</h2>
          {information.followUpSignal ? (
            <div className="mt-3 border-b pb-4">
              <FollowUpSection projectId={information.project.id} signal={information.followUpSignal} />
            </div>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">Set the next explicit follow-up and its owner. Logging a client interaction (top of this page) resets the aging clock.</p>
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

      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="border-t pt-5">
          <h2 className="font-semibold">Project notes</h2>
          <form className="mt-3 space-y-2" onSubmit={saveNote}><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a project note…" rows={3} required /><Button type="submit" disabled={pending}>Add note</Button></form>
          <div className="mt-4">{information.notes.length === 0 ? <p className="text-sm text-muted-foreground">No project notes yet.</p> : information.notes.map((item) => <article className="border-b py-3 first:border-t" key={item.id}><div className="flex items-start justify-between gap-3"><p className="whitespace-pre-wrap text-sm">{item.body}</p><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => removeNote(item.id)}>Delete</Button></div><p className="mt-2 text-xs text-muted-foreground">{item.authorName ?? "Unknown"} · {new Date(item.createdAt).toLocaleString()}</p></article>)}</div>
        </section>
        <section className="border-t pt-5">
          <h2 id="interaction-history" className="scroll-mt-4 font-semibold">Client interaction history</h2>
          <div className="mt-4">{information.interactions.length === 0 ? <p className="text-sm text-muted-foreground">No meaningful client interaction recorded yet.</p> : information.interactions.map((item) => <article className="border-b py-3 first:border-t" key={item.id}><div className="flex items-start justify-between gap-3"><div><Badge variant="outline">{item.direction} · {item.interactionTypeLabel}</Badge><p className="mt-2 whitespace-pre-wrap text-sm">{item.summary}</p></div><Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => removeInteraction(item.id)}>Delete</Button></div><p className="mt-2 text-xs text-muted-foreground">{item.authorName ?? "Unknown"} · {new Date(item.occurredAt).toLocaleString()}{developerModeEnabled ? ` · ${item.source}` : ""}</p></article>)}</div>
        </section>
      </div>

      {developerModeEnabled && information.syncOperations.length > 0 && (
        <section className="border-t pt-5">
          <h2 className="font-semibold">External synchronization</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Project edits are retained in Compass. Pending or failed Google synchronization is visible here for safe retry.
          </p>
          <div className="mt-3 divide-y border-y">
            {information.syncOperations.map((operation) => (
              <div key={operation.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>{operation.operation.replaceAll("_", " ")}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={operation.status === "failed" ? "destructive" : operation.status === "completed" ? "default" : "secondary"}>{operation.status}</Badge>
                  {operation.error && <span className="text-destructive">{operation.error}</span>}
                  {operation.canRetry && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => retrySyncOperation(operation.id)}>Retry</Button>}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
