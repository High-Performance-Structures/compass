import { formatDate } from "@/lib/format"
import { isRecord } from "@/lib/shared/guards"

/*
 * Buildertrend lead proposals ("bt-lead-proposal/v1"), captured during the
 * Buildertrend cutover into buildertrend_staging_records rows of type
 * 'lead_proposal_detail'. This module validates one row's raw_payload_json
 * by narrowing (a row that fails is skipped by the caller, never trusted)
 * and holds the pure display rules: status labels and totals.
 *
 * Pure: no database or network access, safe in the browser.
 */

const BT_LEAD_PROPOSAL_SCHEMA = "bt-lead-proposal/v1"

/** The staging record type that holds a full proposal payload. */
export const BT_LEAD_PROPOSAL_RECORD_TYPE = "lead_proposal_detail"

const BT_PROPOSAL_STATUSES = [
  "approved",
  "approved_not_released",
  "declined",
  "declined_not_released",
  "pending",
  "pending_not_released",
  "viewed",
  "expired",
] as const

export type BtProposalStatus = (typeof BT_PROPOSAL_STATUSES)[number]

export type BtProposalItem = {
  readonly title: string
  readonly costCode: string | null
  readonly description: string | null
  readonly internalNotes: string | null
  readonly quantity: number
  readonly unit: string | null
  readonly unitCostCents: number
  readonly builderCostCents: number
  readonly markupPercent: number | null
  readonly markupCents: number
  readonly ownerPriceCents: number
}

export type BtProposalGroup = {
  readonly title: string
  readonly description: string | null
  readonly items: readonly BtProposalItem[]
  readonly subGroups: readonly BtProposalGroup[]
}

export type BtLeadProposal = {
  readonly schema: typeof BT_LEAD_PROPOSAL_SCHEMA
  readonly proposalId: string
  readonly leadId: string
  readonly title: string
  readonly leadTitle: string | null
  readonly status: BtProposalStatus
  /** Buildertrend's own words, e.g. "Proposal Approved on 1-16-2026 by …". */
  readonly statusText: string
  readonly statusDate: string | null
  readonly approvedByName: string | null
  /** The customer e-signed in Buildertrend (the signature image was not captured). */
  readonly signedInBuildertrend: boolean
  readonly approvalComments: string | null
  readonly approvalDeadline: string | null
  readonly addedByName: string | null
  readonly addedAt: string | null
  readonly updatedByName: string | null
  readonly updatedAt: string | null
  readonly ownerName: string | null
  readonly ownerEmail: string | null
  readonly address: string | null
  readonly introText: string | null
  readonly closingText: string | null
  readonly ownerTotalCents: number
  readonly builderCostTotalCents: number
  readonly groups: readonly BtProposalGroup[]
}

export type BtLeadProposalParseResult =
  | { readonly success: true; readonly proposal: BtLeadProposal }
  | { readonly success: false; readonly error: string }

/** Groups nest at most this deep (a group and its sub-groups). */
const MAX_GROUP_DEPTH = 2

class PayloadError extends Error {}

function fail(path: string, expected: string): never {
  throw new PayloadError(`${path} must be ${expected}`)
}

function str(source: Readonly<Record<string, unknown>>, key: string, path: string): string {
  const value = source[key]
  if (typeof value !== "string") fail(`${path}.${key}`, "a string")
  return value
}

function optStr(source: Readonly<Record<string, unknown>>, key: string, path: string): string | null {
  const value = source[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string") fail(`${path}.${key}`, "a string or null")
  return value
}

function num(source: Readonly<Record<string, unknown>>, key: string, path: string): number {
  const value = source[key]
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path}.${key}`, "a finite number")
  return value
}

function cents(source: Readonly<Record<string, unknown>>, key: string, path: string): number {
  const value = num(source, key, path)
  if (!Number.isSafeInteger(value)) fail(`${path}.${key}`, "whole cents")
  return value
}

function optNum(source: Readonly<Record<string, unknown>>, key: string, path: string): number | null {
  const value = source[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path}.${key}`, "a finite number or null")
  return value
}

function bool(source: Readonly<Record<string, unknown>>, key: string, path: string): boolean {
  const value = source[key]
  if (typeof value !== "boolean") fail(`${path}.${key}`, "true or false")
  return value
}

function list(source: Readonly<Record<string, unknown>>, key: string, path: string): readonly unknown[] {
  const value = source[key]
  if (!Array.isArray(value)) fail(`${path}.${key}`, "a list")
  return value
}

