import { BaseMapper } from "./base-mapper"
import type { Invoice } from "@/db/schema-netsuite"
import type { NetSuiteInvoice } from "../client/types"

export class InvoiceMapper extends BaseMapper<
  Invoice,
  NetSuiteInvoice
> {
  toRemote(local: Invoice): Partial<NetSuiteInvoice> {
    const result: Partial<NetSuiteInvoice> = {
      tranDate: local.issueDate,
      memo: local.memo ?? undefined,
    }

    if (local.dueDate) {
      result.dueDate = local.dueDate
    }
    if (local.customerId) {
      result.entity = {
        id: local.customerId,
        refName: "",
      }
    }

    return result
  }

  toLocal(remote: NetSuiteInvoice): Partial<Invoice> {
    return {
      netsuiteId: remote.id,
      invoiceNumber: remote.tranId,
      status: mapInvoiceStatus(remote.status?.refName),
      issueDate: remote.tranDate,
      dueDate: remote.dueDate ?? null,
      total: remote.total ?? 0,
      amountDue: remote.amountRemaining ?? 0,
      amountPaid: (remote.total ?? 0) - (remote.amountRemaining ?? 0),
      memo: remote.memo ?? null,
      updatedAt: new Date().toISOString(),
    }
  }

  getNetSuiteRecordType(): string {
    return "invoice"
  }

  getLocalTable(): string {
    return "invoices"
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

function mapInvoiceStatus(nsStatus?: string): string {
  if (!nsStatus) return "draft"

  const normalized = nsStatus.toLowerCase()
  if (normalized.includes("paid") && !normalized.includes("not")) {
    return "paid"
  }
  if (normalized.includes("open")) return "sent"
  if (normalized.includes("voided")) return "voided"
  return "draft"
}
