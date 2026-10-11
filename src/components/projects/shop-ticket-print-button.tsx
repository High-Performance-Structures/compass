"use client"

import type * as React from "react"
import { IconPrinter } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"

export function ShopTicketPrintButton(): React.ReactElement {
  return (
    <Button type="button" size="sm" className="print:hidden" onClick={() => window.print()}>
      <IconPrinter className="size-4" />
      Print / Save PDF
    </Button>
  )
}
