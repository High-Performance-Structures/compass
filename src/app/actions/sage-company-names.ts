"use server"

import { and, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { customers, vendors } from "@/db/schema"
import { sageClientDirectoryEntries, sageVendorDirectoryEntries } from "@/db/schema-sage"
import { actionFailure, errorMessage, type ActionResult } from "@/lib/action-result"
import { recordActivityEvent } from "@/lib/activity-log"
import { adoptSageCompanyName as writeSageCompanyName } from "@/lib/domain/contacts/store"
import {
  sageCompanyNameError,
  sageCompanyNameStatus,
  type SageCompanyKind,
  type SageCompanyNameEntry,
  type SageCompanyNameStatus,
} from "@/lib/sage/company-name-adoption"
import { orgContext, type Db } from "@/lib/server/action-context"

export type SageCompanyNameState = {
  readonly compassName: string
  readonly sageName: string | null
  readonly sageNumber: string | null
  readonly capturedAt: string | null
  readonly status: SageCompanyNameStatus
}

type Loaded = SageCompanyNameState & { readonly sageRecordId: string | null }

function companyKind(input: string): SageCompanyKind | null {
  return input === "client_company" || input === "vendor_company" ? input : null
}

function feature(kind: SageCompanyKind): "customers" | "vendors" {
  return kind === "client_company" ? "customers" : "vendors"
}

async function sageEntry(
  db: Db, organizationId: string, kind: SageCompanyKind, sageRecordId: string, sageNumber: string | null
): Promise<SageCompanyNameEntry | null> {
  // Numbers are unique per organization in Sage's lists; without one, the
  // writers store the record id lowercased.
  if (kind === "client_company") {
    const row = await db.select({
      sageRecordId: sageClientDirectoryEntries.sageRecordId,
      sageNumber: sageClientDirectoryEntries.sageClientNumber,
      name: sageClientDirectoryEntries.name,
      capturedAt: sageClientDirectoryEntries.capturedAt,
    }).from(sageClientDirectoryEntries).where(and(
      eq(sageClientDirectoryEntries.organizationId, organizationId),
      sageNumber === null
        ? eq(sageClientDirectoryEntries.sageRecordId, sageRecordId.toLowerCase())
        : eq(sageClientDirectoryEntries.sageClientNumber, sageNumber)
    )).get()
    return row ?? null
  }
  const row = await db.select({
    sageRecordId: sageVendorDirectoryEntries.sageRecordId,
    sageNumber: sageVendorDirectoryEntries.sageVendorNumber,
    name: sageVendorDirectoryEntries.name,
    capturedAt: sageVendorDirectoryEntries.capturedAt,
  }).from(sageVendorDirectoryEntries).where(and(
    eq(sageVendorDirectoryEntries.organizationId, organizationId),
    sageNumber === null
      ? eq(sageVendorDirectoryEntries.sageRecordId, sageRecordId.toLowerCase())
      : eq(sageVendorDirectoryEntries.sageVendorNumber, sageNumber)
  )).get()
  return row ?? null
}

async function loadState(db: Db, organizationId: string, kind: SageCompanyKind, entityId: string): Promise<Loaded | null> {
  const company = kind === "client_company"
    ? await db.select({ name: customers.name, sageRecordId: customers.sageClientId, sageNumber: customers.sageClientNumber })
        .from(customers).where(and(eq(customers.id, entityId), eq(customers.organizationId, organizationId),
          isNull(customers.mergedIntoCustomerId))).get()
    : await db.select({ name: vendors.name, sageRecordId: vendors.sageVendorId, sageNumber: vendors.sageVendorNumber })
        .from(vendors).where(and(eq(vendors.id, entityId), eq(vendors.organizationId, organizationId),
          eq(vendors.directoryStatus, "active"))).get()
  if (!company) return null
  const entry = company.sageRecordId
    ? await sageEntry(db, organizationId, kind, company.sageRecordId, company.sageNumber)
    : null
  const status = sageCompanyNameStatus({
    compassName: company.name, sageRecordId: company.sageRecordId, sageNumber: company.sageNumber, entry,
  })
  return {
    compassName: company.name,
    sageName: entry && status !== "missing" ? entry.name.trim() : null,
    sageNumber: company.sageNumber,
    capturedAt: entry?.capturedAt ?? null,
    status,
    sageRecordId: company.sageRecordId,
  }
}

/** Compass's and Sage's names for a Sage-linked client or vendor company. */
export async function getSageCompanyNameState(
  kindInput: string, entityId: string
): Promise<ActionResult<SageCompanyNameState>> {
  const kind = companyKind(kindInput)
  if (!kind || !entityId.trim()) return actionFailure("Invalid company")
  const ctx = await orgContext({ feature: feature(kind) })
  if (!ctx.success) return ctx
  try {
    const loaded = await loadState(ctx.data.db, ctx.data.organizationId, kind, entityId)
    if (!loaded) return actionFailure("Company not found")
    return {
      success: true,
      data: {
        compassName: loaded.compassName, sageName: loaded.sageName, sageNumber: loaded.sageNumber,
        capturedAt: loaded.capturedAt, status: loaded.status,
      },
    }
  } catch (error) {
    return actionFailure(errorMessage(error, "Could not load the Sage name."))
  }
}

/**
 * Sets the Compass company name to exactly the name Sage holds. Writes
 * nothing to Sage; refuses when Sage's list is missing or stale.
 */
export async function adoptSageCompanyName(
  kindInput: string, entityId: string
): Promise<ActionResult<{ readonly name: string; readonly changed: boolean }>> {
  const kind = companyKind(kindInput)
  if (!kind || !entityId.trim()) return actionFailure("Invalid company")
  const ctx = await orgContext({ feature: feature(kind), action: "update", mutation: true })
  if (!ctx.success) return ctx
  const { db, organizationId, user } = ctx.data
  try {
    const loaded = await loadState(db, organizationId, kind, entityId)
    if (!loaded) return actionFailure("Company not found")
    const refused = sageCompanyNameError(kind, loaded.status)
    if (refused) return actionFailure(refused)
    if (loaded.status === "same" || !loaded.sageName || !loaded.sageRecordId) {
      return { success: true, data: { name: loaded.compassName, changed: false } }
    }
    const written = await writeSageCompanyName(db, {
      kind, id: entityId, organizationId, sageRecordId: loaded.sageRecordId,
      previousName: loaded.compassName, name: loaded.sageName, now: new Date().toISOString(),
    })
    if (!written) return actionFailure("This company changed while you were working. Reload and try again.")
    const entityType = kind === "client_company" ? "customer" : "vendor"
    await recordActivityEvent({
      db, organizationId, actor: user, category: "financial",
      action: `${entityType}.sage_name_adopted`, entityType, entityId,
      summary: `Renamed ${loaded.compassName} to the Sage name ${loaded.sageName}`,
      metadata: { previousName: loaded.compassName, sageName: loaded.sageName, sageNumber: loaded.sageNumber },
    })
    revalidatePath("/dashboard/contacts")
    revalidatePath(kind === "client_company" ? "/dashboard/customers" : "/dashboard/vendors")
    revalidatePath("/dashboard/projects", "layout")
    return { success: true, data: { name: loaded.sageName, changed: true } }
  } catch (error) {
    return actionFailure(errorMessage(error, "Could not use the Sage name."))
  }
}
