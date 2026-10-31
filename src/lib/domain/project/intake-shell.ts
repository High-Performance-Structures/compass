/**
 * Project shells: a project created without the Google tracker intake (for
 * example a new phase of a family). Callers check access first; every read
 * is scoped to the caller's organization.
 */
import { and, eq, isNull, sql } from "drizzle-orm"

import { customers, projectJobStatuses } from "@/db/schema"
import {
  insertCustomerStatement,
  insertProjectContactStatement,
  updateCustomerByIdStatement,
} from "@/lib/domain/contacts/store"
import { PROJECT_JOB_STATUS_DEFINITIONS } from "@/lib/project-profile"
import type { SageClientStatusId, SageJobTypeId } from "@/lib/sage/client-project-write"
import type { Db } from "@/lib/server/action-context"

import type { CreateProjectShellInput } from "./intake-types"
import {
  customerNeedsSageStatus,
  hasIncompleteSageClientLink,
  normalizedIntakeDepartment,
  projectDepartment,
  sageClientJobPayload,
  type SageClientJobPayload,
} from "./rules"
import { insertProjectExternalLinkStatement, insertProjectStatement, type Statement } from "./store"

type Customer = typeof customers.$inferSelect
type Failure = { readonly ok: false; readonly error: string }

/** A built-in job status, or one of the organization's active custom ones. */
export async function resolveShellJobStatus(
  db: Db,
  organizationId: string,
  jobStatusId: string,
): Promise<{ readonly id: string; readonly label: string } | null> {
  const builtIn = PROJECT_JOB_STATUS_DEFINITIONS.find((option) => option.id === jobStatusId)
  if (builtIn) return builtIn
  const custom = await db
    .select({ id: projectJobStatuses.id, label: projectJobStatuses.label })
    .from(projectJobStatuses)
    .where(
      and(
        eq(projectJobStatuses.id, jobStatusId),
        eq(projectJobStatuses.organizationId, organizationId),
        eq(projectJobStatuses.active, true),
      ),
    )
    .limit(1)
    .get()
  return custom ?? null
}

/** The one directory client with this name, if any, or why the shell cannot use it. */
export async function resolveShellCustomer(
  db: Db,
  input: {
    readonly organizationId: string
    readonly clientName: string
    readonly sageClientStatusId: SageClientStatusId
  },
): Promise<{ readonly ok: true; readonly customer: Customer | null } | Failure> {
  const customerMatches = await db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, input.organizationId),
        isNull(customers.mergedIntoCustomerId),
        sql`lower(trim(${customers.name})) = ${input.clientName.toLowerCase()}`
      )
    )
    .limit(2)
  if (customerMatches.length > 1) {
    return {
      ok: false,
      error: "More than one client directory record matches this name. Reconcile the exact client before creating the project.",
    }
  }
  const customerMatch = customerMatches[0] ?? null
  if (hasIncompleteSageClientLink(customerMatch)) {
    return {
      ok: false,
      error: "This client has an incomplete Sage link. Reconcile its Sage ID and number in Contacts before creating the project.",
    }
  }
  if (customerMatch?.sageClientStatusId != null && customerMatch.sageClientStatusId !== input.sageClientStatusId) {
    return {
      ok: false,
      error: "This client has a different Sage status. Reconcile it in Contacts before creating the project.",
    }
  }
  return { ok: true, customer: customerMatch }
}

