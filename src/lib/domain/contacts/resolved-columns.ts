/**
 * The read model's directory-owned columns: a project contact linked to a
 * directory record reads its email, phone, address and names from that
 * record (see resolvedProjectContacts in store.ts). Pure SQL expressions.
 */
import { sql, type SQL } from "drizzle-orm"

import { customerContacts, customers, internalContacts, projectContacts, users, vendorContacts, vendors } from "@/db/schema"

type DirectoryValue = {
  readonly customerContact: SQL | null
  readonly vendorContact: SQL | null
  readonly customer: SQL | null
  readonly vendor: SQL | null
  readonly internal: SQL | null
  readonly user: SQL | null
}

/**
 * The linked record, in the order the project contact names it. When that
 * record is reachable its value wins, blank included (a linked record owns
 * its blanks). Only an unlinked contact, or one whose record is no longer
 * reachable (inactive, merged, another organization), falls back to the
 * copied column.
 */
function linkedValue(value: DirectoryValue, copy: SQL): SQL {
  const pick = (present: SQL, field: SQL | null): SQL =>
    sql`case when ${present} then ${field ?? sql`null`} else ${copy} end`
  return sql`case
    when ${projectContacts.customerContactId} is not null
      then ${pick(sql`${customerContacts.id} is not null`, value.customerContact)}
    when ${projectContacts.vendorContactId} is not null
      then ${pick(sql`${vendorContacts.id} is not null`, value.vendorContact)}
    when ${projectContacts.customerId} is not null or ${projectContacts.sourceEntityType} = 'customer'
      then ${pick(sql`${customers.id} is not null`, value.customer)}
    when ${projectContacts.vendorId} is not null or ${projectContacts.sourceEntityType} = 'vendor'
      then ${pick(sql`${vendors.id} is not null`, value.vendor)}
    when ${projectContacts.internalContactId} is not null
      then ${pick(sql`${internalContacts.id} is not null`, value.internal)}
    when ${projectContacts.sourceEntityType} = 'user'
      then ${pick(sql`${users.id} is not null`, value.user)}
    else ${copy}
  end`
}

function trimmed(column: SQL): SQL {
  return sql`nullif(trim(${column}), '')`
}

export const resolvedEmail = linkedValue(
  {
    customerContact: trimmed(sql`${customerContacts.email}`),
    vendorContact: trimmed(sql`${vendorContacts.email}`),
    customer: trimmed(sql`${customers.email}`),
    vendor: trimmed(sql`${vendors.email}`),
    internal: trimmed(sql`${internalContacts.email}`),
    user: trimmed(sql`${users.email}`),
  },
  trimmed(sql`${projectContacts.email}`)
)

export const resolvedPhone = linkedValue(
  {
    customerContact: trimmed(sql`${customerContacts.phone}`),
    vendorContact: trimmed(sql`${vendorContacts.phone}`),
    customer: trimmed(sql`${customers.phone}`),
    vendor: trimmed(sql`${vendors.phone}`),
    internal: trimmed(sql`${internalContacts.phone}`),
    user: trimmed(sql`${users.phone}`),
  },
  trimmed(sql`${projectContacts.phone}`)
)

// People records carry no address: a client person uses the client's, and
// vendor people, staff and Compass users have none on a project.
export const resolvedAddress = sql`case when ${projectContacts.contactType} = 'internal' then null else ${linkedValue(
  {
    customerContact: trimmed(sql`${customers.address}`),
    vendorContact: null,
    customer: trimmed(sql`${customers.address}`),
    vendor: trimmed(sql`${vendors.address}`),
    internal: null,
    user: null,
  },
  trimmed(sql`${projectContacts.address}`)
)} end`

export const resolvedDisplayName = sql`case
  when ${projectContacts.contactType} = 'internal' and ${internalContacts.id} is not null then ${internalContacts.name}
  when ${projectContacts.customerContactId} is not null then coalesce(${customerContacts.name}, ${projectContacts.displayName})
  when ${projectContacts.vendorContactId} is not null then coalesce(${vendorContacts.name}, ${projectContacts.displayName})
  when ${vendors.id} is not null then ${vendors.name}
  when ${customers.id} is not null then ${customers.name}
  when ${internalContacts.id} is not null then ${internalContacts.name}
  else ${projectContacts.displayName}
end`

export const resolvedCompanyName = sql`coalesce(${vendors.name}, ${customers.company}, ${projectContacts.companyName})`
