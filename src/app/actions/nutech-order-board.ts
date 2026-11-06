"use server"

import { and, eq, like } from "drizzle-orm"

import { projects } from "@/db/schema"
import { nuTechOrderWorkflows } from "@/db/schema-nutech"
import { nuTechOrgContext } from "@/lib/domain/nutech/access"
import {
  storedNuTechDeliveryMethod,
  storedNuTechOrderStatus,
  storedNuTechVendorInvoiceStatus,
} from "@/lib/domain/nutech/rules"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { companyToday } from "@/lib/internal-duties/recurring-data"
import { buildNuTechOrderBoard, type NuTechBoard } from "@/lib/nutech/order-board"
import { requireFeaturePermission } from "@/lib/permission-enforcement"

export type NuTechOrderBoardView = NuTechBoard & {
  readonly manufacturerName: string
  /** Days and business days behind each needs-attention box, for its description. */
  readonly settings: {
    readonly shipsWithinDays: number
    readonly confirmationBusinessDays: number
    readonly invoiceAfterDeliveryDays: number
  }
}

/** Every order on the company's N jobs, with the board's needs-attention boxes. */
export async function getNuTechOrderBoard(): Promise<NuTechOrderBoardView> {
  const { db, user, organizationId } = await nuTechOrgContext()
  await requireFeaturePermission(user, "nutech-orders", "read")
  const [rows, settings, emailSettings] = await Promise.all([
    db
      .select({
        orderId: nuTechOrderWorkflows.id,
        orderNumber: nuTechOrderWorkflows.orderNumber,
        orderTitle: nuTechOrderWorkflows.title,
        projectId: projects.id,
        projectNumber: projects.projectNumber,
        projectName: projects.name,
        clientName: projects.clientName,
        orderStatus: nuTechOrderWorkflows.orderStatus,
        deliveryMethod: nuTechOrderWorkflows.deliveryMethod,
        requestedDeliveryDate: nuTechOrderWorkflows.requestedDeliveryDate,
        customerPaidAt: nuTechOrderWorkflows.customerPaidAt,
        purchaseOrderReleasedAt: nuTechOrderWorkflows.purchaseOrderReleasedAt,
        vendorConfirmationNumber: nuTechOrderWorkflows.vendorConfirmationNumber,
        vendorInvoiceNumber: nuTechOrderWorkflows.vendorInvoiceNumber,
        vendorInvoiceStatus: nuTechOrderWorkflows.vendorInvoiceStatus,
        updatedAt: nuTechOrderWorkflows.updatedAt,
      })
      .from(nuTechOrderWorkflows)
      .innerJoin(projects, eq(projects.id, nuTechOrderWorkflows.projectId))
      .where(and(eq(projects.organizationId, organizationId), like(projects.projectNumber, "N-%"))),
    readFeatureSettings(db, organizationId, "nutech-order-board"),
    readFeatureSettings(db, organizationId, "nutech-emails"),
  ])
  const board = buildNuTechOrderBoard({
    today: companyToday(),
    settings,
    manufacturerName: emailSettings.manufacturerName,
    orders: rows.map((row) => ({
      ...row,
      orderStatus: storedNuTechOrderStatus(row.orderStatus),
      deliveryMethod: storedNuTechDeliveryMethod(row.deliveryMethod),
      vendorInvoiceStatus: storedNuTechVendorInvoiceStatus(row.vendorInvoiceStatus),
    })),
  })
  return {
    ...board,
    manufacturerName: emailSettings.manufacturerName.trim(),
    settings: {
      shipsWithinDays: settings.shipsWithinDays,
      confirmationBusinessDays: settings.confirmationBusinessDays,
      invoiceAfterDeliveryDays: settings.invoiceAfterDeliveryDays,
    },
  }
}
