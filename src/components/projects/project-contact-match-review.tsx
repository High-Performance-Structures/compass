import {
  IconCircleCheck,
  IconCircleDashed,
  IconClock,
  IconEyeCheck,
  IconLink,
  IconSearch,
  IconTrashX,
  IconUsersGroup,
} from "@tabler/icons-react"

import {
  addIndependentContactToProjectFromReview,
  approveContactSourceLink,
  assignContactSourceLink,
  createContactFromSourceLink,
  ignoreContactSourceLink,
  restoreContactSourceLink,
  updateProjectContactTypeFromReview,
  type ProjectContactItem,
  type ProjectContactMatchReview,
  type ProjectContactSourceLinkItem,
  type ProjectContactType,
  type IndependentContactItem,
} from "@/app/actions/project-contacts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ProjectContactDirectorySelect } from "@/components/projects/project-contact-directory-select"
import { ProjectContactReviewScrollRestorer } from "@/components/projects/project-contact-review-scroll-restorer"

async function approveContactSourceLinkForm(formData: FormData): Promise<void> {
  "use server"

  await approveContactSourceLink(formData)
}

async function assignContactSourceLinkForm(formData: FormData): Promise<void> {
  "use server"

  await assignContactSourceLink(formData)
}

async function addIndependentContactToProjectForm(
  formData: FormData
): Promise<void> {
  "use server"

  await addIndependentContactToProjectFromReview(formData)
}

async function createContactFromSourceLinkForm(
  formData: FormData
): Promise<void> {
  "use server"

  await createContactFromSourceLink(formData)
}

async function ignoreContactSourceLinkForm(formData: FormData): Promise<void> {
  "use server"

  await ignoreContactSourceLink(formData)
}

async function restoreContactSourceLinkForm(formData: FormData): Promise<void> {
  "use server"

  await restoreContactSourceLink(formData)
}

async function updateProjectContactTypeForm(formData: FormData): Promise<void> {
  "use server"

  await updateProjectContactTypeFromReview(formData)
}

function contactTypeLabel(type: ProjectContactType | null): string {
  switch (type) {
    case "owner":
      return "Customer"
    case "supplier":
      return "Vendor - supplier"
    case "subcontractor":
      return "Vendor - subcontractor"
    case "internal":
      return "Internal"
    case null:
      return "Not assigned"
  }
}

function statusBadge(link: ProjectContactSourceLinkItem): React.ReactElement {
  if (link.matchStatus === "matched") {
    return (
      <Badge className="bg-emerald-700 text-white hover:bg-emerald-700">
        Matched
      </Badge>
    )
  }

  if (link.matchStatus === "approved") {
    return (
      <Badge className="bg-primary text-primary-foreground hover:bg-primary">
        Approved
      </Badge>
    )
  }

  if (link.matchStatus === "review") {
    return <Badge variant="secondary">Review</Badge>
  }

  if (link.matchStatus === "ignored") {
    return <Badge variant="outline">Ignored</Badge>
  }

  if (link.matchStatus === "pending_assignment") {
    return <Badge variant="outline">Pending assignment</Badge>
  }

  return <Badge variant="outline">Unmatched</Badge>
}

function sourceSystemLabel(link: ProjectContactSourceLinkItem): string {
  return [
    link.sourceSystem,
    link.sourceRecordType,
    link.sourceRecordNumber,
  ].filter(Boolean).join(" · ")
}

function contactScope(contact: ProjectContactItem): string {
  return [
    contact.companyName,
    contact.trade,
    contact.csiDivision && contact.csiDivisionName
      ? `${contact.csiDivision} ${contact.csiDivisionName}`
      : null,
  ].filter(Boolean).join(" · ")
}

function reviewRank(link: ProjectContactSourceLinkItem): number {
  if (link.matchStatus === "review") return 0
  if (link.matchStatus === "unmatched") return 1
  if (link.matchStatus === "pending_assignment") return 2
  if (link.matchStatus === "matched") return 3
  if (link.matchStatus === "approved") return 4
  return 5
}

