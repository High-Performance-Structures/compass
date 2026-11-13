/**
 * A choice's price may change while its selection is out for the owner's
 * signature (a Selection Phase signature being prepared or sent), but the
 * job's members in the company's chosen project roles are told (Settings ›
 * Selections; by default project managers, assistant project managers and
 * project administrators): product, old price, new price, and that it is out
 * for signature. The document the owner signs
 * was made with the old price.
 *
 * Bell plus email and push, through the notification standard (each
 * person's settings and the company digest apply), and an Activity entry.
 * Never fails the save that changed the price.
 */
import { and, eq, inArray } from "drizzle-orm"

import { projectFinishSelections } from "@/db/schema"
import { projectSelectionRoundSignatureItems, projectSelectionRoundSignatures } from "@/db/schema-selection-choices"
import { recordActivityEvents, type ActivityActor } from "@/lib/activity-log"
import { namedProjectManager, projectMembersWithRole } from "@/lib/domain/project/member-role"
import { formatCents } from "@/lib/format"
import { createNotificationEvent, createSystemNotificationEvent } from "@/lib/notifications/events"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole, projectRoleMatches } from "@/lib/user-roles"

import { readProjectSelectionSettings } from "./project-settings"

/** Round signature statuses that mean the owner's document is out for signature. */
const OUT_FOR_SIGNATURE = ["preparing", "sent"] as const

export type ChoicePriceChange = {
  readonly choiceId: string
  readonly selectionId: string
  readonly title: string
  readonly before: { readonly priceCents: number | null; readonly ownerPriceCents: number | null }
  readonly after: { readonly priceCents: number | null; readonly ownerPriceCents: number | null }
}

function priceChanged(change: ChoicePriceChange): boolean {
  return change.before.priceCents !== change.after.priceCents || change.before.ownerPriceCents !== change.after.ownerPriceCents
}

/** One line per price that moved: "owner price $1,200.00 → $1,350.00". */
function priceChangeText(change: ChoicePriceChange): string {
  const parts: string[] = []
  if (change.before.ownerPriceCents !== change.after.ownerPriceCents) {
    parts.push(`owner price ${formatCents(change.before.ownerPriceCents, { fallback: "not set" })} → ${formatCents(change.after.ownerPriceCents, { fallback: "not set" })}`)
  }
  if (change.before.priceCents !== change.after.priceCents) {
    parts.push(`supplier price ${formatCents(change.before.priceCents, { fallback: "not set" })} → ${formatCents(change.after.priceCents, { fallback: "not set" })}`)
  }
  return parts.join("; ")
}

/**
 * Tells the job's management team about each price change on a choice whose
 * selection is out for signature. `actor` is who changed it (they aren't
 * told about their own change), or null for a supplier's RFQ answer.
 */
export async function notifyPriceChangesDuringSignature(
  db: Db,
  input: {
    readonly projectId: string
    readonly changes: readonly ChoicePriceChange[]
    readonly actor: ActivityActor | null
    readonly now: string
  },
): Promise<void> {
  try {
    const changes = input.changes.filter(priceChanged)
    if (changes.length === 0) return
    const out = await db
      .select({
        selectionId: projectSelectionRoundSignatureItems.selectionId,
        signedChoiceId: projectSelectionRoundSignatureItems.choiceId,
        status: projectSelectionRoundSignatures.status,
        roundName: projectSelectionRoundSignatures.roundNameSnapshot,
        selectionName: projectFinishSelections.name,
      })
      .from(projectSelectionRoundSignatureItems)
      .innerJoin(projectSelectionRoundSignatures, eq(projectSelectionRoundSignatures.id, projectSelectionRoundSignatureItems.signatureId))
      .innerJoin(projectFinishSelections, eq(projectFinishSelections.id, projectSelectionRoundSignatureItems.selectionId))
      .where(
        and(
          eq(projectSelectionRoundSignatures.projectId, input.projectId),
          inArray(projectSelectionRoundSignatures.status, [...OUT_FOR_SIGNATURE]),
          inArray(projectSelectionRoundSignatureItems.selectionId, [...new Set(changes.map((change) => change.selectionId))]),
        ),
      )
    if (out.length === 0) return
    const signing = new Map(out.map((row) => [row.selectionId, row]))
    const affected = changes.flatMap((change) => {
      const row = signing.get(change.selectionId)
      return row ? [{ change, row }] : []
    })
    if (affected.length === 0) return

    const { organizationId, settings } = await readProjectSelectionSettings(db, input.projectId)
    if (!organizationId) return
    const actorId = input.actor?.id ?? null
    const roles = settings.priceChangeNoticeRoles
    // Membership roles are free text ("project-manager"); compare however they're spelled.
    const members = await projectMembersWithRole(db, input.projectId, (role) => projectRoleMatches(role, roles))
    // The project manager named on the job counts as one, even without a membership.
    const named = projectRoleMatches("project_manager", roles) ? await namedProjectManager(db, input.projectId) : null
    const byUser = new Map([...members, ...(named ? [named] : [])].map((member) => [member.userId, member]))
    // Only company staff are told, whatever the setting holds.
    const recipients = [...byUser.values()]
      .filter((member) => member.userId !== actorId && isInternalStaffRole(member.accountRole))
      .map((member) => ({ userId: member.userId, email: member.email }))

    await recordActivityEvents(
      db,
      affected.map(({ change, row }) => ({
        organizationId,
        projectId: input.projectId,
        actor: input.actor ?? { id: null, email: "rfq", displayName: "Supplier price", firstName: null, lastName: null, role: "system" },
        category: "field",
        action: "selection_price_changed_during_signature",
        entityType: "project_selection_choice",
        entityId: change.choiceId,
        summary: `${row.selectionName} · ${change.title}: ${priceChangeText(change)}, while the ${row.roundName} Selection Phase is out for the owner's signature.`,
        metadata: { selectionId: change.selectionId, before: change.before, after: change.after, signatureStatus: row.status },
        createdAt: input.now,
      })),
    )
    if (recipients.length === 0) return
    for (const { change, row } of affected) {
      const onDocument = row.signedChoiceId === change.choiceId
      const notice = {
        organizationId,
        projectId: input.projectId,
        eventType: "selection_price_changed_during_signature",
        sourceType: "project_selection_choice",
        sourceId: change.choiceId,
        title: `Price changed while out for signature: ${change.title}`,
        body:
          `${row.selectionName}: ${change.title} ${priceChangeText(change)}. ` +
          `The ${row.roundName} Selection Phase is ${row.status === "sent" ? "out for the owner's signature" : "being prepared for the owner's signature"}` +
          (onDocument ? " with the old price on the document." : " (this is not the choice on the document)."),
        href: `/dashboard/projects/${encodeURIComponent(input.projectId)}/selections`,
        priority: "high",
        audience: "internal",
        recipients,
        delivery: { inApp: true, email: true, push: true },
      }
      await (actorId ? createNotificationEvent({ ...notice, createdBy: actorId }) : createSystemNotificationEvent(notice))
    }
  } catch (error) {
    console.error("[selections] price change notice failed", { projectId: input.projectId, error })
  }
}