function object(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail(path, "an object")
  return value
}

function isBtProposalStatus(value: string): value is BtProposalStatus {
  return BT_PROPOSAL_STATUSES.some((status) => status === value)
}

function parseItem(value: unknown, path: string): BtProposalItem {
  const item = object(value, path)
  return {
    title: str(item, "title", path),
    costCode: optStr(item, "costCode", path),
    description: optStr(item, "description", path),
    internalNotes: optStr(item, "internalNotes", path),
    quantity: num(item, "quantity", path),
    unit: optStr(item, "unit", path),
    unitCostCents: cents(item, "unitCostCents", path),
    builderCostCents: cents(item, "builderCostCents", path),
    markupPercent: optNum(item, "markupPercent", path),
    markupCents: cents(item, "markupCents", path),
    ownerPriceCents: cents(item, "ownerPriceCents", path),
  }
}

function parseGroup(value: unknown, path: string, depth: number): BtProposalGroup {
  const group = object(value, path)
  const subGroups = list(group, "subGroups", path)
  if (depth >= MAX_GROUP_DEPTH && subGroups.length > 0) fail(`${path}.subGroups`, `empty below depth ${MAX_GROUP_DEPTH}`)
  return {
    title: str(group, "title", path),
    description: optStr(group, "description", path),
    items: list(group, "items", path).map((item, index) => parseItem(item, `${path}.items[${index}]`)),
    subGroups: subGroups.map((sub, index) => parseGroup(sub, `${path}.subGroups[${index}]`, depth + 1)),
  }
}

/**
 * Validates a "bt-lead-proposal/v1" payload: the JSON text from
 * raw_payload_json, or an already-parsed value.
 */
export function parseBtLeadProposal(raw: unknown): BtLeadProposalParseResult {
  try {
    let value: unknown = raw
    if (typeof raw === "string") {
      try {
        value = JSON.parse(raw)
      } catch {
        return { success: false, error: "The payload is not valid JSON." }
      }
    }
    const root = object(value, "proposal")
    const schema = root.schema
    if (schema !== BT_LEAD_PROPOSAL_SCHEMA) return { success: false, error: `Unsupported proposal schema: ${String(schema)}.` }
    const status = str(root, "status", "proposal")
    if (!isBtProposalStatus(status)) return { success: false, error: `Unknown proposal status: ${status}.` }
    const proposalId = str(root, "proposalId", "proposal")
    if (proposalId.trim() === "") fail("proposal.proposalId", "non-empty")
    return {
      success: true,
      proposal: {
        schema,
        proposalId,
        leadId: str(root, "leadId", "proposal"),
        title: str(root, "title", "proposal"),
        leadTitle: optStr(root, "leadTitle", "proposal"),
        status,
        statusText: str(root, "statusText", "proposal"),
        statusDate: optStr(root, "statusDate", "proposal"),
        approvedByName: optStr(root, "approvedByName", "proposal"),
        signedInBuildertrend: bool(root, "signedInBuildertrend", "proposal"),
        approvalComments: optStr(root, "approvalComments", "proposal"),
        approvalDeadline: optStr(root, "approvalDeadline", "proposal"),
        addedByName: optStr(root, "addedByName", "proposal"),
        addedAt: optStr(root, "addedAt", "proposal"),
        updatedByName: optStr(root, "updatedByName", "proposal"),
        updatedAt: optStr(root, "updatedAt", "proposal"),
        ownerName: optStr(root, "ownerName", "proposal"),
        ownerEmail: optStr(root, "ownerEmail", "proposal"),
        address: optStr(root, "address", "proposal"),
        introText: optStr(root, "introText", "proposal"),
        closingText: optStr(root, "closingText", "proposal"),
        ownerTotalCents: cents(root, "ownerTotalCents", "proposal"),
        builderCostTotalCents: cents(root, "builderCostTotalCents", "proposal"),
        groups: list(root, "groups", "proposal").map((group, index) => parseGroup(group, `proposal.groups[${index}]`, 1)),
      },
    }
  } catch (error) {
    if (error instanceof PayloadError) return { success: false, error: `Invalid proposal: ${error.message}.` }
    throw error
  }
}

