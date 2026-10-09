export const dynamic = "force-dynamic"

import { IconPackages } from "@tabler/icons-react"

import { getNuTechCatalogWorkspace } from "@/app/actions/nutech-catalog"
import { NuTechCatalogWorkspacePanel } from "@/components/nutech/nutech-catalog-workspace"
import { PageHeader } from "@/components/page-header"

export default async function NuTechCatalogPage(): Promise<React.ReactElement> {
  const workspace = await getNuTechCatalogWorkspace()
  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <PageHeader
        className="mb-0"
        back={{ href: "/dashboard/nutech", label: "Nu-Tech orders" }}
        icon={<IconPackages className="size-5 text-brand-nutech-gold-foreground" />}
        title="Product Catalog"
        description="Versioned Airlite costs, published customer prices, manufacturer-form rows, and deliberate Sage cost-code mappings."
      />
      <NuTechCatalogWorkspacePanel workspace={workspace} />
    </div>
  )
}
