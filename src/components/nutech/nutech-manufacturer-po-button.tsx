"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { createNuTechManufacturerPurchaseOrder } from "@/app/actions/nutech-airlite-po"
import { Button } from "@/components/ui/button"

/**
 * The main "New PO" on an N job: builds the manufacturer purchase order from
 * the Nu-Tech order and links it, or opens the one already linked.
 */
export function NuTechManufacturerPoButton({
  projectId,
  manufacturerName,
  size = "default",
}: {
  readonly projectId: string
  readonly manufacturerName: string
  readonly size?: "default" | "sm"
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const label = `New ${manufacturerName || "manufacturer"} PO`

  function create(): void {
    startTransition(async () => {
      const result = await createNuTechManufacturerPurchaseOrder(projectId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.data.created
          ? `${manufacturerName || "Manufacturer"} PO created from the Nu-Tech order and linked to it.`
          : "This order already has a linked PO; it's in the list below.",
      )
      router.push(`/dashboard/projects/${encodeURIComponent(projectId)}/purchase-orders#purchase-order-${result.data.purchaseOrderId}`)
      router.refresh()
    })
  }

  return (
    <Button type="button" size={size} disabled={pending} onClick={create}>
      <IconPlus className="size-4" />
      {pending ? "Building…" : label}
    </Button>
  )
}
