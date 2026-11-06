export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconPackages, IconTool } from "@tabler/icons-react"

import { getNuTechOrderBoard } from "@/app/actions/nutech-order-board"
import { getBracingInventory } from "@/app/actions/nutech-bracing"
import { BracingInventoryPanel } from "@/components/nutech/bracing-inventory"
import { NuTechOrderBoard } from "@/components/nutech/nutech-order-board"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"

export default async function NuTechOrdersPage(): Promise<React.ReactElement> {
  const [board, bracing] = await Promise.all([getNuTechOrderBoard(), getBracingInventory()])

  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <PageHeader
        className="mb-0"
        icon={<IconTool className="size-5 text-brand-nutech-gold-foreground" />}
        title="Nu-Tech Orders"
        actions={<Badge variant="secondary">{board.statusCounts.open} open orders</Badge>}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 border-y py-3">
          <div>
            <h2 className="text-sm font-semibold">Orders</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every order on every N job. Open one to continue its quantities, estimate, PO or invoice.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/nutech/catalog">
                <IconPackages className="size-4" />
                Product catalog
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/projects?department=N">Nu-Tech projects</Link>
            </Button>
          </div>
        </div>
        <NuTechOrderBoard view={board} />
      </section>
      {bracing.success ? <BracingInventoryPanel inventory={bracing.data} /> : null}
    </div>
  )
}