function MatchStat({
  label,
  value,
  icon,
}: {
  readonly label: string
  readonly value: number
  readonly icon: React.ReactNode
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

type SourceLinkGroup = {
  readonly id: string
  readonly primary: ProjectContactSourceLinkItem
  readonly links: readonly ProjectContactSourceLinkItem[]
}

function groupKey(link: ProjectContactSourceLinkItem): string {
  return [
    link.matchStatus,
    link.projectContactId ?? "none",
    link.sourceName,
  ].join("|")
}

function groupReviewLinks(
  links: readonly ProjectContactSourceLinkItem[]
): readonly SourceLinkGroup[] {
  const groups = new Map<string, ProjectContactSourceLinkItem[]>()

  for (const link of links) {
    const key = groupKey(link)
    const existing = groups.get(key) ?? []
    existing.push(link)
    groups.set(key, existing)
  }

  const result: SourceLinkGroup[] = []
  for (const [key, items] of groups.entries()) {
    const primary = items[0]
    if (!primary) continue
    result.push({ id: key, primary, links: items })
  }

  return result
}

function LinkIdInputs({
  links,
}: {
  readonly links: readonly ProjectContactSourceLinkItem[]
}): React.ReactElement {
  return (
    <>
      {links.map((link) => (
        <input key={link.id} type="hidden" name="linkId" value={link.id} />
      ))}
    </>
  )
}

function AssignContactForm({
  projectId,
  group,
  contacts,
}: {
  readonly projectId: string
  readonly group: SourceLinkGroup
  readonly contacts: readonly ProjectContactItem[]
}): React.ReactElement {
  const { primary } = group

  return (
    <form
      action={assignContactSourceLinkForm}
      data-contact-review-form="true"
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <LinkIdInputs links={group.links} />
      <select
        name="projectContactId"
        defaultValue={primary.projectContactId ?? ""}
        className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm shadow-xs outline-none transition-colors focus:border-ring focus:ring-ring/50 focus:ring-[3px]"
      >
        <option value="" disabled>
          Choose contact
        </option>
        {contacts.map((contact) => (
          <option key={contact.id} value={contact.id}>
            {contact.displayName} - {contactTypeLabel(contact.contactType)}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="secondary">
        <IconLink />
        Assign
      </Button>
    </form>
  )
}

function CreateContactForm({
  projectId,
  group,
}: {
  readonly projectId: string
  readonly group: SourceLinkGroup
}): React.ReactElement {
  if (group.primary.matchStatus !== "unmatched") {
    return <></>
  }

  return (
    <form
      action={createContactFromSourceLinkForm}
      data-contact-review-form="true"
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <LinkIdInputs links={group.links} />
      <select
        name="contactType"
        defaultValue="subcontractor"
        className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm shadow-xs outline-none transition-colors focus:border-ring focus:ring-ring/50 focus:ring-[3px]"
      >
        <option value="subcontractor">New subcontractor</option>
        <option value="supplier">New supplier</option>
        <option value="owner">New owner contact</option>
      </select>
      <Button type="submit" size="sm" variant="secondary">
        <IconLink />
        Create contact
      </Button>
    </form>
  )
}

function AddFromDirectoryForm({
  projectId,
  group,
  independentContacts,
}: {
  readonly projectId: string
  readonly group: SourceLinkGroup
  readonly independentContacts: readonly IndependentContactItem[]
}): React.ReactElement {
  if (group.primary.matchStatus !== "unmatched") {
    return <></>
  }

  return (
    <form
      action={addIndependentContactToProjectForm}
      data-contact-review-form="true"
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <LinkIdInputs links={group.links} />
      <ProjectContactDirectorySelect contacts={independentContacts} />
    </form>
  )
}


function UpdateContactTypeForm({
  projectId,
  link,
}: {
  readonly projectId: string
  readonly link: ProjectContactSourceLinkItem
}): React.ReactElement {
  if (!link.projectContactId || !link.contactType) {
    return <></>
  }

  return (
    <form
      action={updateProjectContactTypeForm}
      data-contact-review-form="true"
      className="flex flex-col gap-2 sm:flex-row"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectContactId" value={link.projectContactId} />
      <select
        name="contactType"
        defaultValue={link.contactType}
        className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm shadow-xs outline-none transition-colors focus:border-ring focus:ring-ring/50 focus:ring-[3px]"
      >
        <option value="subcontractor">Subcontractor</option>
        <option value="supplier">Supplier</option>
        <option value="owner">Owner</option>
      </select>
      <Button type="submit" size="sm" variant="outline">
        Update contact
      </Button>
    </form>
  )
}

function MatchReviewGroupRow({
  projectId,
  group,
  contacts,
  independentContacts,
}: {
  readonly projectId: string
  readonly group: SourceLinkGroup
  readonly contacts: readonly ProjectContactItem[]
  readonly independentContacts: readonly IndependentContactItem[]
}): React.ReactElement {
  const link = group.primary
  const visibleSourceRows = group.links.slice(0, 6)

  return (
    <article className="rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {statusBadge(link)}
            <p className="text-sm font-semibold">{link.sourceName}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {link.sourceLabel}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {sourceSystemLabel(link)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {group.links.length} source row{group.links.length === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline">
            {Math.round(link.matchConfidence * 100)}% confidence
          </Badge>
        </div>
      </div>

      <div className="mt-4 rounded-md border bg-muted/25 p-3">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Source rows
        </p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {visibleSourceRows.map((sourceLink) => (
            <li key={sourceLink.id}>
              {sourceLink.sourceLabel}
              {sourceLink.sourceRecordNumber
                ? ` · ${sourceLink.sourceRecordNumber}`
                : ""}
            </li>
          ))}
        </ul>
        {group.links.length > visibleSourceRows.length && (
          <p className="mt-2 text-xs text-muted-foreground">
            +{group.links.length - visibleSourceRows.length} more source rows
          </p>
        )}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.35fr]">
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Current match
          </p>
          <p className="mt-2 text-sm font-medium">
            {link.contactDisplayName ?? "No Compass contact selected"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {contactTypeLabel(link.contactType)}
            {link.csiDivision && link.csiDivisionName
              ? ` · ${link.csiDivision} ${link.csiDivisionName}`
              : ""}
          </p>
          {link.matchReason && (
            <p className="mt-3 text-xs text-muted-foreground">{link.matchReason}</p>
          )}
        </div>

        <div className="space-y-3">
          {!["ignored", "approved"].includes(link.matchStatus) && (
            <>
              <AssignContactForm
                projectId={projectId}
                group={group}
                contacts={contacts}
              />
              <AddFromDirectoryForm
                projectId={projectId}
                group={group}
                independentContacts={independentContacts}
              />
              <CreateContactForm projectId={projectId} group={group} />
              <UpdateContactTypeForm projectId={projectId} link={link} />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {link.projectContactId && link.matchStatus !== "approved" && (
              <form
                action={approveContactSourceLinkForm}
                data-contact-review-form="true"
              >
                <input type="hidden" name="projectId" value={projectId} />
                <LinkIdInputs links={group.links} />
                <Button type="submit" size="sm">
                  <IconEyeCheck />
                  Approve group
                </Button>
              </form>
            )}
            {link.matchStatus === "approved" && (
              <Badge variant="secondary">Approved and moved out of the active list</Badge>
            )}
            {link.matchStatus === "ignored" ? (
              <form
                action={restoreContactSourceLinkForm}
                data-contact-review-form="true"
              >
                <input type="hidden" name="projectId" value={projectId} />
                <LinkIdInputs links={group.links} />
                <Button type="submit" size="sm" variant="secondary">
                  <IconLink />
                  Restore group
                </Button>
              </form>
            ) : link.matchStatus !== "approved" ? (
              <form
                action={ignoreContactSourceLinkForm}
                data-contact-review-form="true"
              >
                <input type="hidden" name="projectId" value={projectId} />
                <LinkIdInputs links={group.links} />
                <Button type="submit" size="sm" variant="outline">
                  <IconTrashX />
                  Ignore group
                </Button>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export function ProjectContactMatchReviewPanel({
  review,
}: {
  readonly review: ProjectContactMatchReview
}): React.ReactElement {
  const sortedGroups = [...groupReviewLinks(review.links)].sort((left, right) => {
    const rankDiff = reviewRank(left.primary) - reviewRank(right.primary)
    if (rankDiff !== 0) return rankDiff
    return left.primary.sourceName.localeCompare(right.primary.sourceName)
  })

  return (
    <div className="grid gap-5">
      <ProjectContactReviewScrollRestorer />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MatchStat
          label="Matched"
          value={review.matchedCount}
          icon={<IconCircleCheck className="size-4 text-emerald-700" />}
        />
        <MatchStat
          label="Needs review"
          value={review.reviewCount}
          icon={<IconSearch className="size-4 text-primary" />}
        />
        <MatchStat
          label="Unmatched"
          value={review.unmatchedCount}
          icon={<IconCircleDashed className="size-4 text-muted-foreground" />}
        />
        <MatchStat
          label="TBD"
          value={review.pendingAssignmentCount}
          icon={<IconClock className="size-4 text-muted-foreground" />}
        />
        <MatchStat
          label="Approved"
          value={review.approvedCount}
          icon={<IconCircleCheck className="size-4 text-primary" />}
        />
        <MatchStat
          label="Ignored"
          value={review.ignoredCount}
          icon={<IconTrashX className="size-4 text-muted-foreground" />}
        />
      </section>

      <section className="rounded-lg border bg-muted/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <IconUsersGroup className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Compass Contacts</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              These are the approved project contacts available for assigning
              Sage, schedule, and Buildertrend source names.
            </p>
          </div>
          <Badge variant="secondary">{review.contacts.length} contacts</Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {review.contacts.map((contact) => (
            <Badge key={contact.id} variant="outline" title={contactScope(contact)}>
              {contact.displayName}
            </Badge>
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        {sortedGroups.length > 0 ? (
          sortedGroups.map((group) => (
            <MatchReviewGroupRow
              key={group.id}
              projectId={review.projectId}
              group={group}
              contacts={review.contacts}
              independentContacts={review.independentContacts}
            />
          ))
        ) : (
          <div className="rounded-lg border p-6 text-sm text-muted-foreground">
            No source links have been imported for this project yet.
          </div>
        )}
      </section>
    </div>
  )
}