/** The project, client, owner contact and Compass link rows of a shell, in batch order. */
export function shellRecordStatements(
  db: Db,
  input: {
    readonly shell: CreateProjectShellInput
    readonly id: string
    readonly organizationId: string
    readonly projectNumber: string | null
    readonly name: string
    readonly status: string
    readonly address: string | null
    readonly clientName: string
    readonly jobStatus: { readonly id: string; readonly label: string }
    readonly sageJobTypeName: string
    readonly customerId: string
    readonly customerMatch: Customer | null
    readonly sageClientStatusId: SageClientStatusId
    readonly now: string
  },
): readonly [Statement, ...Statement[]] {
  const { shell, id, organizationId, projectNumber, address, clientName, customerId, customerMatch, sageClientStatusId, now } = input
  return [
    insertProjectStatement(db, {
      id,
      organizationId,
      projectNumber,
      department:
        normalizedIntakeDepartment(shell.department) ??
        projectDepartment(projectNumber),
      name: input.name,
      status: input.status,
      address,
      clientName,
      clientStatus: "customer",
      jobStatusId: input.jobStatus.id,
      sageJobStatusName: input.jobStatus.label,
      sageJobTypeName: input.sageJobTypeName,
      ownerUpdatesEnabled: true,
      ownerUpdateChannel: "compass",
      ownerUpdateCadence: "weekly",
      createdAt: now,
      updatedAt: now,
    }),
    ...(!customerMatch
      ? [insertCustomerStatement(db, {
          id: customerId,
          organizationId,
          name: clientName,
          address,
          sageClientStatusId,
          createdAt: now,
          updatedAt: now,
        })]
      : customerNeedsSageStatus(customerMatch)
        ? [updateCustomerByIdStatement(db, { customerId, values: { sageClientStatusId, updatedAt: now } })]
        : []),
    insertProjectContactStatement(db, {
      id: crypto.randomUUID(),
      projectId: id,
      contactType: "owner",
      sourceSystem: "customer_directory",
      sourceRecordId: customerId,
      sourceEntityType: "customer",
      sourceEntityId: customerId,
      displayName: clientName,
      companyName: customerMatch?.company ?? null,
      role: "Owner / Client",
      email: customerMatch?.email ?? null,
      phone: customerMatch?.phone ?? null,
      address: customerMatch?.address ?? address,
      notes: null,
      ownerPortalVisible: true,
      subVendorPortalVisible: false,
      internalVisible: true,
      primaryContact: true,
      active: true,
      sortOrder: 100,
      syncStatus: "manual",
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
    insertProjectExternalLinkStatement(db, {
      id: crypto.randomUUID(),
      projectId: id,
      system: "compass",
      label: "Compass project shell",
      externalId: id,
      externalNumber: projectNumber,
      externalUrl: `/dashboard/projects/${id}`,
      syncDirection: "bidirectional",
      syncStatus: "mapped",
      metadata: JSON.stringify({ department: shell.department }),
      createdAt: now,
      updatedAt: now,
    }),
  ]
}

/** The Sage client/job handoff for a shell: the matched or new client and the job. */
export function shellSageWritePayload(input: {
  readonly customerId: string
  readonly customerMatch: Customer | null
  readonly clientName: string
  readonly address: string | null
  readonly sageClientStatusId: SageClientStatusId
  readonly id: string
  readonly projectNumber: string | null
  readonly name: string
  readonly jobStatusLabel: string
  readonly jobType: SageJobTypeId
}): SageClientJobPayload {
  const { customerMatch, clientName, address } = input
  return sageClientJobPayload(
    {
      compassCustomerId: input.customerId,
      sageClientId: customerMatch?.sageClientId ?? null,
      sageClientNumber: customerMatch?.sageClientNumber ?? null,
      name: customerMatch?.name ?? clientName,
      shortNameSource: customerMatch?.name ?? clientName,
      company: customerMatch?.company ?? null,
      email: customerMatch?.email ?? null,
      phone: customerMatch?.phone ?? null,
      address: customerMatch?.address ?? address,
      billingAddress: customerMatch?.sageClientId || customerMatch?.sageClientNumber ? null : address,
      notes: null,
      statusId: input.sageClientStatusId,
    },
    {
      compassProjectId: input.id,
      compassProjectNumber: input.projectNumber,
      projectName: input.name,
      address,
      statusName: input.jobStatusLabel,
      jobType: input.jobType,
    },
  )
}
