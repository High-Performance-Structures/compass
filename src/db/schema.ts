/*
 * The core schema, split by area. This file only re-exports, so existing
 * `import { projects } from "@/db/schema"` lines keep working. To find or
 * change a table, open the file for its area:
 *
 *   schema-identity.ts       users, companies, teams, permissions
 *   schema-projects.ts       the project (job) record, numbers, statuses, members
 *   schema-contacts.ts       customers, vendors, staff, project contacts
 *   schema-crm.ts            client follow-ups, notes, interactions
 *   schema-field.ts          daily logs, photos, owner updates, videos
 *   schema-schedule.ts       schedule tasks, dependencies, baselines
 *   schema-calendars.ts      work calendar, Google calendars, client meetings
 *   schema-operations.ts     to-dos, purchase orders, RFIs
 *   schema-selections.ts     finish selections and rooms
 *   schema-financials.ts     budget lines, pay requests, deposits, cost codes
 *   schema-change-orders.ts  change orders
 *   schema-notifications.ts  notifications, tracked email, Activity, push
 *   schema-feedback.ts       Message Desk, GoTo, feedback
 *   schema-cherish.ts        CHERISH board, greeting cards
 *   schema-settings.ts       feature settings, saved views, list sheets
 *   schema-agent-memory.ts   Jarvis memory
 *   schema-weather.ts        weather and fire map cache
 *
 * Other areas have their own schema-*.ts files (estimates, sage, nutech, ...).
 * Every schema file is listed in drizzle.config.ts.
 */
export * from "./schema-identity"
export * from "./schema-projects"
export * from "./schema-contacts"
export * from "./schema-crm"
export * from "./schema-field"
export * from "./schema-schedule"
export * from "./schema-calendars"
export * from "./schema-operations"
export * from "./schema-selections"
export * from "./schema-financials"
export * from "./schema-change-orders"
export * from "./schema-notifications"
export * from "./schema-feedback"
export * from "./schema-cherish"
export * from "./schema-settings"
export * from "./schema-agent-memory"
export * from "./schema-weather"
