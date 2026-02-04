import { BaseMapper } from "./base-mapper"
import type { VendorBill } from "@/db/schema-netsuite"
import type { NetSuiteVendorBill } from "../client/types"

export class VendorBillMapper extends BaseMapper<
  VendorBill,
  NetSuiteVendorBill
> {
  toRemote(local: VendorBill): Partial<NetSuiteVendorBill> {
    const result: Partial<NetSuiteVendorBill> = {
      tranDate: local.billDate,
      memo: local.memo ?? undefined,
    }

    if (local.dueDate) {
      result.dueDate = local.dueDate
    }
    if (local.vendorId) {
      result.entity = {
        id: local.vendorId,
        refName: "",
      }
    }

    return result
  }

  toLocal(remote: NetSuiteVendorBill): Partial<VendorBill> {
    return {
      netsuiteId: remote.id,
      billNumber: remote.tranId,
      status: mapBillStatus(remote.status?.refName),
      billDate: remote.tranDate,
      dueDate: remote.dueDate ?? null,
      total: remote.total ?? 0,
      amountDue: remote.amountRemaining ?? 0,
      amountPaid: (remote.total ?? 0) - (remote.amountRemaining ?? 0),
      memo: remote.memo ?? null,
      updatedAt: new Date().toISOString(),
    }
  }

  getNetSuiteRecordType(): string {
    return "vendorBill"
  }

  getLocalTable(): string {
    return "vendor_bills"
  }

  getSuiteQLFields(): string[] {
    return [
      "id",
      "tranid",
      "entity",
      "trandate",
      "duedate",
      "status",
      "total",
      "amountremaining",
      "memo",
      "job",
      "lastmodifieddate",
    ]
  }
}

function mapBillStatus(nsStatus?: string): string {
  if (!nsStatus) return "pending"

  const normalized = nsStatus.toLowerCase()
  if (normalized.includes("paid") && !normalized.includes("not")) {
    return "paid"
  }
  if (normalized.includes("open")) return "approved"
  if (normalized.includes("voided")) return "voided"
  return "pending"
}
