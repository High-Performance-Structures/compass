/**
 * Every table and column the Drizzle schema declares, for the production
 * drift detector (src/lib/domain/data-health; issue #1329). It compares these
 * with what the live database has (sqlite_master / pragma_table_info).
 *
 * Every schema file is imported here, as the schema integrity test reads
 * them. Adding a src/db/schema*.ts file means adding it to SCHEMA_MODULES;
 * src/db/__tests__/declared-schema.test.ts fails until you do. Namespace
 * imports of the schema are allowed only inside src/db (Core ownership lint).
 */
import { is } from "drizzle-orm"
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core"

import * as syncSchema from "@/lib/sync/schema"

import * as schemaAccessRequests from "./schema-access-requests"
import * as schemaAgentMemory from "./schema-agent-memory"
import * as schemaAgent from "./schema-agent"
import * as schemaAiConfig from "./schema-ai-config"
import * as schemaBuildertrend from "./schema-buildertrend"
import * as schemaCalendars from "./schema-calendars"
import * as schemaChangeOrders from "./schema-change-orders"
import * as schemaCherish from "./schema-cherish"
import * as schemaContacts from "./schema-contacts"
import * as schemaContracts from "./schema-contracts"
import * as schemaConversations from "./schema-conversations"
import * as schemaCorrespondenceEmail from "./schema-correspondence-email"
import * as schemaCorrespondenceSource from "./schema-correspondence-source"
import * as schemaCorrespondence from "./schema-correspondence"
import * as schemaCrm from "./schema-crm"
import * as schemaDashboards from "./schema-dashboards"
import * as schemaDocuments from "./schema-documents"
import * as schemaEquipment from "./schema-equipment"
import * as schemaEstimates from "./schema-estimates"
import * as schemaFeedback from "./schema-feedback"
import * as schemaField from "./schema-field"
import * as schemaFinancials from "./schema-financials"
import * as schemaGoogle from "./schema-google"
import * as schemaIdentity from "./schema-identity"
import * as schemaInternalDuties from "./schema-internal-duties"
import * as schemaJarvis from "./schema-jarvis"
import * as schemaJobWorkflows from "./schema-job-workflows"
import * as schemaMcp from "./schema-mcp"
import * as schemaNetsuite from "./schema-netsuite"
import * as schemaNotifications from "./schema-notifications"
import * as schemaNutech from "./schema-nutech"
import * as schemaOperations from "./schema-operations"
import * as schemaPaperTrail from "./schema-paper-trail"
import * as schemaParticipants from "./schema-participants"
import * as schemaPlugins from "./schema-plugins"
import * as schemaProjectArchives from "./schema-project-archives"
import * as schemaProjectEmail from "./schema-project-email"
import * as schemaProjectFamilies from "./schema-project-families"
import * as schemaProjectLinks from "./schema-project-links"
import * as schemaProjects from "./schema-projects"
import * as schemaRateBook from "./schema-rate-book"
import * as schemaRecordStatuses from "./schema-record-statuses"
import * as schemaRfqs from "./schema-rfqs"
import * as schemaSage from "./schema-sage"
import * as schemaSchedule from "./schema-schedule"
import * as schemaSelectionChoices from "./schema-selection-choices"
import * as schemaSelectionDecisions from "./schema-selection-decisions"
import * as schemaSelections from "./schema-selections"
import * as schemaSettings from "./schema-settings"
import * as schemaShopTickets from "./schema-shop-tickets"
import * as schemaSocial from "./schema-social"
import * as schemaTemplates from "./schema-templates"
import * as schemaTheme from "./schema-theme"
import * as schemaTradeDocs from "./schema-trade-docs"
import * as schemaWarranty from "./schema-warranty"
import * as schemaWeather from "./schema-weather"
import * as schemaMain from "./schema"

