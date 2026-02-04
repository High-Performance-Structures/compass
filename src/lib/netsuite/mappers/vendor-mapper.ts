import { BaseMapper } from "./base-mapper"
import type { Vendor } from "@/db/schema"
import type { NetSuiteVendor } from "../client/types"

type LocalVendor = Vendor & { updatedAt?: string | null }

export class VendorMapper extends BaseMapper<
  LocalVendor,
  NetSuiteVendor
> {
  toRemote(local: LocalVendor): Partial<NetSuiteVendor> {
    return {
      companyName: local.name,
      email: local.email ?? undefined,
      phone: local.phone ?? undefined,
    }
  }

  toLocal(remote: NetSuiteVendor): Partial<LocalVendor> {
    return {
      name: remote.companyName,
      email: remote.email ?? null,
      phone: remote.phone ?? null,
      address: remote.defaultAddress ?? null,
      category: remote.category?.refName ?? "Subcontractor",
      netsuiteId: remote.id,
      updatedAt: new Date().toISOString(),
    }
  }

  getNetSuiteRecordType(): string {
    return "vendor"
  }

  getLocalTable(): string {
    return "vendors"
  }

  getSuiteQLFields(): string[] {
    return [
      "id",
      "companyname",
      "email",
      "phone",
      "entityid",
      "isinactive",
      "category",
      "datecreated",
      "lastmodifieddate",
    ]
  }
}
