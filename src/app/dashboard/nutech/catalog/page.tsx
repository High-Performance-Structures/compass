export const dynamic = "force-dynamic"

import Link from "next/link"
import { IconArrowLeft, IconPackages } from "@tabler/icons-react"

import { getNuTechCatalogWorkspace } from "@/app/actions/nutech-catalog"
import { NuTechCatalogWorkspacePanel } from "@/components/nutech/nutech-catalog-workspace"
import { Button } from "@/components/ui/button"

export default async function NuTechCatalogPage(): Promise<React.ReactElement> {
  const workspace = await getNuTechCatalogWorkspace()
  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
            <Link href="/dashboard/nutech">
              <IconArrowLeft className="size-4" />
              Nu-Tech orders
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <IconPackages className="size-5 text-brand-nutech-gold-foreground" />
            <h1 className="text-2xl font-semibold tracking-tight">
              Product Catalog
            </h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Versioned Airlite costs, published customer prices, manufacturer-form
            rows, and deliberate Sage cost-code mappings.
          </p>
        </div>
      </div>
      <NuTechCatalogWorkspacePanel workspace={workspace} />
    </div>
  )
}
