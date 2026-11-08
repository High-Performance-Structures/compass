import { and, eq } from "drizzle-orm"

import { customers } from "@/db/schema"
import { sageClientPayloadFields } from "@/lib/domain/project/rules"
import { payloadWithClient } from "@/lib/domain/sage-bridge/project-send-rules"
import { parseSageClientStatusId } from "@/lib/sage/client-project-write"
import type { Db } from "@/lib/server/action-context"

// A chain of merges longer than this is treated as broken and left alone.
const MAX_MERGE_HOPS = 10

type Customer = typeof customers.$inferSelect

/**
 * The Compass client a failed Sage job write should be resent for. A write
 * keeps the client it was queued for, and a merge archives that client
 * without moving failed writes, so the write follows the archived client's
 * merged-into pointer to the client that was kept. `payloadJson` then carries
 * the kept client's details; a write whose client was not merged is unchanged.
 */
export async function failedJobWriteClient(
  db: Db,
  input: { readonly organizationId: string; readonly customerId: string | null; readonly payloadJson: string },
): Promise<
  | { readonly ok: true; readonly customer: Customer | null; readonly movedFromCustomerId: string | null; readonly payloadJson: string }
  | { readonly ok: false; readonly error: string }
> {
  if (!input.customerId) return { ok: true, customer: null, movedFromCustomerId: null, payloadJson: input.payloadJson }
  let customer = await loadCustomer(db, input.organizationId, input.customerId)
  for (let hop = 0; customer?.mergedIntoCustomerId && hop < MAX_MERGE_HOPS; hop++) {
    customer = await loadCustomer(db, input.organizationId, customer.mergedIntoCustomerId)
  }
  if (!customer) return { ok: true, customer: null, movedFromCustomerId: null, payloadJson: input.payloadJson }
  if (customer.mergedIntoCustomerId) return { ok: false, error: "This job's Compass client was merged too many times to follow. Ask a developer to check it." }
  if (customer.id === input.customerId) return { ok: true, customer, movedFromCustomerId: null, payloadJson: input.payloadJson }

  const linked = Boolean(customer.sageClientId && customer.sageClientNumber)
  const payloadJson = payloadWithClient(input.payloadJson, sageClientPayloadFields({
    compassCustomerId: customer.id,
    sageClientId: linked ? customer.sageClientId : null,
    sageClientNumber: linked ? customer.sageClientNumber : null,
    name: customer.name,
    shortNameSource: customer.company ?? customer.name,
    company: customer.company,
    email: customer.email,
    phone: customer.phone,
    address: customer.address,
    billingAddress: linked ? null : customer.address,
    notes: null,
    statusId: parseSageClientStatusId(customer.sageClientStatusId) ?? 1,
  }))
  if (!payloadJson) return { ok: false, error: "This job's saved Sage details can't be read. Ask a developer to check it." }
  return { ok: true, customer, movedFromCustomerId: input.customerId, payloadJson }
}

async function loadCustomer(db: Db, organizationId: string, id: string): Promise<Customer | null> {
  return await db.select().from(customers)
    .where(and(eq(customers.id, id), eq(customers.organizationId, organizationId))).get() ?? null
}
