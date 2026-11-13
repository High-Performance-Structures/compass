import { z } from "zod/v4"

import { USER_ROLES } from "@/lib/domain/identity/statuses"

/*
 * Settings > Workflows > Selections: the company's selection rounds (which
 * schedule item sets each round's due date), default lead times by
 * selection category, how many days ahead a long lead time is flagged, the
 * markup that prefills a choice's owner price from the supplier price, and
 * the over-budget percent at which a variance is treated as a change order,
 * whether owners confirm their choice by click, whether replacing an ordered
 * or installed selection starts a change order, and which project roles are
 * told when a price changes during a signature. Pure and client-safe.
 */

const roundSchema = z.object({
  /** Stable id stored on each selection; never shown. */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(80),
  /**
   * Text matched against the job's schedule item titles (first match, any
   * case). The round is due this many days before that item starts. Blank:
   * the round has no schedule date.
   */
  scheduleItem: z.string().trim().max(120),
  bufferDays: z.number().int().min(0).max(365),
})

export const selectionSettingsSchema = z.object({
  /** In the order they are released to the owner. */
  rounds: z.array(roundSchema).max(20),
  /** Default lead time in days for a selection category (e.g. "Tile": 21); a choice's own lead time wins. */
  leadTimeDays: z.record(z.string().trim().min(1).max(80), z.number().int().min(0).max(730)),
  /**
   * Warn this many days before a choice's order-by date (the selection's due
   * date minus the choice's lead time); a to-do goes to the project manager then.
   */
  leadTimeWarningDays: z.number().int().min(0).max(90),
  /** Owner price = supplier price plus this percent, when staff leave the owner price blank. Null: no prefill. */
  ownerMarkupPercent: z.number().min(0).max(1000).nullable(),
  /** A variance this far over budget is handled as a change order needing the owner's signature. */
  changeOrderThresholdPercent: z.number().min(0).max(100),
  /**
   * Owners may press "Confirm my choice" on a published decision. It records
   * their choice only; a signed document approves either way.
   */
  ownerChoiceConfirmation: z.boolean(),
  /** "Replace installed item" and "Owner changed selection after purchase" start a draft change order. */
  replacementChangeOrder: z.boolean(),
  /** Project roles told when a choice's price changes while its Selection Phase is out for signature. */
  priceChangeNoticeRoles: z.array(z.enum(USER_ROLES)).max(USER_ROLES.length),
})

export type SelectionSettings = z.infer<typeof selectionSettingsSchema>
export type SelectionRound = z.infer<typeof roundSchema>

const DEFAULT_SELECTION_SETTINGS: SelectionSettings = {
  rounds: [
    { id: "rough-in", name: "Rough-in", scheduleItem: "Rough-in", bufferDays: 21 },
    { id: "finishes", name: "Finishes", scheduleItem: "Drywall", bufferDays: 21 },
  ],
  leadTimeDays: {},
  leadTimeWarningDays: 7,
  ownerMarkupPercent: null,
  changeOrderThresholdPercent: 10,
  ownerChoiceConfirmation: true,
  replacementChangeOrder: true,
  priceChangeNoticeRoles: ["project_manager", "assistant_project_manager", "project_administrator"],
}

export const SELECTION_SETTINGS_GROUP = {
  label: "Selections",
  description:
    "Selection Phases and the schedule items that set their due dates, default lead times by category and how early a long lead time is flagged, the markup that fills in owner prices, when a variance becomes a change order, owner choice confirmation, replacement change orders, and who hears about price changes during a signature.",
  defaults: DEFAULT_SELECTION_SETTINGS,
  schema: selectionSettingsSchema,
}

/** The owner price the markup gives for a supplier price, or null when there is no markup. */
export function ownerPriceFromMarkup(priceCents: number | null, markupPercent: number | null): number | null {
  if (priceCents === null || markupPercent === null) return null
  return Math.round(priceCents * (1 + markupPercent / 100))
}

/** The category's default lead time (category names compare without case), or null. */
export function categoryLeadTimeDays(settings: Pick<SelectionSettings, "leadTimeDays">, category: string): number | null {
  const wanted = category.trim().toLocaleLowerCase()
  const match = Object.entries(settings.leadTimeDays).find(([name]) => name.trim().toLocaleLowerCase() === wanted)
  return match ? match[1] : null
}

/** A url-safe id for a new round, unique among `taken`. */
export function newRoundId(name: string, taken: readonly string[]): string {
  const base = name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "round"
  let id = base
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`
  return id
}
