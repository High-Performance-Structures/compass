export const dynamic = "force-dynamic"

import { IconCalculator } from "@tabler/icons-react"

import { getNuTechTruckloadProducts } from "@/app/actions/nutech-truckload"
import { NuTechTruckloadCalculator } from "@/components/nutech/nutech-truckload-calculator"
import { PageHeader } from "@/components/page-header"

export default async function NuTechTruckloadPage(): Promise<React.ReactElement> {
  const products = await getNuTechTruckloadProducts()
  return (
    <div className="flex-1 space-y-6 p-4 pt-6 sm:p-6 md:p-8">
      <PageHeader
        className="mb-0"
        back={{ href: "/dashboard/nutech", label: "Nu-Tech orders" }}
        icon={<IconCalculator className="size-5 text-brand-nutech-gold-foreground" />}
        title="Truckload Calculator"
        meta="Type bundles to see how much of a manufacturer truck they take. Nothing is saved."
      />
      <NuTechTruckloadCalculator products={products} />
    </div>
  )
}
