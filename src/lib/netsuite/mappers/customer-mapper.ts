import { BaseMapper } from "./base-mapper"
import type { Customer } from "@/db/schema"
import type { NetSuiteCustomer } from "../client/types"

type LocalCustomer = Customer & { updatedAt?: string | null }

export class CustomerMapper extends BaseMapper<
  LocalCustomer,
  NetSuiteCustomer
> {
  toRemote(local: LocalCustomer): Partial<NetSuiteCustomer> {
    return {
      companyName: local.name,
      email: local.email ?? undefined,
      phone: local.phone ?? undefined,
    }
  }

  toLocal(remote: NetSuiteCustomer): Partial<LocalCustomer> {
    return {
      name: remote.companyName,
      email: remote.email ?? null,
      phone: remote.phone ?? null,
      netsuiteId: remote.id,
      updatedAt: new Date().toISOString(),
    }
  }

  getNetSuiteRecordType(): string {
    return "customer"
  }

  getLocalTable(): string {
    return "customers"
  }

  getSuiteQLFields(): string[] {
    return [
      "id",
      "companyname",
      "email",
      "phone",
      "entityid",
      "isinactive",
      "datecreated",
      "lastmodifieddate",
    ]
  }
}
