"use server"

import { and, asc, desc, eq, gte, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod/v4"

import { getDb } from "@/db"
import { projects, users } from "@/db/schema"
import { equipmentLogEntries, equipmentMachines, equipmentServiceItems } from "@/db/schema-equipment"
import { rateBookEntries } from "@/db/schema-rate-book"
import { requireAuth, type AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { isDemoUser } from "@/lib/demo"
import {
  isMachineLogKind,
  machineTimeChargeCents,
  serviceDue,
  validateMachineLog,
  type MachineLogDraft,
  type MachineLogKind,
  type ServiceDue,
} from "@/lib/equipment/model"
import { loadProjectCostCodeCatalog, loadProjectCostCodeChoices } from "@/lib/cost-codes/catalog-server"
import { requireOrg } from "@/lib/org-scope"
import { canFeature } from "@/lib/permission-enforcement"
import { projectNumberAndName } from "@/lib/project-display-name"
import { companyToday } from "@/lib/internal-duties/recurring-data"
import { isInternalStaffRole } from "@/lib/user-roles"

type Db = ReturnType<typeof getDb>
type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

const PAGE = "/dashboard/equipment"
const FEATURE = "equipment"

export type MachineView = {
  readonly id: string
  readonly name: string
  readonly sageEquipmentNumber: string | null
  readonly rateBookEntryId: string | null
  readonly rateBookName: string | null
  readonly runningRateCents: number | null
  readonly standbyRateCents: number | null
  readonly idleRateCents: number | null
  readonly hourMeter: number | null
  readonly hourMeterOn: string | null
  readonly locationLabel: string | null
  readonly active: boolean
  readonly notes: string | null
  readonly entryCount: number
  readonly services: readonly {
    readonly id: string
    readonly name: string
    readonly everyHours: number | null
    readonly everyDays: number | null
    readonly lastDoneHours: number | null
    readonly lastDoneOn: string | null
    readonly due: ServiceDue
  }[]
}

export type MachineLogEntryView = {
  readonly id: string
  readonly machineId: string
  readonly machineName: string
  readonly kind: MachineLogKind
  readonly entryDate: string
  readonly projectId: string | null
  readonly projectLabel: string | null
  readonly operatorName: string | null
  readonly costCode: string | null
  readonly runningHours: number | null
  readonly standbyHours: number | null
  readonly idleHours: number | null
  readonly hourMeter: number | null
  readonly gallons: number | null
  readonly amountCents: number | null
  readonly vendor: string | null
  readonly paidWith: string | null
  readonly serviceItemId: string | null
  readonly serviceName: string | null
  readonly shopHours: number | null
  readonly chargeCents: number | null
  readonly notes: string | null
  readonly status: "pending" | "approved" | "rejected"
  readonly loggedBy: string
  readonly canChange: boolean
}

export type MachineCostCodeOption = {
  readonly value: string
  readonly label: string
  readonly onBudget?: boolean
}

/** Load after choosing a job so machine logs follow the same budget/search rules. */
export async function getMachineCostCodeOptions(projectId: string): Promise<Result<readonly MachineCostCodeOption[]>> {
  try {
    const { db, orgId } = await context()
    const project = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId))).get()
    if (!project) return { success: false, error: "Project not found." }
    const codes = await loadProjectCostCodeChoices(db, project.id)
    return { success: true, data: codes.map((code) => ({ value: code.code, label: code.displayLabel, onBudget: code.onBudget })) }
  } catch (error) {
    return failure(error, "Couldn't load project cost codes.")
  }
}

export type EquipmentWorkspace = {
  readonly today: string
  readonly month: string
  readonly machines: readonly MachineView[]
  readonly pending: readonly MachineLogEntryView[]
  readonly entries: readonly MachineLogEntryView[]
  readonly totals: {
    readonly runningHours: number
    readonly fuelCents: number
    readonly serviceCents: number
    readonly servicesDue: number
  }
  readonly hoursByJob: readonly { readonly label: string; readonly runningHours: number; readonly otherHours: number; readonly chargeCents: number }[]
  readonly rateBookMachines: readonly { readonly value: string; readonly label: string }[]
  readonly jobs: readonly { readonly value: string; readonly label: string }[]
  readonly costCodes: readonly MachineCostCodeOption[]
  readonly canManage: boolean
}

