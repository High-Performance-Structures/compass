/*
 * Weather and fire & smoke map layers: a shared cache of public NWS and
 * wildfire data (no company data), plus the schedule warnings raised from it.
 * Written by: src/lib/domain/weather/.
 */

import {
  index,
  sqliteTable,
  text,
  integer,
  primaryKey,
  real,
} from "drizzle-orm/sqlite-core"

import { organizations } from "./schema-identity"
import { projects } from "./schema-projects"
import { scheduleTasks } from "./schema-schedule"

// Weather and Fire & smoke map layers: a shared cache of public NWS and
// wildfire data (no company data), refreshed in the background.
/** A rounded map point and the NWS forecast grid cell covering it. */
export const weatherPoints = sqliteTable(
  "weather_points",
  {
    /** Rounded "lat,lon" (2 decimals, about 1 km). */
    pointKey: text("point_key").primaryKey(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    /** "BOU/26,53" once resolved. */
    cellKey: text("cell_key"),
    /** pending | found | outside (no NWS forecast there). */
    status: text("status").notNull().default("pending"),
    resolvedAt: text("resolved_at"),
    requestedAt: text("requested_at").notNull(),
  },
  (table) => [index("idx_weather_points_pending").on(table.status, table.requestedAt)],
)

/** One NWS forecast grid cell and its next days in 3-hour steps (JSON). */
export const weatherCells = sqliteTable(
  "weather_cells",
  {
    cellKey: text("cell_key").primaryKey(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    elevationM: real("elevation_m"),
    series: text("series"),
    fetchedAt: text("fetched_at"),
    /** Last time a map or schedule check read it; idle cells stop refreshing. */
    requestedAt: text("requested_at").notNull(),
    failureCount: integer("failure_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
  },
  (table) => [index("idx_weather_cells_refresh").on(table.requestedAt, table.fetchedAt)],
)

/** Latest warnings or fires for a map area (kind = alerts | fires). */
export const weatherAreaSnapshots = sqliteTable(
  "weather_area_snapshots",
  {
    areaKey: text("area_key").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    failureCount: integer("failure_count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.areaKey, table.kind] })],
)

/** Simplified outlines of NWS forecast zones, for warnings issued by zone. */
export const weatherZoneShapes = sqliteTable("weather_zone_shapes", {
  zoneId: text("zone_id").primaryKey(),
  rings: text("rings").notNull(),
  fetchedAt: text("fetched_at").notNull(),
})

/** Schedule warnings from the weather layer; each item + rule + day notifies once. */
export const weatherScheduleRisks = sqliteTable(
  "weather_schedule_risks",
  {
    scheduleTaskId: text("schedule_task_id")
      .notNull()
      .references(() => scheduleTasks.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    riskDate: text("risk_date").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    detail: text("detail").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    notifiedAt: text("notified_at"),
  },
  (table) => [
    primaryKey({ columns: [table.scheduleTaskId, table.ruleId, table.riskDate] }),
    index("idx_weather_schedule_risks_project").on(table.projectId, table.riskDate),
  ],
)
