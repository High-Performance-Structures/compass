import {
  IconAddressBook,
  IconBuildingStore,
  IconExternalLink,
  IconGitMerge,
  IconHome,
  IconMail,
  IconPhone,
  IconShieldCheck,
  IconUsers,
} from "@tabler/icons-react"
import Link from "next/link"

import type {
  ProjectContactItem,
  ProjectContactsSummary,
} from "@/app/actions/project-contacts"
import { ProjectContactInviteButton } from "@/components/projects/project-contact-invite-button"
import { ProjectContactInviteLauncher } from "@/components/projects/project-contact-invite-launcher"
import { Badge } from "@/components/ui/badge"

type ProjectContactDisplayGroupId = "customers" | "vendors" | "internal"

type ProjectContactDisplayGroup = {
  readonly id: ProjectContactDisplayGroupId
  readonly label: string
  readonly contacts: readonly ProjectContactItem[]
}

function typeIcon(type: ProjectContactDisplayGroupId): React.ReactElement {
  switch (type) {
    case "customers":
      return <IconHome className="size-4 text-muted-foreground" />
    case "vendors":
      return <IconBuildingStore className="size-4 text-muted-foreground" />
    case "internal":
      return <IconShieldCheck className="size-4 text-muted-foreground" />
  }
}

function buildDisplayGroups(
  contacts: readonly ProjectContactItem[]
): readonly ProjectContactDisplayGroup[] {
  return [
    {
      id: "customers",
      label: "Customers",
      contacts: contacts.filter((contact) => contact.contactType === "owner"),
    },
    {
      id: "vendors",
      label: "Vendors",
      contacts: contacts.filter(
        (contact) =>
          contact.contactType === "supplier" ||
          contact.contactType === "subcontractor"
      ),
    },
    {
      id: "internal",
      label: "Internal",
      contacts: contacts.filter((contact) => contact.contactType === "internal"),
    },
  ]
}

function visibilityLabel(contact: ProjectContactItem): string {
  const labels = []
  if (contact.ownerPortalVisible) labels.push("Owner")
  if (contact.subVendorPortalVisible) labels.push("Sub/vendor")
  if (contact.internalVisible) labels.push("Internal")
  return labels.join(" · ") || "Hidden"
}

function contactSubtitle(contact: ProjectContactItem): string {
  return [
    contact.companyName,
    contact.role,
    contact.trade,
  ].filter(Boolean).join(" · ")
}

function csiLabel(contact: ProjectContactItem): string | null {
  if (!contact.csiDivision || !contact.csiDivisionName) return null

  return `${contact.csiDivision} ${contact.csiDivisionName}`
}

function ContactCard({
  contact,
  projectId,
  projectLabel,
  compact = false,
}: {
  readonly contact: ProjectContactItem
  readonly projectId: string
  readonly projectLabel: string
  readonly compact?: boolean
}): React.ReactElement {
  return (
    <article className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="line-clamp-1 text-sm font-medium">
              {contact.displayName}
            </p>
            {contact.primaryContact && <Badge variant="secondary">Primary</Badge>}
            {csiLabel(contact) && (
              <Badge variant="outline">{csiLabel(contact)}</Badge>
            )}
          </div>
          {contactSubtitle(contact) && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {contactSubtitle(contact)}
            </p>
          )}
        </div>
        <Badge variant="outline">{visibilityLabel(contact)}</Badge>
      </div>

      {!compact && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {contact.email && (
            <span className="inline-flex items-center gap-1">
              <IconMail className="size-3" />
              {contact.email}
            </span>
          )}
          {contact.phone && (
            <span className="inline-flex items-center gap-1">
              <IconPhone className="size-3" />
              {contact.phone}
            </span>
          )}
        </div>
      )}

      {!compact && contact.notes && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {contact.notes}
        </p>
      )}

      {!compact && contact.email && (
        <div className="mt-3 flex justify-end">
          <ProjectContactInviteButton
            projectId={projectId}
            projectLabel={projectLabel}
            contactId={contact.id}
            contactName={contact.displayName}
            contactEmail={contact.email}
            contactType={contact.contactType}
          />
        </div>
      )}
    </article>
  )
}