function nameOf(user: { readonly displayName: string | null; readonly firstName: string | null; readonly lastName: string | null } | null): string {
  if (!user) return "Unknown"
  return user.displayName?.trim() || [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown"
}

async function context(): Promise<{ readonly db: Db; readonly user: AuthUser; readonly orgId: string }> {
  const user = await requireAuth()
  if (!user.isActive || !isInternalStaffRole(user.role)) throw new Error("The machine log is for company staff.")
  const orgId = requireOrg(user)
  const { env } = await getCloudflareContext()
  return { db: getDb(env.DB), user, orgId }
}

async function editContext(): Promise<{ readonly db: Db; readonly user: AuthUser; readonly orgId: string; readonly canManage: boolean }> {
  const ctx = await context()
  if (isDemoUser(ctx.user.id)) throw new Error("The demo account can't change the machine log.")
  return { ...ctx, canManage: await canFeature(ctx.user, FEATURE, "approve") }
}

function failure(error: unknown, fallback: string): { readonly success: false; readonly error: string } {
  return { success: false, error: error instanceof Error ? error.message : fallback }
}

export async function getEquipmentWorkspace(): Promise<EquipmentWorkspace> {
  const { db, user, orgId } = await context()
  const today = companyToday()
  const month = today.slice(0, 7)
  const since = `${month}-01`
  const recentSince = new Date(Date.parse(`${today}T12:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10)

  const [machineRows, serviceRows, entryRows, pendingRows, rateRows, jobRows, costCodeCatalog, canManage] = await Promise.all([
    db
      .select({ machine: equipmentMachines, rateName: rateBookEntries.name, rateCents: rateBookEntries.unitCostCents, locationName: projects.name, locationNumber: projects.projectNumber })
      .from(equipmentMachines)
      .leftJoin(rateBookEntries, eq(rateBookEntries.id, equipmentMachines.rateBookEntryId))
      .leftJoin(projects, eq(projects.id, equipmentMachines.locationProjectId))
      .where(eq(equipmentMachines.organizationId, orgId))
      .orderBy(desc(equipmentMachines.active), asc(equipmentMachines.name)),
    db.select().from(equipmentServiceItems).where(eq(equipmentServiceItems.organizationId, orgId)).orderBy(asc(equipmentServiceItems.name)),
    loadEntries(db, orgId, and(eq(equipmentLogEntries.organizationId, orgId), gte(equipmentLogEntries.entryDate, recentSince))),
    loadEntries(db, orgId, and(eq(equipmentLogEntries.organizationId, orgId), eq(equipmentLogEntries.status, "pending"))),
    db
      .select({ id: rateBookEntries.id, name: rateBookEntries.name, unit: rateBookEntries.unit, cents: rateBookEntries.unitCostCents })
      .from(rateBookEntries)
      .where(and(eq(rateBookEntries.organizationId, orgId), eq(rateBookEntries.category, "machine"), eq(rateBookEntries.status, "active")))
      .orderBy(asc(rateBookEntries.name)),
    db
      .select({ id: projects.id, name: projects.name, projectNumber: projects.projectNumber })
      .from(projects)
      .where(and(eq(projects.organizationId, orgId), eq(projects.status, "OPEN")))
      .orderBy(asc(projects.projectNumber)),
    loadProjectCostCodeCatalog(db),
    canFeature(user, FEATURE, "approve"),
  ])

  const entryCounts = new Map<string, number>()
  for (const entry of [...entryRows, ...pendingRows]) entryCounts.set(entry.machineId, (entryCounts.get(entry.machineId) ?? 0) + 1)
  const machines: MachineView[] = machineRows.map(({ machine, rateName, rateCents, locationName, locationNumber }) => ({
    id: machine.id,
    name: machine.name,
    sageEquipmentNumber: machine.sageEquipmentNumber,
    rateBookEntryId: machine.rateBookEntryId,
    rateBookName: rateName,
    runningRateCents: rateCents,
    standbyRateCents: machine.standbyRateCents,
    idleRateCents: machine.idleRateCents,
    hourMeter: machine.hourMeter,
    hourMeterOn: machine.hourMeterOn,
    locationLabel: locationName ? projectNumberAndName({ name: locationName, projectNumber: locationNumber }) : null,
    active: machine.active,
    notes: machine.notes,
    entryCount: entryCounts.get(machine.id) ?? 0,
    services: serviceRows
      .filter((item) => item.machineId === machine.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        everyHours: item.everyHours,
        everyDays: item.everyDays,
        lastDoneHours: item.lastDoneHours,
        lastDoneOn: item.lastDoneOn,
        due: serviceDue(item, machine.hourMeter, today),
      })),
  }))

  const views = (rows: readonly EntryRow[]): MachineLogEntryView[] =>
    rows.map((row) => ({ ...row, canChange: canManage || (row.createdBy === user.id && row.status === "pending") }))
  const monthEntries = entryRows.filter((entry) => entry.entryDate >= since && entry.status !== "rejected")
  const byJob = new Map<string, { label: string; runningHours: number; otherHours: number; chargeCents: number }>()
  for (const entry of monthEntries) {
    if (entry.kind !== "hours") continue
    const label = entry.projectLabel ?? "Yard / unassigned"
    const row = byJob.get(label) ?? { label, runningHours: 0, otherHours: 0, chargeCents: 0 }
    row.runningHours += entry.runningHours ?? 0
    row.otherHours += (entry.standbyHours ?? 0) + (entry.idleHours ?? 0)
    row.chargeCents += entry.chargeCents ?? 0
    byJob.set(label, row)
  }

  return {
    today,
    month,
    machines,
    pending: views(pendingRows),
    entries: views(entryRows),
    totals: {
      runningHours: monthEntries.reduce((sum, entry) => sum + (entry.runningHours ?? 0), 0),
      fuelCents: monthEntries.filter((entry) => entry.kind === "fuel").reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0),
      serviceCents: monthEntries
        .filter((entry) => entry.kind === "maintenance" || entry.kind === "repair")
        .reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0),
      servicesDue: machines.filter((machine) => machine.active).flatMap((machine) => machine.services).filter((item) => item.due.state === "due").length,
    },
    hoursByJob: [...byJob.values()].sort((a, b) => b.runningHours - a.runningHours),
    rateBookMachines: rateRows.map((row) => ({ value: row.id, label: `${row.name} · ${(row.cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}/${row.unit}` })),
    jobs: jobRows.map((row) => ({ value: row.id, label: projectNumberAndName(row) })),
    costCodes: costCodeCatalog.map((code) => ({ value: code.code, label: code.displayLabel })),
    canManage,
  }
}

type EntryRow = Omit<MachineLogEntryView, "canChange"> & { readonly createdBy: string | null }

async function loadEntries(db: Db, orgId: string, where: ReturnType<typeof and>): Promise<readonly EntryRow[]> {
  const rows = await db
    .select({
      entry: equipmentLogEntries,
      machineName: equipmentMachines.name,
      projectName: projects.name,
      projectNumber: projects.projectNumber,
      serviceName: equipmentServiceItems.name,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(equipmentLogEntries)
    .innerJoin(equipmentMachines, eq(equipmentMachines.id, equipmentLogEntries.machineId))
    .leftJoin(projects, eq(projects.id, equipmentLogEntries.projectId))
    .leftJoin(equipmentServiceItems, eq(equipmentServiceItems.id, equipmentLogEntries.serviceItemId))
    .leftJoin(users, eq(users.id, equipmentLogEntries.createdBy))
    .where(where)
    .orderBy(desc(equipmentLogEntries.entryDate), desc(equipmentLogEntries.createdAt))
    .limit(400)
  return rows
    .filter(({ entry }) => entry.organizationId === orgId && isMachineLogKind(entry.kind))
    .map(({ entry, machineName, projectName, projectNumber, serviceName, ...person }) => ({
      id: entry.id,
      machineId: entry.machineId,
      machineName,
      kind: entry.kind,
      entryDate: entry.entryDate,
      projectId: entry.projectId,
      projectLabel: projectName ? projectNumberAndName({ name: projectName, projectNumber }) : null,
      operatorName: entry.operatorName,
      costCode: entry.costCode,
      runningHours: entry.runningHours,
      standbyHours: entry.standbyHours,
      idleHours: entry.idleHours,
      hourMeter: entry.hourMeter,
      gallons: entry.gallons,
      amountCents: entry.amountCents,
      vendor: entry.vendor,
      paidWith: entry.paidWith,
      serviceItemId: entry.serviceItemId,
      serviceName,
      shopHours: entry.shopHours,
      chargeCents: entry.chargeCents,
      notes: entry.notes,
      status: entry.status,
      loggedBy: nameOf(person),
      createdBy: entry.createdBy,
    }))
}

const machineSchema = z.object({
  name: z.string().trim().min(1, "Name the machine.").max(80),
  sageEquipmentNumber: z.string().trim().max(20),
  rateBookEntryId: z.string().max(80),
  standbyRate: z.string().max(12),
  idleRate: z.string().max(12),
  hourMeter: z.string().max(12),
  active: z.boolean(),
  notes: z.string().max(2000),
})

export type MachineInput = z.infer<typeof machineSchema>

function centsOrNull(value: string, label: string): number | null {
  const clean = value.trim().replace(/[$,]/g, "")
  if (!clean) return null
  const parsed = Number(clean)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Enter the ${label} as a dollar amount.`)
  return Math.round(parsed * 100)
}

/** Adds or changes a machine (managers only). */
export async function saveMachine(machineId: string | null, raw: MachineInput): Promise<Result<{ readonly id: string }>> {
  try {
    const { db, user, orgId, canManage } = await editContext()
    if (!canManage) return { success: false, error: "Only people who approve the machine log can set up machines." }
    const parsed = machineSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the machine." }
    const input = parsed.data
    if (input.rateBookEntryId) {
      const [rate] = await db
        .select({ id: rateBookEntries.id })
        .from(rateBookEntries)
        .where(and(eq(rateBookEntries.id, input.rateBookEntryId), eq(rateBookEntries.organizationId, orgId), eq(rateBookEntries.category, "machine")))
        .limit(1)
      if (!rate) return { success: false, error: "Choose a Machine entry from the rate book." }
    }
    const hourMeter = input.hourMeter.trim() ? Number(input.hourMeter.replace(/,/g, "")) : null
    if (hourMeter !== null && (!Number.isFinite(hourMeter) || hourMeter < 0)) return { success: false, error: "Enter the hour meter as a number." }
    const now = new Date().toISOString()
    const values = {
      name: input.name,
      sageEquipmentNumber: input.sageEquipmentNumber || null,
      rateBookEntryId: input.rateBookEntryId || null,
      standbyRateCents: centsOrNull(input.standbyRate, "standby rate"),
      idleRateCents: centsOrNull(input.idleRate, "idle rate"),
      active: input.active,
      notes: input.notes.trim() || null,
      updatedAt: now,
    }
    if (machineId) {
      const [existing] = await db
        .select({ hourMeter: equipmentMachines.hourMeter })
        .from(equipmentMachines)
        .where(and(eq(equipmentMachines.id, machineId), eq(equipmentMachines.organizationId, orgId)))
        .limit(1)
      if (!existing) return { success: false, error: "That machine no longer exists." }
      const meterChanged = hourMeter !== null && hourMeter !== existing.hourMeter
      await db
        .update(equipmentMachines)
        .set({ ...values, ...(meterChanged ? { hourMeter, hourMeterOn: companyToday() } : {}) })
        .where(eq(equipmentMachines.id, machineId))
      revalidatePath(PAGE)
      return { success: true, data: { id: machineId } }
    }
    const id = crypto.randomUUID()
    await db.insert(equipmentMachines).values({
      id,
      organizationId: orgId,
      ...values,
      hourMeter,
      hourMeterOn: hourMeter === null ? null : companyToday(),
      createdBy: user.id,
      createdAt: now,
    })
    revalidatePath(PAGE)
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error, "Couldn't save the machine.")
  }
}

/** Deletes a machine with no log entries; one with history is retired instead. */
export async function deleteMachine(machineId: string): Promise<Result<null>> {
  try {
    const { db, orgId, canManage } = await editContext()
    if (!canManage) return { success: false, error: "Only people who approve the machine log can remove machines." }
    const [entry] = await db
      .select({ id: equipmentLogEntries.id })
      .from(equipmentLogEntries)
      .where(eq(equipmentLogEntries.machineId, machineId))
      .limit(1)
    if (entry) return { success: false, error: "This machine has log entries. Turn off Active to retire it instead; its history is kept." }
    await db.delete(equipmentMachines).where(and(eq(equipmentMachines.id, machineId), eq(equipmentMachines.organizationId, orgId)))
    revalidatePath(PAGE)
    return { success: true, data: null }
  } catch (error) {
    return failure(error, "Couldn't remove the machine.")
  }
}

const serviceSchema = z.object({
  name: z.string().trim().min(1, "Name the service, e.g. Oil change.").max(60),
  everyHours: z.string().max(10),
  everyDays: z.string().max(6),
  lastDoneHours: z.string().max(12),
  lastDoneOn: z.string().max(10),
})

export type ServiceInput = z.infer<typeof serviceSchema>

/** Adds or changes a service on a machine's schedule (managers only). */
export async function saveServiceItem(machineId: string, itemId: string | null, raw: ServiceInput): Promise<Result<{ readonly id: string }>> {
  try {
    const { db, orgId, canManage } = await editContext()
    if (!canManage) return { success: false, error: "Only people who approve the machine log can change service schedules." }
    const parsed = serviceSchema.safeParse(raw)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the service." }
    const input = parsed.data
    const number = (value: string): number | null => {
      const clean = value.trim().replace(/,/g, "")
      if (!clean) return null
      const parsedNumber = Number(clean)
      if (!Number.isFinite(parsedNumber) || parsedNumber < 0) throw new Error("Enter hours and days as numbers.")
      return parsedNumber
    }
    const everyHours = number(input.everyHours)
    const everyDays = number(input.everyDays)
    if (everyHours === null && everyDays === null) return { success: false, error: "Set how often: every so many hours, days, or both." }
    if (input.lastDoneOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.lastDoneOn)) return { success: false, error: "Choose the date it was last done." }
    const [machine] = await db
      .select({ id: equipmentMachines.id })
      .from(equipmentMachines)
      .where(and(eq(equipmentMachines.id, machineId), eq(equipmentMachines.organizationId, orgId)))
      .limit(1)
    if (!machine) return { success: false, error: "That machine no longer exists." }
    const now = new Date().toISOString()
    const values = {
      name: input.name,
      everyHours,
      everyDays: everyDays === null ? null : Math.round(everyDays),
      lastDoneHours: number(input.lastDoneHours),
      lastDoneOn: input.lastDoneOn || null,
      updatedAt: now,
    }
    if (itemId) {
      await db
        .update(equipmentServiceItems)
        .set(values)
        .where(and(eq(equipmentServiceItems.id, itemId), eq(equipmentServiceItems.machineId, machineId)))
      revalidatePath(PAGE)
      return { success: true, data: { id: itemId } }
    }
    const id = crypto.randomUUID()
    await db.insert(equipmentServiceItems).values({ id, organizationId: orgId, machineId, ...values, createdAt: now })
    revalidatePath(PAGE)
    return { success: true, data: { id } }
  } catch (error) {
    return failure(error, "Couldn't save the service.")
  }
}

export async function deleteServiceItem(itemId: string): Promise<Result<null>> {
  try {
    const { db, orgId, canManage } = await editContext()
    if (!canManage) return { success: false, error: "Only people who approve the machine log can change service schedules." }
    await db.delete(equipmentServiceItems).where(and(eq(equipmentServiceItems.id, itemId), eq(equipmentServiceItems.organizationId, orgId)))
    revalidatePath(PAGE)
    return { success: true, data: null }
  } catch (error) {
    return failure(error, "Couldn't remove the service.")
  }
}

/**
 * Logs machine hours, a fill-up, a service, a repair or another cost.
 * Hours are priced from the machine's rates now and kept with the entry.
 * The machine's hour meter and last job move forward, and logging a
 * scheduled service resets when it is next due.
 */
export async function saveMachineLogEntry(
  entryId: string | null,
  draft: MachineLogDraft,
  clientSubmissionId?: string,
): Promise<Result<{ readonly id: string }>> {
  try {
    const { db, user, orgId, canManage } = await editContext()
    const checked = validateMachineLog(draft)
    if (!checked.values) return { success: false, error: checked.errors.map((error) => error.message).join(" ") }
    const values = checked.values

    if (clientSubmissionId && !entryId) {
      // Field Mode retries after an interrupted sync; don't log it twice.
      const [existing] = await db
        .select({ id: equipmentLogEntries.id, organizationId: equipmentLogEntries.organizationId })
        .from(equipmentLogEntries)
        .where(eq(equipmentLogEntries.clientSubmissionId, clientSubmissionId))
        .limit(1)
      if (existing) {
        return existing.organizationId === orgId
          ? { success: true, data: { id: existing.id } }
          : { success: false, error: "That submission ID is already in use." }
      }
    }

    const [machine] = await db
      .select({ machine: equipmentMachines, runningRateCents: rateBookEntries.unitCostCents })
      .from(equipmentMachines)
      .leftJoin(rateBookEntries, eq(rateBookEntries.id, equipmentMachines.rateBookEntryId))
      .where(and(eq(equipmentMachines.id, values.machineId), eq(equipmentMachines.organizationId, orgId)))
      .limit(1)
    if (!machine) return { success: false, error: "That machine isn't on the company's list." }
    if (values.projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, values.projectId), eq(projects.organizationId, orgId)))
        .limit(1)
      if (!project) return { success: false, error: "That job wasn't found." }
    }
    let serviceItem: { readonly id: string } | undefined
    if (values.serviceItemId) {
      ;[serviceItem] = await db
        .select({ id: equipmentServiceItems.id })
        .from(equipmentServiceItems)
        .where(and(eq(equipmentServiceItems.id, values.serviceItemId), eq(equipmentServiceItems.machineId, values.machineId)))
        .limit(1)
      if (!serviceItem) return { success: false, error: "That service isn't on this machine's schedule." }
    }

    const rates = {
      runningRateCents: machine.runningRateCents,
      standbyRateCents: machine.machine.standbyRateCents,
      idleRateCents: machine.machine.idleRateCents,
    }
    const priced = values.kind === "hours"
      ? { ...rates, chargeCents: machineTimeChargeCents(values, rates) }
      : { runningRateCents: null, standbyRateCents: null, idleRateCents: null, chargeCents: null }
    const now = new Date().toISOString()
    const row = { ...values, ...priced, updatedAt: now }

    let id = entryId
    if (entryId) {
      const [existing] = await db
        .select({ createdBy: equipmentLogEntries.createdBy, status: equipmentLogEntries.status })
        .from(equipmentLogEntries)
        .where(and(eq(equipmentLogEntries.id, entryId), eq(equipmentLogEntries.organizationId, orgId)))
        .limit(1)
      if (!existing) return { success: false, error: "That entry no longer exists." }
      if (!canManage && (existing.createdBy !== user.id || existing.status !== "pending")) {
        return { success: false, error: "You can change your own entries until they're approved." }
      }
      // A changed entry goes back for approval.
      await db.update(equipmentLogEntries).set({ ...row, status: "pending", reviewedBy: null, reviewedAt: null }).where(eq(equipmentLogEntries.id, entryId))
    } else {
      id = crypto.randomUUID()
      await db.insert(equipmentLogEntries).values({
        id,
        organizationId: orgId,
        ...row,
        operatorUserId: values.kind === "hours" && !values.operatorName ? user.id : null,
        operatorName: values.kind === "hours" ? (values.operatorName ?? nameOf(user)) : null,
        status: "pending",
        clientSubmissionId: clientSubmissionId ?? null,
        createdBy: user.id,
        createdAt: now,
      })
    }

    // Keep the machine current: the highest meter reading, where it last worked.
    const meter = values.hourMeter
    const machineUpdate: Partial<typeof equipmentMachines.$inferInsert> = {}
    if (meter !== null && (machine.machine.hourMeter === null || meter >= machine.machine.hourMeter)) {
      machineUpdate.hourMeter = meter
      machineUpdate.hourMeterOn = values.entryDate
    }
    if (values.kind === "hours" && values.projectId) machineUpdate.locationProjectId = values.projectId
    if (Object.keys(machineUpdate).length > 0) {
      await db.update(equipmentMachines).set({ ...machineUpdate, updatedAt: now }).where(eq(equipmentMachines.id, values.machineId))
    }
    if (serviceItem) {
      await db
        .update(equipmentServiceItems)
        .set({ lastDoneOn: values.entryDate, lastDoneHours: meter ?? machine.machine.hourMeter, updatedAt: now })
        .where(eq(equipmentServiceItems.id, serviceItem.id))
    }
    revalidatePath(PAGE)
    return { success: true, data: { id: id ?? "" } }
  } catch (error) {
    return failure(error, "Couldn't save the entry.")
  }
}

