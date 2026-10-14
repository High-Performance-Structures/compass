import { and, asc, eq } from "drizzle-orm"
import type { getDb } from "@/db"
import { equipmentMachines, equipmentServiceItems } from "@/db/schema-equipment"
import { rateBookEntries } from "@/db/schema-rate-book"
import { formatCents, serviceDue, serviceDueLabel } from "@/lib/equipment/model"
import type { FieldMachine } from "@/lib/field/types"

/** The company's active machines, as Field Mode keeps them for offline logging. */
export async function loadFieldMachines(db: ReturnType<typeof getDb>, organizationId: string, today: string): Promise<FieldMachine[]> {
  const [machines, services] = await Promise.all([
    db
      .select({ machine: equipmentMachines, rateName: rateBookEntries.name, rateCents: rateBookEntries.unitCostCents })
      .from(equipmentMachines)
      .leftJoin(rateBookEntries, eq(rateBookEntries.id, equipmentMachines.rateBookEntryId))
      .where(and(eq(equipmentMachines.organizationId, organizationId), eq(equipmentMachines.active, true)))
      .orderBy(asc(equipmentMachines.name)),
    db.select().from(equipmentServiceItems).where(eq(equipmentServiceItems.organizationId, organizationId)).orderBy(asc(equipmentServiceItems.name)),
  ])
  return machines.map(({ machine, rateName, rateCents }) => ({
    id: machine.id,
    name: machine.name,
    rateLabel: rateName && rateCents !== null ? `${rateName}, ${formatCents(rateCents)}/hr` : null,
    runningRateCents: rateCents,
    standbyRateCents: machine.standbyRateCents,
    idleRateCents: machine.idleRateCents,
    hourMeter: machine.hourMeter,
    services: services
      .filter((item) => item.machineId === machine.id)
      .map((item) => {
        const due = serviceDue(item, machine.hourMeter, today)
        return { id: item.id, name: item.name, dueLabel: serviceDueLabel(item.name, due), state: due.state }
      }),
  }))
}