export function ProjectContactsPanel({
  projectId,
  projectLabel = "This project",
  summary,
  showOpenLink = true,
}: {
  readonly projectId: string
  readonly projectLabel?: string
  readonly summary: ProjectContactsSummary | null
  readonly showOpenLink?: boolean
}): React.ReactElement {
  if (!summary) {
    return (
      <section className="rounded-lg border p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <IconAddressBook className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Project Contacts</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Project contact mapping is unavailable.
        </p>
      </section>
    )
  }

  const previewContacts = summary.allContacts.slice(0, 6)
  const reviewCount = summary.unmatchedSourceCount + summary.reviewSourceCount
  const displayGroups = buildDisplayGroups(summary.allContacts)

  return (
    <section className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconAddressBook className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Project Contacts</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Customers, vendors, and internal team members mapped to this job.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!showOpenLink && (
            <ProjectContactInviteLauncher
              projectId={projectId}
              projectLabel={projectLabel}
              contacts={summary.allContacts}
            />
          )}
          <Badge variant="secondary">{summary.totalCount} contacts</Badge>
          <Badge variant="outline">
            {summary.matchedSourceCount} Sage/schedule links
          </Badge>
          {reviewCount > 0 && (
            <Badge variant="outline">
              {reviewCount} to review
            </Badge>
          )}
          {summary.pendingAssignmentSourceCount > 0 && (
            <Badge variant="outline">
              {summary.pendingAssignmentSourceCount} TBD
            </Badge>
          )}
          {reviewCount > 0 && (
            <Link
              href={`/dashboard/projects/${projectId}/contacts/review`}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <IconGitMerge className="size-4" />
              Review matches
            </Link>
          )}
          {showOpenLink && (
            <Link
              href={`/dashboard/projects/${projectId}/contacts`}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <IconExternalLink className="size-4" />
              Open contacts
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-x-5 gap-y-3 border-y py-3 sm:grid-cols-3">
        {displayGroups.map((group) => (
          <div key={group.id} className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {typeIcon(group.id)}
                <span className="text-xs text-muted-foreground">
                  {group.label}
                </span>
              </div>
              <span className="text-lg font-semibold">
                {group.contacts.length}
              </span>
            </div>
          </div>
        ))}
      </div>

      {summary.csiGroups.length > 0 && (
        <div className="mt-4 rounded-md border bg-background p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Estimating scopes
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {summary.csiGroups.slice(0, 8).map((group) => (
              <Badge key={group.csiDivision} variant="outline">
                {group.csiDivision} {group.csiDivisionName} · {group.count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {previewContacts.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {previewContacts.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              projectId={projectId}
              projectLabel={projectLabel}
              compact
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
          No contacts have been mapped to this project yet.
        </p>
      )}

      <div className="mt-4 flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
        <IconUsers className="mt-0.5 size-4 shrink-0" />
        <p>
          This layer will reconcile Buildertrend contacts, Sage vendors, Sage
          job assignments, and Compass users before granting portal access.
        </p>
      </div>
    </section>
  )
}

export function ProjectContactsDirectory({
  projectId,
  projectLabel,
  summary,
}: {
  readonly projectId: string
  readonly projectLabel: string
  readonly summary: ProjectContactsSummary
}): React.ReactElement {
  const displayGroups = buildDisplayGroups(summary.allContacts)

  return (
    <div className="grid gap-4">
      {displayGroups.map((group) => (
        <section key={group.id} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {typeIcon(group.id)}
              <h2 className="text-sm font-semibold">{group.label}</h2>
            </div>
            <Badge variant="outline">{group.contacts.length}</Badge>
          </div>
          {group.contacts.length > 0 ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {group.contacts.map((contact) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  projectId={projectId}
                  projectLabel={projectLabel}
                />
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
              No {group.label.toLowerCase()} mapped yet.
            </p>
          )}
        </section>
      ))}

      {summary.csiGroups.length > 0 && (
        <section className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">CSI Estimating Scopes</h2>
            <Badge variant="outline">{summary.csiGroups.length}</Badge>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {summary.csiGroups.map((group) => (
              <div key={group.csiDivision} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {group.csiDivision} - {group.csiDivisionName}
                  </p>
                  <Badge variant="secondary">{group.count}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {group.contacts.map((contact) => contact.displayName).join(", ")}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