/** Removes an entry: your own until it's approved, or any entry for managers. */
export async function deleteMachineLogEntry(entryId: string): Promise<Result<null>> {
  try {
    const { db, user, orgId, canManage } = await editContext()
    const [existing] = await db
      .select({ createdBy: equipmentLogEntries.createdBy, status: equipmentLogEntries.status })
      .from(equipmentLogEntries)
      .where(and(eq(equipmentLogEntries.id, entryId), eq(equipmentLogEntries.organizationId, orgId)))
      .limit(1)
    if (!existing) return { success: false, error: "That entry no longer exists." }
    if (!canManage && (existing.createdBy !== user.id || existing.status !== "pending")) {
      return { success: false, error: "You can remove your own entries until they're approved." }
    }
    await db.delete(equipmentLogEntries).where(eq(equipmentLogEntries.id, entryId))
    revalidatePath(PAGE)
    return { success: true, data: null }
  } catch (error) {
    return failure(error, "Couldn't remove the entry.")
  }
}

/** Approves or rejects entries (managers only). Approved entries are what later go to Sage. */
export async function reviewMachineLogEntries(entryIds: readonly string[], decision: "approved" | "rejected"): Promise<Result<{ readonly count: number }>> {
  try {
    const { db, user, orgId, canManage } = await editContext()
    if (!canManage) return { success: false, error: "You don't have approval access for the machine log." }
    const ids = entryIds.slice(0, 90)
    if (ids.length === 0) return { success: true, data: { count: 0 } }
    const now = new Date().toISOString()
    await db
      .update(equipmentLogEntries)
      .set({ status: decision, reviewedBy: user.id, reviewedAt: now, updatedAt: now })
      .where(and(eq(equipmentLogEntries.organizationId, orgId), inArray(equipmentLogEntries.id, ids)))
    revalidatePath(PAGE)
    return { success: true, data: { count: ids.length } }
  } catch (error) {
    return failure(error, "Couldn't update the entries.")
  }
}
