"use server"

import { and, asc, desc, eq, inArray, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { projectProfileAuditEvents, projects } from "@/db/schema"
import { nuTechBracingRentalLines, nuTechBracingRentals } from "@/db/schema-nutech"
import type { AuthUser } from "@/lib/auth"
import { chunkD1Values } from "@/lib/d1-query"
import { isDemoOrg, isDemoUser } from "@/lib/demo"
import { isNuTechJob, nuTechOrgContext, readNuTechProject } from "@/lib/domain/nutech/access"
import { deleteNuTechBracingRentalStatement, saveNuTechBracingRentalStatements } from "@/lib/domain/nutech/store"
import type { BracingRentalSettings } from "@/lib/feature-settings/registry"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import {
  bracingAvailability,
  bracingCharges,
  bracingRentalDays,
  bracingSignOutIssues,
  isBracingRentalStatus,
  type BracingCharges,
  type BracingRentalStatus,
} from "@/lib/nutech/bracing"
import { requireFeaturePermission } from "@/lib/permission-enforcement"
import type { Db } from "@/lib/server/action-context"
import { isInternalStaffRole } from "@/lib/user-roles"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

type BracingRentalLineView = {
  readonly itemKey: string
  readonly itemLabel: string
  readonly size: string
  readonly quantityOut: number
  readonly quantityReturned: number
  readonly quantityDamaged: number
  readonly damageCents: number
  readonly damageNote: string
}

export type BracingRentalView = {
  readonly id: string
  readonly status: BracingRentalStatus
  readonly signedOutOn: string | null
  readonly expectedReturnOn: string | null
  readonly returnedOn: string | null
  readonly billedDays: number | null
  readonly dailyRateCents: number
  readonly depositCents: number
  readonly idCopyReceived: boolean
  readonly notes: string
  readonly lines: readonly BracingRentalLineView[]
  readonly charges: BracingCharges
}

export type ProjectBracingRentals = {
  readonly projectId: string
  readonly settings: BracingRentalSettings
  readonly rentals: readonly BracingRentalView[]
  readonly canEdit: boolean
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function bracingAccess(
  projectId: string | null,
  action: "read" | "update" | "delete",
): Promise<{ readonly user: AuthUser; readonly organizationId: string; readonly db: Db }> {
  const { db, user, organizationId } = await nuTechOrgContext()
  if (!isInternalStaffRole(user.role)) throw new Error("Bracing rentals are available to office staff.")
  await requireFeaturePermission(user, "nutech-orders", action)
  if (projectId !== null) {
    const project = await readNuTechProject(db, organizationId, projectId)
    if (!project) throw new Error("Project not found.")
    if (!isNuTechJob(project)) {
      throw new Error("Bracing rentals are kept on N jobs.")
    }
  }
  return { user, organizationId, db }
}

async function loadRentals(db: Db, organizationId: string, projectId: string, settings: BracingRentalSettings): Promise<readonly BracingRentalView[]> {
  const rentals = await db
    .select()
    .from(nuTechBracingRentals)
    .where(and(eq(nuTechBracingRentals.projectId, projectId), eq(nuTechBracingRentals.organizationId, organizationId)))
    .orderBy(desc(nuTechBracingRentals.createdAt))
  const lines = rentals.length
    ? await db
        .select()
        .from(nuTechBracingRentalLines)
        .where(inArray(nuTechBracingRentalLines.rentalId, rentals.map((rental) => rental.id)))
        .orderBy(asc(nuTechBracingRentalLines.sortOrder))
    : []
  return rentals.map((rental): BracingRentalView => {
    const own = lines.filter((line) => line.rentalId === rental.id)
    const days = rental.billedDays ?? bracingRentalDays(rental.signedOutOn, rental.returnedOn, today())
    return {
      id: rental.id,
      status: isBracingRentalStatus(rental.status) ? rental.status : "reserved",
      signedOutOn: rental.signedOutOn,
      expectedReturnOn: rental.expectedReturnOn,
      returnedOn: rental.returnedOn,
      billedDays: rental.billedDays,
      dailyRateCents: rental.dailyRateCents,
      depositCents: rental.depositCents,
      idCopyReceived: rental.idCopyReceived,
      notes: rental.notes ?? "",
      lines: own.map((line) => ({
        itemKey: line.itemKey,
        itemLabel: line.itemLabel,
        size: line.size,
        quantityOut: line.quantityOut,
        quantityReturned: line.quantityReturned,
        quantityDamaged: line.quantityDamaged,
        damageCents: line.damageCents,
        damageNote: line.damageNote ?? "",
      })),
      charges: bracingCharges({
        lines: own,
        billedItemKey: settings.billedItemKey,
        dailyRateCents: rental.dailyRateCents,
        days,
        depositCents: rental.depositCents,
      }),
    }
  })
}

/** A job's bracing rentals with charges, for the Nu-Tech order page. */
export async function getProjectBracingRentals(projectId: string): Promise<Result<ProjectBracingRentals>> {
  try {
    const { db, organizationId, user } = await bracingAccess(projectId, "read")
    const settings = await readFeatureSettings(db, organizationId, "bracing-rentals")
    const rentals = await loadRentals(db, organizationId, projectId, settings)
    const canEdit = await requireFeaturePermission(user, "nutech-orders", "update").then(
      () => true,
      () => false,
    )
    return { success: true, data: { projectId, settings, rentals, canEdit } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to load bracing rentals." }
  }
}

export type BracingRentalInput = {
  readonly projectId: string
  /** Null creates a new rental. */
  readonly rentalId: string | null
  /** "save" keeps the status; "sign_out" and "return" move it forward. */
  readonly action: "save" | "sign_out" | "return"
  readonly signedOutOn: string | null
  readonly expectedReturnOn: string | null
  readonly returnedOn: string | null
  readonly billedDays: number | null
  readonly depositCents: number
  readonly idCopyReceived: boolean
  readonly notes: string
  readonly lines: readonly {
    readonly itemKey: string
    readonly size: string
    readonly quantityOut: number
    readonly quantityReturned: number
    readonly quantityDamaged: number
    readonly damageCents: number
    readonly damageNote: string
  }[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function cleanDate(value: string | null, label: string): string | null {
  if (value === null || value.trim() === "") return null
  if (!DATE.test(value)) throw new Error(`${label} must be a date.`)
  return value
}

function wholeNumber(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000_000) throw new Error(`${label} must be a whole number of zero or more.`)
  return value
}

/**
 * Save a rental, and sign it out or check it in. Signing out needs the
 * company's deposit and ID rules met; checking in needs a return date and
 * returned counts no larger than what went out.
 */
export async function saveBracingRental(input: BracingRentalInput): Promise<Result<{ readonly id: string }>> {
  try {
    const { db, organizationId, user } = await bracingAccess(input.projectId, "update")
    if (isDemoUser(user.id) || isDemoOrg(organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const settings = await readFeatureSettings(db, organizationId, "bracing-rentals")
    const existing = input.rentalId
      ? await db
          .select()
          .from(nuTechBracingRentals)
          .where(
            and(
              eq(nuTechBracingRentals.id, input.rentalId),
              eq(nuTechBracingRentals.projectId, input.projectId),
              eq(nuTechBracingRentals.organizationId, organizationId),
            ),
          )
          .get()
      : undefined
    if (input.rentalId && !existing) return { success: false, error: "Rental not found." }

    const itemLabels = new Map(settings.items.map((item) => [item.key, item.label]))
    const lines = input.lines
      .map((line, index) => {
        const label = itemLabels.get(line.itemKey)
        if (!label) throw new Error("Choose a listed bracing item.")
        const quantityOut = wholeNumber(line.quantityOut, `${label} out`)
        const quantityReturned = wholeNumber(line.quantityReturned, `${label} returned`)
        const quantityDamaged = wholeNumber(line.quantityDamaged, `${label} damaged`)
        if (quantityReturned > quantityOut) throw new Error(`More ${label} returned than went out.`)
        if (quantityDamaged > quantityOut) throw new Error(`More ${label} damaged than went out.`)
        return {
          id: crypto.randomUUID(),
          itemKey: line.itemKey,
          itemLabel: label,
          size: line.size.trim().slice(0, 20),
          quantityOut,
          quantityReturned,
          quantityDamaged,
          damageCents: wholeNumber(line.damageCents, `${label} damage cost`),
          damageNote: line.damageNote.trim().slice(0, 300) || null,
          sortOrder: index,
        }
      })
      .filter((line) => line.quantityOut > 0 || line.quantityReturned > 0)

    const signedOutOn = cleanDate(input.signedOutOn, "Signed-out date")
    const expectedReturnOn = cleanDate(input.expectedReturnOn, "Expected return date")
    const returnedOn = cleanDate(input.returnedOn, "Returned date")
    const depositCents = wholeNumber(input.depositCents, "Deposit")
    const billedDays = input.billedDays === null ? null : wholeNumber(input.billedDays, "Days billed")
    const dailyRateCents = existing?.dailyRateCents ?? settings.dailyRateCents

    let status: BracingRentalStatus = existing && isBracingRentalStatus(existing.status) ? existing.status : "reserved"
    if (input.action === "sign_out") {
      if (!signedOutOn) return { success: false, error: "Enter the date the bracing went out." }
      const plannedDays = bracingRentalDays(signedOutOn, expectedReturnOn, signedOutOn)
      const charges = bracingCharges({ lines, billedItemKey: settings.billedItemKey, dailyRateCents, days: Math.max(1, plannedDays), depositCents })
      const issues = bracingSignOutIssues({
        settings,
        idCopyReceived: input.idCopyReceived,
        depositCents,
        expectedRentCents: charges.rentCents,
        quantityOut: lines.reduce((sum, line) => sum + line.quantityOut, 0),
      })
      if (issues.length > 0) return { success: false, error: issues.join(" ") }
      status = "out"
    }
    if (input.action === "return") {
      if (status !== "out") return { success: false, error: "Sign the bracing out before checking it in." }
      if (!returnedOn) return { success: false, error: "Enter the date the bracing came back." }
      if (signedOutOn && returnedOn < signedOutOn) return { success: false, error: "The return date is before the sign-out date." }
      status = "returned"
    }

    const now = new Date().toISOString()
    const id = existing?.id ?? crypto.randomUUID()
    const values = {
      status,
      signedOutOn,
      expectedReturnOn,
      returnedOn: status === "returned" ? returnedOn : null,
      billedDays,
      depositCents,
      idCopyReceived: input.idCopyReceived,
      notes: input.notes.trim().slice(0, 2000) || null,
      updatedBy: user.id,
      updatedAt: now,
    }
    await db.batch([
      ...saveNuTechBracingRentalStatements(db, {
        rentalId: id,
        create: existing ? null : { organizationId, projectId: input.projectId, dailyRateCents, createdBy: user.id, createdAt: now },
        values,
        lines,
      }),
      db.insert(projectProfileAuditEvents).values({
        id: crypto.randomUUID(),
        organizationId,
        projectId: input.projectId,
        actorUserId: user.id,
        eventType: input.action === "sign_out" ? "bracing_signed_out" : input.action === "return" ? "bracing_returned" : "bracing_rental_saved",
        entityType: "nutech_bracing_rental",
        entityId: id,
        beforeJson: existing ? JSON.stringify({ status: existing.status }) : null,
        afterJson: JSON.stringify({ status, lines: lines.map((line) => [line.itemKey, line.size, line.quantityOut, line.quantityReturned]) }),
        createdAt: now,
      }),
    ])
    revalidatePath(`/dashboard/projects/${input.projectId}/nutech`)
    revalidatePath(`/dashboard/projects/${input.projectId}`)
    revalidatePath("/dashboard/nutech")
    return { success: true, data: { id } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to save the rental." }
  }
}

/** Delete a rental that never went out. Signed-out rentals are kept for the record. */
export async function deleteBracingRental(projectId: string, rentalId: string): Promise<Result<null>> {
  try {
    const { db, organizationId, user } = await bracingAccess(projectId, "delete")
    if (isDemoUser(user.id) || isDemoOrg(organizationId)) return { success: false, error: "Demo data cannot be changed." }
    const rental = await db
      .select({ id: nuTechBracingRentals.id, status: nuTechBracingRentals.status })
      .from(nuTechBracingRentals)
      .where(
        and(
          eq(nuTechBracingRentals.id, rentalId),
          eq(nuTechBracingRentals.projectId, projectId),
          eq(nuTechBracingRentals.organizationId, organizationId),
        ),
      )
      .get()
    if (!rental) return { success: false, error: "Rental not found." }
    if (rental.status !== "reserved") return { success: false, error: "Bracing that went out is kept for the record and can't be deleted." }
    await db.batch([
      deleteNuTechBracingRentalStatement(db, rental.id),
      db.insert(projectProfileAuditEvents).values({
        id: crypto.randomUUID(),
        organizationId,
        projectId,
        actorUserId: user.id,
        eventType: "bracing_rental_deleted",
        entityType: "nutech_bracing_rental",
        entityId: rental.id,
        beforeJson: JSON.stringify({ status: rental.status }),
        afterJson: null,
        createdAt: new Date().toISOString(),
      }),
    ])
    revalidatePath(`/dashboard/projects/${projectId}/nutech`)
    revalidatePath("/dashboard/nutech")
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to delete the rental." }
  }
}

export type BracingInventory = {
  readonly availability: ReturnType<typeof bracingAvailability>
  readonly ownedConfigured: boolean
  readonly rentalsOut: readonly {
    readonly rentalId: string
    readonly projectId: string
    readonly projectNumber: string | null
    readonly projectName: string
    readonly status: BracingRentalStatus
    readonly signedOutOn: string | null
    readonly expectedReturnOn: string | null
    readonly braces: number
  }[]
}

/** What is out on jobs and what is left on the shelf: the whiteboard. */
export async function getBracingInventory(): Promise<Result<BracingInventory>> {
  try {
    const { db, organizationId } = await bracingAccess(null, "read")
    const settings = await readFeatureSettings(db, organizationId, "bracing-rentals")
    const rentals = await db
      .select({
        id: nuTechBracingRentals.id,
        projectId: nuTechBracingRentals.projectId,
        status: nuTechBracingRentals.status,
        signedOutOn: nuTechBracingRentals.signedOutOn,
        expectedReturnOn: nuTechBracingRentals.expectedReturnOn,
        projectNumber: projects.projectNumber,
        projectName: projects.name,
      })
      .from(nuTechBracingRentals)
      .innerJoin(projects, eq(projects.id, nuTechBracingRentals.projectId))
      .where(and(eq(nuTechBracingRentals.organizationId, organizationId), ne(nuTechBracingRentals.status, "returned")))
      .orderBy(asc(nuTechBracingRentals.expectedReturnOn))
    // Every open rental in the company: chunked to stay under D1's parameter limit.
    const lines = (
      await Promise.all(
        chunkD1Values(rentals.map((rental) => rental.id)).map((ids) =>
          db.select().from(nuTechBracingRentalLines).where(inArray(nuTechBracingRentalLines.rentalId, ids)),
        ),
      )
    ).flat()
    const outIds = new Set(rentals.filter((rental) => rental.status === "out").map((rental) => rental.id))
    return {
      success: true,
      data: {
        availability: bracingAvailability(settings.items, settings.sizes, lines.filter((line) => outIds.has(line.rentalId))),
        ownedConfigured: settings.items.some((item) => Object.values(item.owned).some((count) => count > 0)),
        rentalsOut: rentals.map((rental) => ({
          rentalId: rental.id,
          projectId: rental.projectId,
          projectNumber: rental.projectNumber,
          projectName: rental.projectName,
          status: isBracingRentalStatus(rental.status) ? rental.status : "reserved",
          signedOutOn: rental.signedOutOn,
          expectedReturnOn: rental.expectedReturnOn,
          braces: lines
            .filter((line) => line.rentalId === rental.id && line.itemKey === settings.billedItemKey)
            .reduce((sum, line) => sum + line.quantityOut - line.quantityReturned, 0),
        })),
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unable to load bracing inventory." }
  }
}