/** The status line shown on the list and in the drawer. */
export function btProposalStatusLabel(proposal: Pick<BtLeadProposal, "status" | "approvedByName" | "approvalDeadline" | "statusDate">): string {
  switch (proposal.status) {
    case "approved":
      return proposal.approvedByName ? `Approved by ${proposal.approvedByName}` : "Approved"
    case "approved_not_released":
      return "Approved (not released)"
    case "declined":
      return proposal.approvedByName ? `Declined by ${proposal.approvedByName}` : "Declined"
    case "declined_not_released":
      return "Declined (not released)"
    case "pending":
      return "Pending"
    case "pending_not_released":
      return "Not released"
    case "viewed":
      return "Viewed by customer"
    case "expired": {
      const date = proposal.approvalDeadline ?? proposal.statusDate
      return date ? `Expired ${formatDate(date)}` : "Expired"
    }
  }
}

/** An item with the group (and sub-group) it sits in, in proposal order. */
export type BtProposalFlatItem = {
  readonly groupIndex: number
  readonly groupTitle: string
  readonly subGroupTitle: string | null
  readonly item: BtProposalItem
}

function groupItems(group: BtProposalGroup, groupIndex: number, top: string, sub: string | null): BtProposalFlatItem[] {
  return [
    ...group.items.map((item) => ({ groupIndex, groupTitle: top, subGroupTitle: sub, item })),
    ...group.subGroups.flatMap((child) => groupItems(child, groupIndex, top, child.title)),
  ]
}

/** Every item in proposal order: a group's own items, then its sub-groups'. */
export function flattenBtProposalItems(groups: readonly BtProposalGroup[]): readonly BtProposalFlatItem[] {
  return groups.flatMap((group, index) => groupItems(group, index, group.title, null))
}

export type BtProposalTotals = {
  readonly ownerPriceCents: number
  readonly builderCostCents: number
  readonly itemCount: number
}

/** Totals of the given groups' items, sub-groups included. */
export function btProposalTotals(groups: readonly BtProposalGroup[]): BtProposalTotals {
  const items = flattenBtProposalItems(groups)
  return {
    ownerPriceCents: items.reduce((sum, entry) => sum + entry.item.ownerPriceCents, 0),
    builderCostCents: items.reduce((sum, entry) => sum + entry.item.builderCostCents, 0),
    itemCount: items.length,
  }
}

/** A group with its totals worked out, for the drawer and the print. */
export type BtProposalGroupView = {
  readonly title: string
  readonly description: string | null
  readonly items: readonly BtProposalItem[]
  readonly subGroups: readonly BtProposalGroupView[]
  readonly ownerPriceCents: number
  readonly builderCostCents: number
}

export function btProposalGroupViews(groups: readonly BtProposalGroup[]): readonly BtProposalGroupView[] {
  return groups.map((group) => {
    const totals = btProposalTotals([group])
    return {
      title: group.title,
      description: group.description,
      items: group.items,
      subGroups: btProposalGroupViews(group.subGroups),
      ownerPriceCents: totals.ownerPriceCents,
      builderCostCents: totals.builderCostCents,
    }
  })
}

/** A captured attachment: a link to its verified Drive copy, or why there is none. */
export type BtProposalAttachment =
  | { readonly status: "verified"; readonly id: string; readonly label: string; readonly url: string }
  | { readonly status: "held"; readonly id: string; readonly label: string; readonly reason: string }

type StagedFile = {
  readonly id: string
  readonly fileName: string
  readonly verifiedDriveFileId: string | null
  readonly verifiedDriveUrl: string | null
}

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"])

/**
 * Links only to the verified Drive copy, and only when its URL is a plain
 * Google Drive address for that same file id (as Historical vendor bids do).
 */
export function btProposalAttachment(file: StagedFile): BtProposalAttachment {
  const label = file.fileName.trim() || "Attachment"
  const fileId = file.verifiedDriveFileId
  if (!fileId || !file.verifiedDriveUrl) return { status: "held", id: file.id, label, reason: "Not yet verified in Drive" }
  try {
    const url = new URL(file.verifiedDriveUrl)
    const sameFile = /^[A-Za-z0-9_-]+$/.test(fileId) && url.pathname.split("/").includes(fileId)
    if (url.protocol === "https:" && DRIVE_HOSTS.has(url.host) && !url.username && !url.password && sameFile) {
      return { status: "verified", id: file.id, label, url: url.toString() }
    }
  } catch {
    // Falls through to held: an unreadable URL is never linked.
  }
  return { status: "held", id: file.id, label, reason: "Drive link needs review" }
}
