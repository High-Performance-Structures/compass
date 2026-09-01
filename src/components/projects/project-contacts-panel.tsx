import {
  IconAddressBook,
  IconBuildingStore,
  IconExternalLink,
  IconHome,
  IconMail,
  IconMapPin,
  IconPhone,
  IconShieldCheck,
} from "@tabler/icons-react"
import Link from "next/link"

import type {
  ProjectContactDirectoryOption,
  ProjectContactItem,
  ProjectContactSageOptions,
  ProjectContactsSummary,
} from "@/app/actions/project-contacts"
import { ProjectContactEditor } from "@/components/projects/project-contact-management"
import { ProjectContactInviteButton } from "@/components/projects/project-contact-invite-button"
import { ProjectContactInviteLauncher } from "@/components/projects/project-contact-invite-launcher"
import { Badge } from "@/components/ui/badge"
import { projectContactCanInvite } from "@/lib/project-contact-access-status"
import {
  buildProjectContactDisplayGroups,
  projectContactCanEdit,
  type ProjectContactDisplayGroupId,
} from "@/lib/project-contact-display"

function typeIcon(type: ProjectContactDisplayGroupId): React.ReactElement {
  switch (type) {
    case "owners":
      return <IconHome className="size-4 text-muted-foreground" />
    case "vendors":
      return <IconBuildingStore className="size-4 text-muted-foreground" />
    case "internal":
      return <IconShieldCheck className="size-4 text-muted-foreground" />
  }
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
    contact.companyName !== contact.displayName ? contact.companyName : null,
    contact.role,
    contact.trade,
  ].filter(Boolean).join(" · ")
}

function csiLabel(contact: ProjectContactItem): string | null {
  if (!contact.csiDivision || !contact.csiDivisionName) return null

  return `${contact.csiDivision} 00 00 - ${contact.csiDivisionName}`
}

function isCompanyOnlyVendor(contact: ProjectContactItem): boolean {
  return (
    (contact.contactType === "supplier" ||
      contact.contactType === "subcontractor") &&
    contact.vendorContactId === null
  )
}

function accessStatusLabel(contact: ProjectContactItem): string {
  switch (contact.accessStatus) {
    case "active":
      return "Active"
    case "pending":
      return "Invited"
    case "expired":
      return "Expired"
    case "inactive":
      return "Inactive"
    case "not_invited":
      return "Not invited"
  }
}

function accessStatusBadgeVariant(
  contact: ProjectContactItem
): "default" | "secondary" | "destructive" | "outline" {
  switch (contact.accessStatus) {
    case "active":
      return "default"
    case "pending":
      return "secondary"
    case "expired":
    case "inactive":
      return "destructive"
    case "not_invited":
      return "outline"
  }
}

function ContactCard({
  contact,
  projectId,
  projectLabel,
  compact = false,
  directoryOptions,
  sageOptions,
}: {
  readonly contact: ProjectContactItem
  readonly projectId: string
  readonly projectLabel: string
  readonly compact?: boolean
  readonly directoryOptions?: readonly ProjectContactDirectoryOption[]
  readonly sageOptions?: ProjectContactSageOptions
}): React.ReactElement {
  return (
    <article className="rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="line-clamp-1 text-sm font-medium">
              {contact.displayName}
            </p>
            <Badge variant={accessStatusBadgeVariant(contact)}>
              {accessStatusLabel(contact)}
            </Badge>
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
        <div className="flex items-center gap-2">
          <Badge variant="outline">{visibilityLabel(contact)}</Badge>
          {projectContactCanEdit(contact, directoryOptions) && directoryOptions ? (
            <ProjectContactEditor
              projectId={projectId}
              contact={contact}
              directoryOptions={directoryOptions}
              sageOptions={sageOptions ?? { divisions: [], costCodes: [] }}
            />
          ) : null}
        </div>
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
          {contact.address && (
            <span className="inline-flex items-center gap-1">
              <IconMapPin className="size-3" />
              {contact.address}
            </span>
          )}
        </div>
      )}

      {!compact && contact.notes && (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {contact.notes}
        </p>
      )}

      {!compact && isCompanyOnlyVendor(contact) && (
        <p className="mt-2 text-xs text-muted-foreground">
          Company assignment only. Select or add a contact person before sending
          a Compass invitation.
        </p>
      )}

      {!compact &&
        contact.active &&
        contact.email &&
        !isCompanyOnlyVendor(contact) &&
        projectContactCanInvite(contact.accessStatus) && (
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
  directoryOptions,
  sageOptions,
}: {
  readonly projectId: string
  readonly projectLabel?: string
  readonly summary: ProjectContactsSummary | null
  readonly showOpenLink?: boolean
  readonly directoryOptions?: readonly ProjectContactDirectoryOption[]
  readonly sageOptions?: ProjectContactSageOptions
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

  const displayGroups = buildProjectContactDisplayGroups(summary.allContacts)

  return (
    <section className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconAddressBook className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Project Contacts</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Owners, vendors, and internal team members mapped to this job.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {directoryOptions && (
            <ProjectContactEditor
              projectId={projectId}
              directoryOptions={directoryOptions}
              sageOptions={sageOptions ?? { divisions: [], costCodes: [] }}
            />
          )}
          {!showOpenLink && (
            <ProjectContactInviteLauncher
              projectId={projectId}
              projectLabel={projectLabel}
              contacts={summary.allContacts}
            />
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

    </section>
  )
}

export function ProjectContactsDirectory({
  projectId,
  projectLabel,
  summary,
  directoryOptions,
  sageOptions,
}: {
  readonly projectId: string
  readonly projectLabel: string
  readonly summary: ProjectContactsSummary
  readonly directoryOptions?: readonly ProjectContactDirectoryOption[]
  readonly sageOptions?: ProjectContactSageOptions
}): React.ReactElement {
  const displayGroups = buildProjectContactDisplayGroups(summary.allContacts)

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
                  directoryOptions={directoryOptions}
                  sageOptions={sageOptions}
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

      {summary.historicalContacts.length > 0 && (
        <section className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconShieldCheck className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                Former employees and historical internal users
              </h2>
            </div>
            <Badge variant="outline">{summary.historicalContacts.length}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Historical Buildertrend internal contacts are retained for the record.
            They are inactive, uninvited, and excluded from active project access.
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {summary.historicalContacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                projectId={projectId}
                projectLabel={projectLabel}
                directoryOptions={directoryOptions}
                sageOptions={sageOptions}
              />
            ))}
          </div>
        </section>
      )}

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
