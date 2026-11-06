import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { NuTechOrderRecord } from "@/lib/domain/nutech/rules"
import { DOCUMENT_INPUT_CLASS } from "@/lib/ui/document-fields"

/**
 * What the manufacturer confirmed for an order: its confirmation number, and
 * the pickup or delivery date, time or dock window, and carrier, which often
 * differ from what the customer asked for. Part of the order form.
 */
export function NuTechConfirmedDeliveryFields({
  order,
  manufacturerName,
  carrierSuggestions,
}: {
  readonly order: Pick<NuTechOrderRecord, "vendorConfirmationNumber" | "confirmedDeliveryDate" | "confirmedDeliveryTime" | "carrier"> | null
  readonly manufacturerName: string
  /** Carriers used on earlier orders, offered while typing. */
  readonly carrierSuggestions: readonly string[]
}): React.ReactElement {
  const manufacturer = manufacturerName.trim() || "Manufacturer"
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="nutech-vendor-confirmation">{manufacturer} confirmation</Label>
        <Input className={DOCUMENT_INPUT_CLASS} id="nutech-vendor-confirmation" name="vendorConfirmationNumber"
          defaultValue={order?.vendorConfirmationNumber ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nutech-confirmed-date">Confirmed pickup / delivery</Label>
        <Input className={DOCUMENT_INPUT_CLASS} id="nutech-confirmed-date" name="confirmedDeliveryDate" type="date"
          defaultValue={order?.confirmedDeliveryDate ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nutech-confirmed-time">Time or dock window</Label>
        <Input className={DOCUMENT_INPUT_CLASS} id="nutech-confirmed-time" name="confirmedDeliveryTime" placeholder="e.g. dock time 2:00 PM"
          defaultValue={order?.confirmedDeliveryTime ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nutech-carrier">Carrier</Label>
        <Input className={DOCUMENT_INPUT_CLASS} id="nutech-carrier" name="carrier" list="nutech-carrier-suggestions" autoComplete="off"
          placeholder="e.g. customer pickup" defaultValue={order?.carrier ?? ""} />
        <datalist id="nutech-carrier-suggestions">
          {carrierSuggestions.map((carrier) => <option key={carrier} value={carrier} />)}
        </datalist>
      </div>
    </>
  )
}
