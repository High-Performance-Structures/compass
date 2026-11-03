import type { VendorTradeDocStatus } from "@/lib/trade-docs/directory-status"
import { Badge } from "@/components/ui/badge"

/** "3 of 5", marked when something is owed or expiring soon. */
export function TradeDocStatusBadge({ status }: { readonly status: VendorTradeDocStatus }): React.ReactElement {
  if (status.owedCount > 0) {
    return (
      <Badge variant="outline" className="text-destructive" title={`${status.owedCount} missing or expired`}>
        {status.label}
      </Badge>
    )
  }
  if (status.expiringCount > 0) {
    return (
      <Badge variant="outline" className="text-warning" title={`${status.expiringCount} expiring soon`}>
        {status.label} · expiring
      </Badge>
    )
  }
  return <Badge variant="secondary">{status.label}</Badge>
}