/** Each schema file with its module, by path from the repository root. */
export const SCHEMA_MODULES: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
  ["src/db/schema-access-requests.ts", schemaAccessRequests],
  ["src/db/schema-agent-memory.ts", schemaAgentMemory],
  ["src/db/schema-agent.ts", schemaAgent],
  ["src/db/schema-ai-config.ts", schemaAiConfig],
  ["src/db/schema-buildertrend.ts", schemaBuildertrend],
  ["src/db/schema-calendars.ts", schemaCalendars],
  ["src/db/schema-change-orders.ts", schemaChangeOrders],
  ["src/db/schema-cherish.ts", schemaCherish],
  ["src/db/schema-contacts.ts", schemaContacts],
  ["src/db/schema-contracts.ts", schemaContracts],
  ["src/db/schema-conversations.ts", schemaConversations],
  ["src/db/schema-correspondence-email.ts", schemaCorrespondenceEmail],
  ["src/db/schema-correspondence-source.ts", schemaCorrespondenceSource],
  ["src/db/schema-correspondence.ts", schemaCorrespondence],
  ["src/db/schema-crm.ts", schemaCrm],
  ["src/db/schema-dashboards.ts", schemaDashboards],
  ["src/db/schema-documents.ts", schemaDocuments],
  ["src/db/schema-equipment.ts", schemaEquipment],
  ["src/db/schema-estimates.ts", schemaEstimates],
  ["src/db/schema-feedback.ts", schemaFeedback],
  ["src/db/schema-field.ts", schemaField],
  ["src/db/schema-financials.ts", schemaFinancials],
  ["src/db/schema-google.ts", schemaGoogle],
  ["src/db/schema-identity.ts", schemaIdentity],
  ["src/db/schema-internal-duties.ts", schemaInternalDuties],
  ["src/db/schema-jarvis.ts", schemaJarvis],
  ["src/db/schema-job-workflows.ts", schemaJobWorkflows],
  ["src/db/schema-mcp.ts", schemaMcp],
  ["src/db/schema-netsuite.ts", schemaNetsuite],
  ["src/db/schema-notifications.ts", schemaNotifications],
  ["src/db/schema-nutech.ts", schemaNutech],
  ["src/db/schema-operations.ts", schemaOperations],
  ["src/db/schema-paper-trail.ts", schemaPaperTrail],
  ["src/db/schema-participants.ts", schemaParticipants],
  ["src/db/schema-plugins.ts", schemaPlugins],
  ["src/db/schema-project-archives.ts", schemaProjectArchives],
  ["src/db/schema-project-email.ts", schemaProjectEmail],
  ["src/db/schema-project-families.ts", schemaProjectFamilies],
  ["src/db/schema-project-links.ts", schemaProjectLinks],
  ["src/db/schema-projects.ts", schemaProjects],
  ["src/db/schema-rate-book.ts", schemaRateBook],
  ["src/db/schema-record-statuses.ts", schemaRecordStatuses],
  ["src/db/schema-rfqs.ts", schemaRfqs],
  ["src/db/schema-sage.ts", schemaSage],
  ["src/db/schema-schedule.ts", schemaSchedule],
  ["src/db/schema-selection-choices.ts", schemaSelectionChoices],
  ["src/db/schema-selection-decisions.ts", schemaSelectionDecisions],
  ["src/db/schema-selections.ts", schemaSelections],
  ["src/db/schema-settings.ts", schemaSettings],
  ["src/db/schema-shop-tickets.ts", schemaShopTickets],
  ["src/db/schema-social.ts", schemaSocial],
  ["src/db/schema-templates.ts", schemaTemplates],
  ["src/db/schema-theme.ts", schemaTheme],
  ["src/db/schema-trade-docs.ts", schemaTradeDocs],
  ["src/db/schema-warranty.ts", schemaWarranty],
  ["src/db/schema-weather.ts", schemaWeather],
  ["src/db/schema.ts", schemaMain],
  ["src/lib/sync/schema.ts", syncSchema],
]

/** Declared columns by table name. A table exported by several files is read once. */
export function declaredTableColumns(): ReadonlyMap<string, readonly string[]> {
  const tables = new Map<string, readonly string[]>()
  for (const [, schemaModule] of SCHEMA_MODULES) {
    for (const value of Object.values(schemaModule)) {
      if (!is(value, SQLiteTable)) continue
      const config = getTableConfig(value)
      if (!tables.has(config.name)) tables.set(config.name, config.columns.map((column) => column.name))
    }
  }
  return tables
}
