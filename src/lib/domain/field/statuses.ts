/*
 * Enumerated values for this domain (architecture standard, section 3).
 * Pure constants with no imports, so the Drizzle schema can type its
 * columns with them.
 */

export const EQUIPMENT_LOG_KINDS = ["hours", "fuel", "maintenance", "repair", "other"] as const
export type EquipmentLogKind = (typeof EQUIPMENT_LOG_KINDS)[number]

export const EQUIPMENT_LOG_STATUSES = ["pending", "approved", "rejected"] as const
export type EquipmentLogStatus = (typeof EQUIPMENT_LOG_STATUSES)[number]
